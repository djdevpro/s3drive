import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

// En-têtes de sécurité HTTP.

export interface SecurityOptions {
  /** `UD_CSP` : absent = politique stricte, `off` = aucune CSP, sinon politique personnalisée reprise telle quelle. */
  csp?: string | undefined;
  /** `UD_PUBLIC_URL` : HSTS seulement si elle est en HTTPS. */
  publicUrl?: string | undefined;
  /** `UD_ALLOW_PRIVATE_ENDPOINTS=1`. */
  allowPrivateEndpoints?: boolean | undefined;
  /** `UD_ALLOWED_ENDPOINTS` : une entrée `http://` autorise `http:` dans la CSP. */
  allowedEndpoints?: readonly string[] | undefined;
}

/** Empreintes `'sha256-…'` des scripts en ligne d'un document HTML (corps exact, fins de ligne normalisées). */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (/\bsrc\s*=/i.test(m[1] ?? '')) continue;
    // Le navigateur hache le texte après le prétraitement HTML, qui ramène CRLF et CR à LF.
    const body = (m[2] ?? '').replace(/\r\n?/g, '\n');
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

/** `http:` est permis dès qu'un point de terminaison S3 en clair peut être atteint. */
export function allowsHttpEndpoints(options: SecurityOptions): boolean {
  return Boolean(options.allowPrivateEndpoints) || (options.allowedEndpoints ?? []).some((e) => /^http:\/\//i.test(e.trim()));
}

/** Politique stricte de l'appli, sans nonce. */
export function appCsp(options: { allowHttp: boolean; scriptHashes?: readonly string[] }): string {
  const remote = options.allowHttp ? 'https: http:' : 'https:';
  const directives = [
    `default-src 'self'`,
    ['script-src', `'self'`, `'wasm-unsafe-eval'`, ...(options.scriptHashes ?? [])].join(' '),
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${remote}`,
    `media-src 'self' blob: ${remote}`,
    `connect-src 'self' ${remote}`,
    `frame-src 'self' blob: ${remote}`,
    `worker-src 'self' blob:`,
    `font-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (!options.allowHttp) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

// prise de photo mobile par <input capture>, sans caméra autorisée.
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=(self)',
  'bluetooth=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'otp-credentials=()',
  'payment=()',
  'picture-in-picture=(self)',
  'publickey-credentials-create=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'web-share=(self)',
  'xr-spatial-tracking=()',
].join(', ');

const HSTS = 'max-age=63072000; includeSubDomains';

/**
 * Middleware posé en tête de l'appli : complète chaque réponse (erreurs comprises) sans écraser un
 * en-tête déjà choisi par une route (flux relayés, image OpenGraph des partages…).
 * `scriptHashes` : empreintes des scripts en ligne de index.html (calculées au démarrage).
 */
export function securityHeaders(options: SecurityOptions, scriptHashes: readonly string[] = []): MiddlewareHandler {
  const custom = options.csp?.trim();
  const cspOff = custom?.toLowerCase() === 'off';
  const allowHttp = allowsHttpEndpoints(options);
  const hsts = options.publicUrl?.toLowerCase().startsWith('https://') ?? false;
  const htmlPolicy = custom || appCsp({ allowHttp, scriptHashes });

  return async (c, next) => {
    await next();
    let headers = c.res.headers;
    const set = (name: string, value: string) => {
      if (headers.has(name)) return;
      try {
        headers.set(name, value);
      } catch {
        // En-têtes figés (réponse d'un fetch) : on recopie la réponse.
        c.res = new Response(c.res.body, c.res);
        headers = c.res.headers;
        headers.set(name, value);
      }
    };
    const path = c.req.path;
    const html = (headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');

    if (!cspOff) {
      if (html) {
        set('Content-Security-Policy', htmlPolicy);
      } else {
        // Hors document de l'appli : seulement l'anti-clickjacking.
        set('Content-Security-Policy', `frame-ancestors 'none'`);
      }
    }
    set('X-Content-Type-Options', 'nosniff');
    set('Referrer-Policy', 'no-referrer');
    set('X-Frame-Options', 'DENY');
    set('X-Robots-Tag', 'noindex, nofollow');
    set('Cross-Origin-Opener-Policy', 'same-origin');
    set('Permissions-Policy', PERMISSIONS_POLICY);
    if (path === '/api/v1' || path.startsWith('/api/v1/')) set('Cross-Origin-Resource-Policy', 'same-origin');
    if (hsts) set('Strict-Transport-Security', HSTS);
  };
}

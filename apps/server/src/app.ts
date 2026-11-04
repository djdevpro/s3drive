import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { InstanceInfo } from '@ud/contracts';
import { Hono } from 'hono';
import { ApiError, handleError, sendError } from './errors.js';
import { type InstanceRuntime, registerInstanceRoutes } from './instance/index.js';
import { type SecurityOptions, inlineScriptHashes, securityHeaders } from './security.js';

export interface AppDeps {
  db: DatabaseSync;
  /** Dossier du front buildé ; absent ou sans index.html : pas de service statique (dev, tests). */
  webDist?: string | undefined;
  /** Mode instance ou `both` (12) ; absent : mode personnel seul. */
  instance?: InstanceRuntime | undefined;
  /** Nom affiché en mode personnel (`UD_INSTANCE_NAME`). */
  instanceName?: string | undefined;
  /** CSP et en-têtes de sécurité ; absent : politique stricte, sans HSTS. */
  security?: SecurityOptions | undefined;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Préfixes jamais servis par le repli SPA.
const NON_SPA_PREFIXES = ['/api/', '/mcp', '/healthz'];

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(handleError);

  const dist = deps.webDist;
  const indexHtml = dist && existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html')) : undefined;
  // Scripts en ligne de index.html (amorçage du thème, du mode et de la langue) autorisés par empreinte.
  app.use('*', securityHeaders(deps.security ?? {}, indexHtml ? inlineScriptHashes(indexHtml.toString('utf8')) : []));

  // { ok } seulement, sans version ni nom d'appli ; 503 si SQLite ne répond pas.
  app.get('/healthz', (c) => {
    c.header('Cache-Control', 'no-store');
    try {
      deps.db.prepare('SELECT 1').get();
      return c.json({ ok: true }, 200);
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  if (deps.instance) {
    registerInstanceRoutes(app, deps.instance);
  } else {
    // Mode personnel : l'instance se décrit pour que le front choisisse /connect.
    app.get('/api/v1/instance', (c) => {
      c.header('Cache-Control', 'no-store');
      const info: InstanceInfo = { mode: 'personal', connection: null, name: deps.instanceName ?? 'Universal Drive', login: null, personal: true };
      return c.json(info);
    });
  }

  // Toute route d'API inconnue : enveloppe d'erreur ; en mode instance, /connect et /auth/connect n'existent pas.
  app.all('/api/*', (c) => sendError(c, new ApiError('not_found', 'Not found')));

  if (dist && indexHtml) {
    const root = normalize(dist + sep);
    app.get('*', (c) => {
      let path: string;
      try {
        path = decodeURIComponent(new URL(c.req.url).pathname);
      } catch {
        return c.notFound();
      }
      if (NON_SPA_PREFIXES.some((p) => path.startsWith(p))) return c.notFound();
      // Mode instance seul : pas de connexion par identifiants S3.
      if (deps.instance?.mode === 'instance' && (path === '/connect' || path.startsWith('/connect/'))) return c.notFound();
      const file = normalize(join(root, path));
      if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
        const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
        // statiques à empreinte de Vite immuables ; index.html, manifeste et le reste revalidés.
        const immutable = path.startsWith('/assets/');
        return c.body(readFileSync(file), 200, {
          'Content-Type': type,
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
      }
      return c.body(indexHtml, 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    });
  }

  return app;
}

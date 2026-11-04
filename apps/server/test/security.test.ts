import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppDeps, createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { allowsHttpEndpoints, appCsp, inlineScriptHashes } from '../src/security.js';

const BOOT = `\n      (function () { document.documentElement.dataset.theme = 'porcelain'; })();\n    `;
const INDEX = `<!doctype html><html><head><title>x</title><script>${BOOT}</script>
<script type="module" crossorigin src="/assets/index-abc.js"></script></head><body><div id="root"></div></body></html>`;

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function makeApp(deps: Partial<AppDeps> = {}, index = INDEX) {
  const dist = mkdtempSync(join(tmpdir(), 'ud-sec-'));
  writeFileSync(join(dist, 'index.html'), index);
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'index-abc.js'), 'export {}');
  writeFileSync(join(dist, 'manifest.webmanifest'), '{}');
  const db = openDatabase(':memory:');
  cleanups.push(() => {
    db.close();
    rmSync(dist, { recursive: true, force: true });
  });
  return createApp({ db, webDist: dist, ...deps });
}

/** Directives d'une CSP, par nom. */
function directives(csp: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of (csp ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe('inlineScriptHashes', () => {
  it('hashes every inline script body, skips external ones, normalizes CRLF', () => {
    const html = `<script>a()</script><script src="/x.js"></script><SCRIPT type="module">\r\nb()\r\n</SCRIPT><script>a()</script>`;
    expect(inlineScriptHashes(html)).toEqual([sha256('a()'), sha256('\nb()\n')]);
    expect(inlineScriptHashes('<p>no script</p>')).toEqual([]);
  });
});

describe('appCsp', () => {
  it('matches the strict app policy, without unsafe-inline nor unsafe-eval for scripts', () => {
    const d = directives(appCsp({ allowHttp: false, scriptHashes: [sha256('x')] }));
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", sha256('x')]);
    expect(d.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:']);
    expect(d.get('media-src')).toEqual(["'self'", 'blob:', 'https:']);
    expect(d.get('connect-src')).toEqual(["'self'", 'https:']);
    expect(d.get('frame-src')).toEqual(["'self'", 'blob:', 'https:']);
    expect(d.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(d.get('font-src')).toEqual(["'self'"]);
    expect(d.get('manifest-src')).toEqual(["'self'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.has('upgrade-insecure-requests')).toBe(true);
  });

  it('adds http: to the S3 directives and drops upgrade-insecure-requests when http hosts are allowed', () => {
    const d = directives(appCsp({ allowHttp: true }));
    for (const name of ['img-src', 'media-src', 'connect-src', 'frame-src']) expect(d.get(name)).toContain('http:');
    expect(d.get('script-src')).not.toContain('http:');
    expect(d.has('upgrade-insecure-requests')).toBe(false);
  });

  it('allows http: for UD_ALLOW_PRIVATE_ENDPOINTS=1 or an http:// entry of UD_ALLOWED_ENDPOINTS', () => {
    expect(allowsHttpEndpoints({})).toBe(false);
    expect(allowsHttpEndpoints({ allowedEndpoints: ['https://s3.example.com', '*.example.net'] })).toBe(false);
    expect(allowsHttpEndpoints({ allowedEndpoints: ['s3.example.com', 'HTTP://minio.lan:9000'] })).toBe(true);
    expect(allowsHttpEndpoints({ allowPrivateEndpoints: true })).toBe(true);
  });
});

describe('security headers', () => {
  it('serves the SPA with the strict CSP and the hash of its inline boot script', async () => {
    const res = await makeApp().request('/d/conn/b/bucket');
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const d = directives(res.headers.get('content-security-policy'));
    expect(d.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", sha256(BOOT)]);
    expect(res.headers.get('content-security-policy')).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(d.has('upgrade-insecure-requests')).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('puts the same headers on every response (SPA, assets, API, errors, healthz)', async () => {
    const app = makeApp();
    for (const path of ['/', '/assets/index-abc.js', '/healthz', '/api/v1/instance', '/api/v1/nothing']) {
      const res = await app.request(path);
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(res.headers.get('referrer-policy'), path).toBe('no-referrer');
      expect(res.headers.get('x-frame-options'), path).toBe('DENY');
      expect(res.headers.get('x-robots-tag'), path).toBe('noindex, nofollow');
      expect(res.headers.get('cross-origin-opener-policy'), path).toBe('same-origin');
      expect(res.headers.get('cross-origin-embedder-policy'), path).toBeNull();
      const pp = res.headers.get('permissions-policy') ?? '';
      expect(pp, path).toContain('camera=()');
      expect(pp, path).toContain('fullscreen=(self)');
      expect(pp, path).not.toContain('clipboard-write');
      expect(directives(res.headers.get('content-security-policy')).get('frame-ancestors'), path).toEqual(["'none'"]);
      expect(res.headers.get('strict-transport-security'), path).toBeNull();
    }
  });

  it('limits non-HTML responses to frame-ancestors and sets CORP on /api/v1 only', async () => {
    const app = makeApp();
    const api = await app.request('/api/v1/instance');
    expect(api.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(api.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(api.headers.get('cache-control')).toBe('no-store');
    const missing = await app.request('/api/v1/nothing');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect((await app.request('/')).headers.get('cross-origin-resource-policy')).toBeNull();
    expect((await app.request('/healthz')).headers.get('cross-origin-resource-policy')).toBeNull();
  });

  it('caches fingerprinted assets forever and revalidates index.html and the manifest', async () => {
    const app = makeApp();
    expect((await app.request('/assets/index-abc.js')).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await app.request('/index.html')).headers.get('cache-control')).toBe('no-cache');
    const manifest = await app.request('/manifest.webmanifest');
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json');
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
  });

  it('adds http: when private endpoints are allowed, or an http:// endpoint is listed', async () => {
    for (const security of [{ allowPrivateEndpoints: true }, { allowedEndpoints: ['http://minio.lan:9000'] }]) {
      const d = directives((await makeApp({ security }).request('/')).headers.get('content-security-policy'));
      expect(d.get('connect-src')).toEqual(["'self'", 'https:', 'http:']);
      expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https:', 'http:']);
      expect(d.has('upgrade-insecure-requests')).toBe(false);
    }
  });

  it('UD_CSP=off removes the CSP but keeps the other headers', async () => {
    const app = makeApp({ security: { csp: 'off' } });
    for (const path of ['/', '/api/v1/instance']) {
      const res = await app.request(path);
      expect(res.headers.get('content-security-policy'), path).toBeNull();
      expect(res.headers.get('x-frame-options'), path).toBe('DENY');
    }
  });

  it('a custom UD_CSP replaces the policy of the SPA', async () => {
    const res = await makeApp({ security: { csp: "default-src 'self'; frame-ancestors 'none'" } }).request('/');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'; frame-ancestors 'none'");
  });

  it('sends HSTS only when the public origin is HTTPS', async () => {
    const secure = makeApp({ security: { publicUrl: 'https://drive.example.com' } });
    for (const path of ['/', '/api/v1/instance', '/healthz']) {
      expect((await secure.request(path)).headers.get('strict-transport-security'), path).toBe('max-age=63072000; includeSubDomains');
    }
    const plain = makeApp({ security: { publicUrl: 'http://localhost:18081' } });
    expect((await plain.request('/')).headers.get('strict-transport-security')).toBeNull();
  });

  it('never overrides a header chosen by a route', async () => {
    // Appli sans front ni repli SPA : la route de test est atteinte.
    const db = openDatabase(':memory:');
    cleanups.push(() => db.close());
    const app = createApp({ db });
    app.get('/relay', (c) => c.body('x', 200, { 'Content-Security-Policy': 'sandbox', 'X-Frame-Options': 'SAMEORIGIN' }));
    const res = await app.request('/relay');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('UD_CSP', () => {
  it('is read from the environment', () => {
    expect(loadConfig({ UD_CSP: 'off' }).UD_CSP).toBe('off');
    expect(loadConfig({}).UD_CSP).toBeUndefined();
  });
});

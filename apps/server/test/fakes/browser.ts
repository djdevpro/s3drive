import type { Hono } from 'hono';
import { expect } from 'vitest';
import type { FakeOidc } from './fake-oidc.js';

// Navigateur minimal des tests : jarre de cookies, X-UD et Origin sur les écritures, corps JSON.

export const PUBLIC_URL = 'http://drive.test';

export class Browser {
  readonly cookies = new Map<string, string>();
  constructor(private readonly app: Hono) {}

  async request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { ...init.headers };
    if (this.cookies.size > 0) headers['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET') {
      headers['x-ud'] ??= '1';
      headers['origin'] ??= PUBLIC_URL;
    }
    let body: string | undefined;
    if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    const res = await this.app.request(`${PUBLIC_URL}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (/Max-Age=0/.test(cookie) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  json(path: string, init: Parameters<Browser['request']>[1] = {}) {
    return this.request(path, init).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));
  }
}

/** Parcours de connexion complet : Drive → fournisseur → callback ; renvoie la redirection finale. */
export async function login(browser: Browser, oidc: FakeOidc, sub: string, next = '/d/drive/b/home/'): Promise<string> {
  oidc.currentSub = sub;
  const start = await browser.request(`/api/v1/auth/oidc/login?next=${encodeURIComponent(next)}`);
  expect(start.status).toBe(302);
  const idp = await fetch(new URL(start.headers.get('location')!), { redirect: 'manual' });
  expect(idp.status).toBe(302);
  const callback = new URL(idp.headers.get('location')!);
  const done = await browser.request(callback.pathname + callback.search);
  expect(done.status).toBe(302);
  return done.headers.get('location')!;
}

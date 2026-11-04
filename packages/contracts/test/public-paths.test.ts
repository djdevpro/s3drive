import { describe, expect, it } from 'vitest';
import { isPublicPath } from '../src/public-paths.js';

const TOKEN = `ud_at_${'A'.repeat(16)}.${'b'.repeat(43)}`;

describe('isPublicPath', () => {
  it.each([
    '/s/abc123',
    '/s/abc/file.pdf',
    '/receive/xyz',
    '/api/v1/public/s/tok/meta',
    '/api/v1/instance',
    '/api/v1/auth/oidc/login?next=/d/drive/b/home/',
    '/api/v1/auth/oidc/callback',
    '/mcp',
    '/mcp/stdio.mjs',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource/mcp',
    '/oauth/token',
    '/oauth/revoke',
    '/healthz',
    '/healthz?x=1',
    '/robots.txt',
    '/assets/index-abc.js',
    '/favicon.ico',
  ])('%s is public', (path) => expect(isPublicPath(path)).toBe(true));

  it.each([
    '/',
    '/connect',
    '/d/a1B2c3D4e5',
    '/s',
    '/s/',
    '/sx/abc',
    '/mcp/other',
    '/mcpx',
    '/oauth/authorize',
    '/oauth/consent/req1',
    '/api/v1/session',
    '/api/v1/c/me',
    '/api/v1/publicx',
    '/api/v1/instancex',
    '/api/v1/instance/x',
    '/api/v1/auth/oidc',
    '/api/v1/auth/logout',
    '/api/v1/me',
    '/api/v1/admin/users',
    '/s/../d/x',
    '/s/%2e%2e/d',
    '/assets//x',
    '/s\\..\\d',
    'healthz',
  ])('%s is not public', (path) => expect(isPublicPath(path)).toBe(false));

  it('treats /api/v1/* with a ud_at_ bearer as public', () => {
    expect(isPublicPath('/api/v1/c/me', { authorization: `Bearer ${TOKEN}` })).toBe(true);
    expect(isPublicPath('/api/v1/c/me/buckets', { get: (name: string) => (name.toLowerCase() === 'authorization' ? `Bearer ${TOKEN}` : null) })).toBe(true);
  });

  it('keeps the gate for other bearers, cookies and paths outside /api/v1', () => {
    expect(isPublicPath('/api/v1/c/me', { authorization: 'Bearer eyJhbGciOi' })).toBe(false);
    expect(isPublicPath('/api/v1/c/me', { authorization: `Basic ${TOKEN}` })).toBe(false);
    expect(isPublicPath('/api/v1/c/me', { cookie: '__Host-ud_sid=x' })).toBe(false);
    expect(isPublicPath('/api/v1/c/me', { authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] })).toBe(false);
    expect(isPublicPath('/d/me', { authorization: `Bearer ${TOKEN}` })).toBe(false);
    expect(isPublicPath('/oauth/authorize', { authorization: `Bearer ${TOKEN}` })).toBe(false);
  });
});

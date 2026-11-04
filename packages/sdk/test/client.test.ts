// Client typé de /api/v1 : URL et clés en paramètre, cookie et X-UD, validation, erreurs typées, passerelle expirée.
import { describe, expect, it, vi } from 'vitest';
import { DriveApiError, createDriveClient } from '../src/index.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  credentials: RequestCredentials | undefined;
  redirect: RequestRedirect | undefined;
  body: unknown;
}

type Reply = { status: number; body?: unknown; raw?: string; headers?: Record<string, string> } | Response | Error;

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      credentials: init?.credentials,
      redirect: init?.redirect,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = replies.shift() ?? { status: 204 };
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    const text = next.raw ?? (next.body === undefined ? null : JSON.stringify(next.body));
    return new Response(text, { status: next.status, headers: { 'content-type': 'application/json', ...(next.headers ?? {}) } });
  };
  return { fn, calls };
}

const me = {
  user: { id: 'u1', email: 'a@x.test', name: 'Alice', roles: ['user'] },
  connection: 'drive',
  spaces: [{ id: 'home', label: null, scopes: ['read', 'write'], quota: 1_000_000_000, usage: { bytes: 5, objects: 1 } }],
  quota: { limit: 1_000_000_000, used: 5, reserved: 0 },
  links: { public: false, people: true, maxDays: 30 },
  admin: [],
  superAdmin: false,
  terms: { required: false, version: 'v1', url: '/api/v1/me/terms' },
};

const adminUser = {
  id: 'u1',
  email: 'a@x.test',
  name: 'Alice',
  roles: ['user'],
  status: 'active',
  quota: { limit: 1_000_000_000, used: 5, reserved: 0, objects: 1 },
  quotaOverride: null,
  termsVersion: 'v1',
  createdAt: '2026-11-01T10:00:00.000Z',
  lastLoginAt: null,
};

async function failure(promise: Promise<unknown>): Promise<DriveApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DriveApiError) return error;
    throw error;
  }
  throw new Error('expected a DriveApiError');
}

describe('createDriveClient', () => {
  it('GET : cookie inclus, redirections non suivies, pas de X-UD, réponse validée', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: me }]);
    const client = createDriveClient({ baseUrl: 'http://api.test/', fetch: fn });
    const res = await client.me();
    expect(res.user.name).toBe('Alice');
    const call = calls[0]!;
    expect(call.url).toBe('http://api.test/api/v1/me');
    expect(call.credentials).toBe('include');
    expect(call.redirect).toBe('manual');
    expect(call.headers['X-UD']).toBeUndefined();
    expect(call.headers['Accept']).toBe('application/json');
  });

  it('méthodes non sûres : X-UD: 1 et corps JSON ; 204 sans corps', async () => {
    const { fn, calls } = fakeFetch([{ status: 204 }, { status: 200, body: { endSessionUrl: null } }]);
    const client = createDriveClient({ fetch: fn });
    await expect(client.acceptTerms('v1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/me/terms', body: { version: 'v1' } });
    expect(calls[0]!.headers).toMatchObject({ 'X-UD': '1', 'Content-Type': 'application/json' });
    await expect(client.logout()).resolves.toEqual({ endSessionUrl: null });
    expect(calls[1]!.headers['X-UD']).toBe('1');
    expect(calls[1]!.headers['Content-Type']).toBeUndefined();
  });

  it('clés toujours en ?key=, segments encodés', async () => {
    const op = { bucket: 'home', key: 'b/x.txt', objects: 1 };
    const { fn, calls } = fakeFetch([
      { status: 201, body: op },
      { status: 200, body: op },
      { status: 200, body: op },
      { status: 200, body: op },
      { status: 200, body: { deleted: 1 } },
      { status: 200, body: { url: 'https://s3/x', expiresAt: '2026-11-03T12:00:00.000Z', transport: 'direct' } },
      { status: 200, body: { items: [], nextCursor: null, prefix: 'a b/', partial: false } },
    ]);
    const client = createDriveClient({ fetch: fn });
    await client.createFolder('drive', 'home', 'Été/');
    await client.rename('drive', 'home', 'a/x.txt', { newName: 'y.txt', conflict: 'fail' });
    await client.move('drive', 'home', 'a/x.txt', { destination: { bucket: 'commun', key: 'b/x.txt' }, conflict: 'fail' });
    await client.copy('drive', 'home', 'a/x.txt', { destination: { key: 'b/x.txt' }, conflict: 'rename' });
    await client.remove('drive', 'home', 'a/?#x.txt');
    await client.downloadUrl('drive', 'home', 'a/x.txt', { disposition: 'inline' });
    await client.list('drive', 'home', { prefix: 'a b/', cursor: null, limit: 100 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PUT /api/v1/c/drive/b/home/object?key=%C3%89t%C3%A9%2F',
      'POST /api/v1/c/drive/b/home/object/rename?key=a%2Fx.txt',
      'POST /api/v1/c/drive/b/home/object/move?key=a%2Fx.txt',
      'POST /api/v1/c/drive/b/home/object/copy?key=a%2Fx.txt',
      'DELETE /api/v1/c/drive/b/home/object?key=a%2F%3F%23x.txt',
      'GET /api/v1/c/drive/b/home/download?key=a%2Fx.txt&disposition=inline',
      'GET /api/v1/c/drive/b/home/objects?prefix=a+b%2F&limit=100',
    ]);
    expect(calls[0]!.body).toBeUndefined();
    expect(calls[2]!.body).toEqual({ destination: { bucket: 'commun', key: 'b/x.txt' }, conflict: 'fail' });
  });

  it('createFolder refuse une clé sans / final sans appeler le serveur', async () => {
    const { fn, calls } = fakeFetch([]);
    const error = await failure(createDriveClient({ fetch: fn }).createFolder('drive', 'home', 'x'));
    expect(error.code).toBe('validation');
    expect(error.reason).toBe('folder_key');
    expect(calls).toHaveLength(0);
  });

  it('buckets : éléments de la liste ; connexion et instance', async () => {
    const space = { name: 'home', kind: 'space', label: null, scopes: ['read'], quota: null, usage: { bytes: 0, objects: 0 } };
    const { fn } = fakeFetch([
      { status: 200, body: { items: [space], nextCursor: null } },
      { status: 200, body: { id: 'drive', kind: 'instance', name: 'Drive', apiVersion: '1' } },
      { status: 200, body: { mode: 'instance', connection: 'drive', name: 'Drive', login: { label: 'Keycloak' }, personal: false } },
    ]);
    const client = createDriveClient({ fetch: fn });
    expect(await client.buckets('drive')).toEqual([space]);
    expect((await client.connection('drive')).kind).toBe('instance');
    expect((await client.instance()).login?.label).toBe('Keycloak');
  });

  it('loginHref : next encodé, absent sans valeur', () => {
    const client = createDriveClient({ baseUrl: 'https://drive.test' });
    expect(client.loginHref('/d/drive/b/home/a b?x=1')).toBe('https://drive.test/api/v1/auth/oidc/login?next=%2Fd%2Fdrive%2Fb%2Fhome%2Fa+b%3Fx%3D1');
    expect(client.loginHref()).toBe('https://drive.test/api/v1/auth/oidc/login');
  });

  it('administration : requête de liste, PATCH avec X-UD, recalcul', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { items: [adminUser], nextCursor: 'MjU' } },
      { status: 200, body: adminUser },
      { status: 200, body: { ...adminUser, status: 'suspended' } },
      { status: 200, body: adminUser },
    ]);
    const client = createDriveClient({ fetch: fn });
    const page = await client.admin.users({ q: 'al', cursor: 'MA', limit: 25, sort: 'usage', dir: 'desc' });
    expect(page.nextCursor).toBe('MjU');
    await client.admin.user('u/1');
    expect((await client.admin.updateUser('u1', { status: 'suspended' })).status).toBe('suspended');
    await client.admin.recount('u1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/admin/users?q=al&cursor=MA&limit=25&sort=usage&dir=desc',
      'GET /api/v1/admin/users/u%2F1',
      'PATCH /api/v1/admin/users/u1',
      'POST /api/v1/admin/users/u1/recount',
    ]);
    expect(calls[2]!.body).toEqual({ status: 'suspended' });
    expect(calls[3]!.headers['X-UD']).toBe('1');
  });

  it('erreur de l’API : code, statut, details et reason ; onUnauthorized sur 401', async () => {
    const onUnauthorized = vi.fn();
    const { fn } = fakeFetch([
      { status: 401, body: { error: 'unauthorized', message: 'Session ended', details: { reason: 'session_ended' } } },
      { status: 403, body: { error: 'forbidden', message: 'Terms', details: { reason: 'terms_required' } } },
      { status: 403, body: { error: 'quota_exceeded', message: 'Quota', details: { limit: 'user_quota', remaining: 12 }, s3: { code: 'X', requestId: 'r1' } } },
    ]);
    const client = createDriveClient({ fetch: fn, onUnauthorized });
    const e401 = await failure(client.me());
    expect(e401).toBeInstanceOf(Error);
    expect(e401).toMatchObject({ code: 'unauthorized', status: 401, message: 'Session ended' });
    expect(e401.reason).toBe('session_ended');
    expect(onUnauthorized).toHaveBeenCalledWith('session_ended');
    const e403 = await failure(client.buckets('drive'));
    expect(e403).toMatchObject({ code: 'forbidden', status: 403 });
    expect(e403.reason).toBe('terms_required');
    const quota = await failure(client.list('drive', 'home', { prefix: '' }));
    expect(quota.code).toBe('quota_exceeded');
    expect(quota.details).toMatchObject({ limit: 'user_quota', remaining: 12, s3: { code: 'X', requestId: 'r1' } });
    expect(quota.reason).toBeUndefined();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('passerelle expirée : redirection (Node), redirection opaque (navigateur), 401 sans enveloppe', async () => {
    const onGateExpired = vi.fn();
    const onUnauthorized = vi.fn();
    const opaque = new Response(null, { status: 200 });
    Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
    Object.defineProperty(opaque, 'status', { value: 0 });
    const { fn } = fakeFetch([
      new Response(null, { status: 302, headers: { location: 'https://idp.test/login' } }),
      opaque,
      { status: 401, raw: '<html>Sign in</html>', headers: { 'content-type': 'text/html' } },
    ]);
    const client = createDriveClient({ fetch: fn, onGateExpired, onUnauthorized });
    expect(await failure(client.me())).toMatchObject({ code: 'local.gate_expired', status: 302 });
    expect(await failure(client.me())).toMatchObject({ code: 'local.gate_expired', status: 0 });
    expect(await failure(client.me())).toMatchObject({ code: 'local.gate_expired', status: 401 });
    expect(onGateExpired).toHaveBeenCalledTimes(3);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('réseau, JSON illisible, réponse hors schéma, erreur sans enveloppe', async () => {
    const { fn } = fakeFetch([
      new TypeError('Failed to fetch'),
      { status: 200, raw: 'not json' },
      { status: 200, body: { ...me, quota: { limit: -1 } } },
      { status: 502, raw: 'Bad gateway', headers: { 'content-type': 'text/plain' } },
    ]);
    const client = createDriveClient({ fetch: fn });
    expect(await failure(client.me())).toMatchObject({ code: 'local.network', status: 0 });
    expect(await failure(client.me())).toMatchObject({ code: 'local.invalid_response', status: 200 });
    const schema = await failure(client.me());
    expect(schema.code).toBe('local.invalid_response');
    expect(schema.reason).toBe('schema');
    expect(await failure(client.me())).toMatchObject({ code: 'local.invalid_response', status: 502 });
  });
});

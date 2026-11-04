// Transport du mode instance : URL, cookie et X-UD, validation des réponses, erreurs typées.
import { describe, expect, it } from 'vitest';
import { InstanceUploadTransport, UploadError, nextFreeName, freeNameCandidates, joinKey, isIgnoredPath } from '../src/upload.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fn: typeof fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift() ?? { status: 204 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  };
  return { fn, calls };
}

const expiresAt = '2026-11-03T12:00:00.000Z';

describe('InstanceUploadTransport', () => {
  it('création : route, clé en paramètre, X-UD, Idempotency-Key, corps conforme', async () => {
    const { fn, calls } = fakeFetch([
      { status: 201, body: { key: 'Docs/été.pdf', transport: 'direct', corsOk: null, weakGuard: true, expiresAt, mode: 'single', url: 'https://s3/x', headers: { 'content-length': '5' }, receipt: '1.mac' } },
    ]);
    const t = new InstanceUploadTransport({ connection: 'drive', baseUrl: 'http://api.test/', fetch: fn, headers: { Cookie: 'ud_sid=abc' } });
    const res = await t.create({ bucket: 'home', key: 'Docs/été.pdf', size: 5, mode: 'single', purpose: 'upload', conflict: 'fail', idempotencyKey: 'id-1', contentType: 'application/pdf', lastModified: 12.4 });
    expect(res.mode).toBe('single');
    const call = calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('http://api.test/api/v1/c/drive/b/home/uploads?key=Docs%2F%C3%A9t%C3%A9.pdf');
    expect(call.headers).toMatchObject({ 'X-UD': '1', 'Idempotency-Key': 'id-1', Cookie: 'ud_sid=abc', 'Content-Type': 'application/json' });
    expect(call.body).toEqual({ size: 5, mode: 'single', purpose: 'upload', conflict: 'fail', contentType: 'application/pdf', lastModified: 12 });
  });

  it('parties, liste, finalisation, abandon et confirmation', async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, body: { parts: [{ partNumber: 2, url: 'https://s3/p2', headers: { 'content-length': '3' }, expiresAt }] } },
      { status: 200, body: { items: [{ partNumber: 1, etag: 'e1', size: 5 }], nextCursor: null } },
      { status: 200, body: { key: 'a', etag: 'e-2', size: 8 } },
      { status: 204 },
      { status: 200, body: { results: [{ key: 'a', ok: false, verified: false, error: { error: 'validation', message: 'Invalid receipt', details: { reason: 'invalid_receipt' } } }] } },
    ]);
    const t = new InstanceUploadTransport({ connection: 'drive', fetch: fn });
    const ref = { bucket: 'home', key: 'a', uploadId: 'U/1' };
    expect(await t.signParts({ ...ref, parts: [{ partNumber: 2, size: 3 }] })).toHaveLength(1);
    expect(await t.listParts(ref)).toEqual([{ partNumber: 1, etag: 'e1', size: 5 }]);
    expect(await t.complete({ ...ref, size: 8, parts: [{ partNumber: 1 }] })).toEqual({ key: 'a', etag: 'e-2', size: 8 });
    await t.abort(ref);
    expect(await t.confirm('home', [{ key: 'a', receipt: 'r', size: 8 }])).toEqual([{ key: 'a', ok: false, error: { code: 'validation', retryable: false, reason: 'invalid_receipt' } }]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/v1/c/drive/b/home/uploads/U%2F1/parts?key=a',
      'GET /api/v1/c/drive/b/home/uploads/U%2F1/parts?key=a',
      'POST /api/v1/c/drive/b/home/uploads/U%2F1/complete?key=a',
      'DELETE /api/v1/c/drive/b/home/uploads/U%2F1?key=a',
      'POST /api/v1/c/drive/b/home/uploads/confirm',
    ]);
    expect(calls[1]!.headers['X-UD']).toBeUndefined();
    expect(calls[3]!.headers['X-UD']).toBe('1');
  });

  it('refus de quota : UploadError avec details.remaining, non réessayable', async () => {
    const { fn } = fakeFetch([{ status: 403, body: { error: 'quota_exceeded', message: 'Quota exceeded', details: { limit: 'user_quota', remaining: 1234 } } }]);
    const t = new InstanceUploadTransport({ connection: 'drive', fetch: fn });
    const error = await t.create({ bucket: 'home', key: 'k', size: 9999, mode: 'single', purpose: 'upload', conflict: 'overwrite', idempotencyKey: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).code).toBe('quota_exceeded');
    expect((error as UploadError).retryable).toBe(false);
    expect((error as UploadError).toInfo()).toEqual({ code: 'quota_exceeded', retryable: false, status: 403, details: { remaining: 1234, limit: 'user_quota' } });
  });

  it('erreurs : 503 réessayable avec Retry-After, réponse invalide, réseau', async () => {
    const { fn } = fakeFetch([
      { status: 503, body: { error: 'slow_down', message: 'Slow down' }, headers: { 'retry-after': '3' } },
      { status: 200, body: { unexpected: true } },
    ]);
    const t = new InstanceUploadTransport({ connection: 'drive', fetch: fn });
    const ref = { bucket: 'home', key: 'a', uploadId: 'u' };
    const slow = (await t.listParts(ref).catch((e: unknown) => e)) as UploadError;
    expect(slow.code).toBe('slow_down');
    expect(slow.retryable).toBe(true);
    expect(slow.retryAfterMs).toBe(3000);
    const invalid = (await t.listParts(ref).catch((e: unknown) => e)) as UploadError;
    expect(invalid.code).toBe('local.invalid_response');
    const offline = new InstanceUploadTransport({ connection: 'drive', fetch: async () => Promise.reject(new TypeError('fetch failed')) });
    const net = (await offline.listParts(ref).catch((e: unknown) => e)) as UploadError;
    expect(net.code).toBe('local.network');
    expect(net.retryable).toBe(true);
  });

  it('dossier vide : marqueur PUT …/object?key=…/, déjà présent = succès ; téléchargement', async () => {
    const { fn, calls } = fakeFetch([
      { status: 409, body: { error: 'already_exists', message: 'Folder exists', details: { reason: 'folder_exists' } } },
      { status: 200, body: { url: 'https://s3/get', expiresAt, transport: 'direct' } },
    ]);
    const t = new InstanceUploadTransport({ connection: 'drive', fetch: fn });
    await t.createFolder('home', 'Photos/Vide');
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/v1/c/drive/b/home/object?key=Photos%2FVide%2F' });
    expect(await t.download('home', 'a b.pdf', { filename: 'a b.pdf' })).toEqual({ url: 'https://s3/get', expiresAt, transport: 'direct' });
    expect(calls[1]!.url).toBe('/api/v1/c/drive/b/home/download?key=a+b.pdf&disposition=attachment&filename=a+b.pdf');
    expect(t.downloadHref('home', 'x.txt')).toBe('/api/v1/c/drive/b/home/download?key=x.txt&disposition=attachment&redirect=1');
  });
});

describe('noms', () => {
  it('nextFreeName : (1), (2)…, extensions composées, noms à point, suffixe existant', () => {
    expect(nextFreeName('a.txt', ['a.txt'])).toBe('a (1).txt');
    expect(nextFreeName('a.txt', ['a.txt', 'a (1).txt'])).toBe('a (2).txt');
    expect(nextFreeName('b.tar.gz', ['b.tar.gz'])).toBe('b (1).tar.gz');
    expect(nextFreeName('.env', ['.env'])).toBe('.env (1)');
    expect(nextFreeName('c (3).pdf', ['c (3).pdf'])).toBe('c (4).pdf');
    expect(nextFreeName('libre.txt', ['autre'])).toBe('libre.txt');
    expect([...freeNameCandidates('Dossier/')].slice(0, 2)).toEqual(['Dossier (1)/', 'Dossier (2)/']);
  });

  it('joinKey : NFC par segment, séparateur /', () => {
    const nfd = 'été';
    expect(joinKey('Docs/', `${nfd}/a.txt`)).toBe('Docs/été/a.txt');
    expect(joinKey('', 'a//b')).toBe('a/b');
    expect(joinKey('Docs', 'x')).toBe('Docs/x');
  });

  it('fichiers système ignorés', () => {
    expect(isIgnoredPath('Photos/.DS_Store')).toBe(true);
    expect(isIgnoredPath('Thumbs.db')).toBe(true);
    expect(isIgnoredPath('Docs/~$rapport.docx')).toBe(true);
    expect(isIgnoredPath('x/._a.jpg')).toBe(true);
    expect(isIgnoredPath('.Trashes/a')).toBe(true);
    expect(isIgnoredPath('Docs/rapport.docx')).toBe(false);
  });
});

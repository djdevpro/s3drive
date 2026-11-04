import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeSecretKey } from '../src/crypto.js';
import { migrate, openDatabase } from '../src/db.js';
import { parseInstanceConfig } from '../src/instance/config.js';
import { cleanup } from '../src/instance/maintenance.js';
import { type InstanceRuntime, createInstanceRuntime } from '../src/instance/runtime.js';
import { Browser } from './fakes/browser.js';
import { FakeOidc } from './fakes/fake-oidc.js';
import { FakeS3, fakeS3Factory } from './fakes/fake-s3.js';
import { BASE_YAML } from './fixtures.js';

// Parcours de bout en bout du mode instance : faux fournisseur OIDC (HTTP réel) et faux S3 en mémoire.

import { PUBLIC_URL } from './fakes/browser.js';
const CLIENT = { clientId: 'drive', clientSecret: 'client-secret-for-tests' };
const MiB = 1024 * 1024;

describe('instance mode end to end', () => {
  let oidc: FakeOidc;
  let s3: FakeS3;
  let db: DatabaseSync;
  let rt: InstanceRuntime;
  let app: Hono;
  let now = Date.now();
  let dir: string;

  async function login(browser: Browser, sub: string, next = '/d/drive/b/home/'): Promise<string> {
    oidc.currentSub = sub;
    const start = await browser.request(`/api/v1/auth/oidc/login?next=${encodeURIComponent(next)}`);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location')!);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${PUBLIC_URL}/api/v1/auth/oidc/callback`);
    expect(authorize.searchParams.get('nonce')).toBeTruthy();
    const idp = await fetch(authorize, { redirect: 'manual' });
    expect(idp.status).toBe(302);
    const callback = new URL(idp.headers.get('location')!);
    const done = await browser.request(callback.pathname + callback.search);
    expect(done.status).toBe(302);
    return done.headers.get('location')!;
  }

  async function acceptTerms(browser: Browser): Promise<void> {
    expect((await browser.request('/api/v1/me/terms', { method: 'POST', body: { version: '2026-11-03' } })).status).toBe(204);
  }

  beforeAll(async () => {
    oidc = new FakeOidc(CLIENT);
    const issuer = await oidc.start();
    oidc.addUser({ sub: 'alice', email: 'alice@example.com', name: 'Alice', roles: ['user'] });
    oidc.addUser({ sub: 'bob', email: 'bob@example.com', name: 'Bob', roles: ['user'] });
    oidc.addUser({ sub: 'carol', email: 'carol@example.com', name: 'Carol', roles: ['admin'] });
    oidc.addUser({ sub: 'dave', email: 'dave@example.com', name: 'Dave', roles: ['viewer-only'] });
    dir = mkdtempSync(join(tmpdir(), 'ud-instance-'));
    const terms = join(dir, 'terms.md');
    writeFileSync(terms, '# Conditions\n\nSoyez sages.');
    const env = loadConfig({ UD_MODE: 'instance', UD_PUBLIC_URL: PUBLIC_URL, UD_TERMS_FILE: terms, UD_DATA_DIR: dir, UD_IP_MODE: 'full' });
    const config = parseInstanceConfig(BASE_YAML, {
      env: { UD_OIDC_ISSUER: issuer, UD_OIDC_CLIENT_ID: CLIENT.clientId, UD_OIDC_CLIENT_SECRET: CLIENT.clientSecret, UD_S3_ACCESS_KEY_ID: 'AKIA', UD_S3_SECRET_ACCESS_KEY: 's3-secret-for-tests' },
    });
    s3 = new FakeS3();
    db = openDatabase(':memory:');
    migrate(db);
    const factory = fakeS3Factory(s3);
    rt = createInstanceRuntime({ mode: 'instance', config, env, key: makeSecretKey(randomBytes(32)), db, s3Factory: factory, clock: () => now, allowInsecureOidc: true });
    expect(factory.created[0]!.credentials.secretAccessKey).toBe('s3-secret-for-tests');
    app = createApp({ db, instance: rt });
  });

  afterAll(async () => {
    await oidc.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('describes the instance publicly and hides /connect', async () => {
    const res = await app.request('/api/v1/instance');
    expect(await res.json()).toEqual({ mode: 'instance', connection: 'drive', name: 'Drive test', login: { label: '127.0.0.1:' + new URL(oidc.issuer).port }, personal: false });
    const connect = await app.request('/api/v1/auth/connect', { method: 'POST' });
    expect(connect.status).toBe(404);
    expect(await connect.json()).toMatchObject({ error: 'not_found' });
    expect((await app.request('/api/v1/me')).status).toBe(401);
  });

  const alice = () => browsers.alice!;
  const browsers: Record<string, Browser> = {};

  it('logs in with code + PKCE, then requires the terms', async () => {
    browsers.alice = new Browser(app);
    expect(await login(alice(), 'alice')).toBe('/d/drive/b/home/');
    expect(alice().cookies.has('ud_sid')).toBe(true);
    expect(alice().cookies.has('ud_oidc')).toBe(false);
    const token = oidc.tokenRequests.at(-1)!;
    expect(token['grant_type']).toBe('authorization_code');
    expect(token['code_verifier']).toBeTruthy();

    const me = await alice().json('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { email: 'alice@example.com', name: 'Alice', roles: ['user'] }, connection: 'drive', superAdmin: false, terms: { required: true, version: '2026-11-03', url: '/api/v1/me/terms' } });
    expect(me.body.quota).toEqual({ limit: 1e9, used: 0, reserved: 0 });

    const blocked = await alice().json('/api/v1/c/drive/buckets');
    expect(blocked).toMatchObject({ status: 403, body: { error: 'forbidden', details: { reason: 'terms_required' } } });
    const text = await alice().json('/api/v1/me/terms');
    expect(text.body.markdown).toContain('Soyez sages');
    expect((await alice().request('/api/v1/me/terms', { method: 'POST', body: { version: 'old' } })).status).toBe(409);
    await acceptTerms(alice());

    const buckets = await alice().json('/api/v1/c/drive/buckets');
    expect(buckets.status).toBe(200);
    expect(buckets.body.items.map((b: any) => [b.name, b.scopes])).toEqual([
      ['home', ['read', 'write', 'delete', 'share']],
      ['commun', ['read']],
    ]);
    expect(buckets.body.items[1]).toMatchObject({ kind: 'space', label: { fr: 'Commun', en: 'Shared' }, quota: 50e9 });

    // Secrets jamais en clair dans la base.
    const row = db.prepare('SELECT * FROM session').get() as Record<string, string>;
    expect(row['refresh_enc']).toMatch(/^v1\./);
    expect(row['secret_hash']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db.prepare('SELECT * FROM session').all())).not.toContain(alice().cookies.get('ud_sid')!.split('.')[1]!);
  });

  it('lists an empty home, refuses CSRF-less writes and confined keys', async () => {
    const list = await alice().json('/api/v1/c/drive/b/home/objects');
    expect(list).toEqual({ status: 200, body: { items: [], nextCursor: null, prefix: '', partial: false } });
    const csrf = await alice().json('/api/v1/c/drive/b/home/object?key=new/', { method: 'PUT', headers: { 'x-ud': '0' } });
    expect(csrf).toMatchObject({ status: 403, body: { error: 'csrf', details: { reason: 'missing_header' } } });
    const origin = await alice().json('/api/v1/c/drive/b/home/object?key=new/', { method: 'PUT', headers: { origin: 'https://evil.example' } });
    expect(origin.body.details.reason).toBe('origin_mismatch');
    for (const key of ['../x', '/x', 'a/./b', 'a//b']) {
      const res = await alice().json(`/api/v1/c/drive/b/home/object?key=${encodeURIComponent(key)}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation');
    }
    expect((await alice().json('/api/v1/c/drive/b/nope/objects')).body.error).toBe('bucket_not_found');
    expect((await alice().json('/api/v1/c/other/buckets')).status).toBe(404);
    const write = await alice().json('/api/v1/c/drive/b/commun/object?key=x/', { method: 'PUT' });
    expect(write).toMatchObject({ status: 403, body: { error: 'scope_denied' } });
  });

  it('refuses an upload over the quota before any S3 call', async () => {
    const before = s3.calls.length;
    const res = await alice().json('/api/v1/c/drive/b/home/uploads?key=big.iso', { method: 'POST', body: { size: 2e9, mode: 'auto' } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'quota_exceeded', details: { limit: 'user_quota', remaining: 1e9 } });
    expect(s3.calls.slice(before).filter((c) => c !== 'headObject')).toEqual([]);
  });

  it('accepts a single PUT within the quota, with a signed length, and updates usage and the upload log', async () => {
    const size = 5_000_000;
    const created = await alice().json('/api/v1/c/drive/b/home/uploads?key=Documents/rapport.pdf', { method: 'POST', body: { size, contentType: 'application/pdf', mode: 'auto' } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ mode: 'single', key: 'Documents/rapport.pdf', transport: 'direct' });
    expect(created.body.headers['content-length']).toBe(String(size));
    expect((await alice().json('/api/v1/me')).body.quota).toEqual({ limit: 1e9, used: 0, reserved: size });
    expect(() => s3.fulfill(created.body, size + 1)).toThrow();
    s3.fulfill(created.body, size);
    const bad = await alice().json('/api/v1/c/drive/b/home/uploads/confirm', { method: 'POST', body: { items: [{ key: 'Documents/rapport.pdf', receipt: '9999999999.forged', size }] } });
    expect(bad.body.results[0]).toMatchObject({ ok: false, error: { error: 'validation', details: { reason: 'invalid_receipt' } } });
    const confirm = await alice().json('/api/v1/c/drive/b/home/uploads/confirm', { method: 'POST', body: { items: [{ key: 'Documents/rapport.pdf', receipt: created.body.receipt, size }] } });
    expect(confirm.body.results).toEqual([{ key: 'Documents/rapport.pdf', ok: true, verified: true }]);
    // Une confirmation rejouée ne compte pas deux fois.
    await alice().json('/api/v1/c/drive/b/home/uploads/confirm', { method: 'POST', body: { items: [{ key: 'Documents/rapport.pdf', receipt: created.body.receipt, size }] } });
    expect((await alice().json('/api/v1/me')).body.quota).toEqual({ limit: 1e9, used: size, reserved: 0 });
    const log = db.prepare('SELECT * FROM upload_log').all() as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ space_id: 'home', key: 'Documents/rapport.pdf', size, content_type: 'application/pdf', source: 'web' });
  });

  it('runs a multipart upload with signed part lengths', async () => {
    const size = 20 * MiB;
    const created = await alice().json('/api/v1/c/drive/b/home/uploads?key=video.mp4', { method: 'POST', body: { size, mode: 'multipart' } });
    expect(created.body).toMatchObject({ mode: 'multipart', partSize: 8 * MiB, partCount: 3 });
    const parts = created.body.parts as Array<{ partNumber: number; url: string; headers: Record<string, string> }>;
    expect(parts.map((p) => Number(p.headers['content-length']))).toEqual([8 * MiB, 8 * MiB, 4 * MiB]);
    const wrong = await alice().json(`/api/v1/c/drive/b/home/uploads/${created.body.uploadId}/parts?key=video.mp4`, { method: 'POST', body: { parts: [{ partNumber: 3, size: 8 * MiB }] } });
    expect(wrong.body.details.reason).toBe('part_size');
    for (const p of parts) s3.fulfill(p, Number(p.headers['content-length']));
    const listed = await alice().json(`/api/v1/c/drive/b/home/uploads/${created.body.uploadId}/parts?key=video.mp4`);
    expect(listed.body.items).toHaveLength(3);
    const mismatch = await alice().json(`/api/v1/c/drive/b/home/uploads/${created.body.uploadId}/complete?key=video.mp4`, { method: 'POST', body: { size: size + 1 } });
    expect(mismatch.body).toMatchObject({ error: 'invalid_request', details: { reason: 'size_mismatch' } });
    const done = await alice().json(`/api/v1/c/drive/b/home/uploads/${created.body.uploadId}/complete?key=video.mp4`, { method: 'POST', body: { size } });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ key: 'video.mp4', size });
    expect((await alice().json('/api/v1/me')).body.quota.used).toBe(5_000_000 + size);
    expect(db.prepare('SELECT COUNT(*) AS n FROM upload_log').get()).toEqual({ n: 2 });
  });

  it('aborts a multipart upload and frees the reservation', async () => {
    const created = await alice().json('/api/v1/c/drive/b/home/uploads?key=abandon.bin', { method: 'POST', body: { size: 30 * MiB } });
    expect((await alice().json('/api/v1/me')).body.quota.reserved).toBe(30 * MiB);
    expect((await alice().request(`/api/v1/c/drive/b/home/uploads/${created.body.uploadId}?key=abandon.bin`, { method: 'DELETE' })).status).toBe(204);
    expect((await alice().json('/api/v1/me')).body.quota.reserved).toBe(0);
  });

  it('lists, creates folders, renames, moves, copies, downloads and deletes with relative keys only', async () => {
    expect((await alice().json('/api/v1/c/drive/b/home/object?key=Archives/', { method: 'PUT' })).status).toBe(201);
    expect((await alice().json('/api/v1/c/drive/b/home/object?key=Archives/', { method: 'PUT' })).body.details.reason).toBe('folder_exists');
    const root = await alice().json('/api/v1/c/drive/b/home/objects');
    expect(root.body.items.map((i: any) => `${i.kind}:${i.key}`)).toEqual(['folder:Archives/', 'folder:Documents/', 'file:video.mp4']);
    const serialized = JSON.stringify(root.body);
    expect(serialized).not.toContain('users/');
    expect(serialized).not.toContain('drive-test');

    const renamed = await alice().json('/api/v1/c/drive/b/home/object/rename?key=video.mp4', { method: 'POST', body: { newName: 'film.mp4' } });
    expect(renamed.body).toMatchObject({ bucket: 'home', key: 'film.mp4', objects: 1 });
    const moved = await alice().json('/api/v1/c/drive/b/home/object/move?key=Documents/', { method: 'POST', body: { destination: { key: 'Archives/Documents/' } } });
    expect(moved.body).toMatchObject({ key: 'Archives/Documents/', objects: 1 });
    const into = await alice().json('/api/v1/c/drive/b/home/object/move?key=Archives/', { method: 'POST', body: { destination: { key: 'Archives/sub/' } } });
    expect(into.body.details.reason).toBe('move_into_self');
    const copy = await alice().json('/api/v1/c/drive/b/home/object/copy?key=film.mp4', { method: 'POST', body: { destination: { key: 'film.mp4' }, conflict: 'rename' } });
    expect(copy.status).toBe(400); // même clé
    const copy2 = await alice().json('/api/v1/c/drive/b/home/object/copy?key=film.mp4', { method: 'POST', body: { destination: { key: 'Archives/film.mp4' } } });
    expect(copy2.body.objects).toBe(1);
    const again = await alice().json('/api/v1/c/drive/b/home/object/copy?key=film.mp4', { method: 'POST', body: { destination: { key: 'Archives/film.mp4' }, conflict: 'rename' } });
    expect(again.body.key).toBe('Archives/film (1).mp4');
    const toShared = await alice().json('/api/v1/c/drive/b/home/object/copy?key=film.mp4', { method: 'POST', body: { destination: { bucket: 'commun', key: 'film.mp4' } } });
    expect(toShared.body.error).toBe('scope_denied');
    expect((await alice().json('/api/v1/me')).body.quota.used).toBe(5_000_000 + 3 * 20 * MiB);

    const details = await alice().json('/api/v1/c/drive/b/home/object?key=Archives/Documents/rapport.pdf');
    expect(details.body).toMatchObject({ kind: 'file', bucket: 'home', key: 'Archives/Documents/rapport.pdf', size: 5_000_000 });
    const dl = await alice().json('/api/v1/c/drive/b/home/download?key=film.mp4&disposition=inline');
    expect(dl.body.transport).toBe('direct');
    expect(new Date(dl.body.expiresAt).getTime() - now).toBe(15 * 60 * 1000);
    const redirect = await alice().request('/api/v1/c/drive/b/home/download?key=film.mp4&redirect=1');
    expect(redirect.status).toBe(302);

    const del = await alice().json('/api/v1/c/drive/b/home/object?key=Archives/', { method: 'DELETE' });
    expect(del.body.deleted).toBe(4);
    expect((await alice().json('/api/v1/me')).body.quota.used).toBe(20 * MiB);
    expect((await alice().json('/api/v1/c/drive/b/home/object?key=Archives/film.mp4')).status).toBe(404);
  });

  it('paginates with an opaque cursor bound to the principal', async () => {
    for (let i = 0; i < 3; i++) await alice().json(`/api/v1/c/drive/b/home/object?key=p${i}/`, { method: 'PUT' });
    const first = await alice().json('/api/v1/c/drive/b/home/objects?limit=2');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.partial).toBe(true);
    expect(first.body.nextCursor).not.toContain('users');
    const second = await alice().json(`/api/v1/c/drive/b/home/objects?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    const other = await alice().json(`/api/v1/c/drive/b/home/objects?limit=2&prefix=p0/&cursor=${first.body.nextCursor}`);
    expect(other.body.details.reason).toBe('invalid_cursor');
  });

  it('isolates two people (404) and lets the super admin space list work', async () => {
    browsers.bob = new Browser(app);
    await login(browsers.bob, 'bob');
    await acceptTerms(browsers.bob);
    const peek = await browsers.bob.json('/api/v1/c/drive/b/home/object?key=film.mp4');
    expect(peek).toMatchObject({ status: 404, body: { error: 'key_not_found' } });
    expect((await browsers.bob.json('/api/v1/c/drive/b/home/objects')).body.items).toEqual([]);
    expect((await browsers.bob.json('/api/v1/c/drive/b/home/download?key=film.mp4')).status).toBe(404);
  });

  it('refuses a person without a Drive role (no_role) and creates no user row', async () => {
    const dave = new Browser(app);
    expect(await login(dave, 'dave')).toBe('/login?error=no_role');
    expect(dave.cookies.has('ud_sid')).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user WHERE subject = 'dave'").get()).toEqual({ n: 0 });
  });

  it('keeps the role snapshot while the IdP is briefly down, then reports idp_unreachable', async () => {
    browsers.carol = new Browser(app);
    await login(browsers.carol, 'carol', '/admin');
    await acceptTerms(browsers.carol);
    oidc.down = true;
    now += 301_000;
    expect((await browsers.carol.json('/api/v1/me')).status).toBe(200);
    now += 15 * 60_000;
    const down = await browsers.carol.json('/api/v1/me');
    expect(down).toMatchObject({ status: 401, body: { error: 'unauthorized', details: { reason: 'idp_unreachable' } } });
    oidc.down = false;
    const back = await browsers.carol.json('/api/v1/me');
    expect(back.status).toBe(200);
    expect(back.body.user.roles).toEqual(['admin']);
    expect(oidc.tokenRequests.at(-1)!['grant_type']).toBe('refresh_token');
  });

  it('ends the session when the role is removed at the provider (session_ended)', async () => {
    oidc.setRoles('alice', []);
    // Alice et Bob rafraîchissent : Bob garde son rôle, Alice le perd.
    now += 301_000;
    expect((await browsers.bob!.json('/api/v1/me')).status).toBe(200);
    const ended = await alice().json('/api/v1/me');
    expect(ended).toMatchObject({ status: 401, body: { details: { reason: 'session_ended' } } });
    expect((await alice().json('/api/v1/me')).status).toBe(401);
    oidc.setRoles('alice', ['user']);
  });

  it('lets an admin list people, change a quota, recount, and suspend someone whose session drops at once', async () => {
    const carol = browsers.carol!;
    const list = await carol.json('/api/v1/admin/users?sort=email');
    expect(list.status).toBe(200);
    expect(list.body.items.map((u: any) => u.email)).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com']);
    const aliceRow = list.body.items[0];
    expect(aliceRow.quota).toMatchObject({ limit: 1e9, used: 20 * MiB });
    expect((await carol.json('/api/v1/admin/users?q=bob')).body.items).toHaveLength(1);
    const page = await carol.json('/api/v1/admin/users?limit=2');
    expect(page.body.nextCursor).toBeTruthy();
    expect((await carol.json(`/api/v1/admin/users?limit=2&cursor=${page.body.nextCursor}`)).body.items).toHaveLength(1);

    const quota = await carol.json(`/api/v1/admin/users/${aliceRow.id}`, { method: 'PATCH', body: { quotaOverride: 2e9 } });
    expect(quota.body.quota.limit).toBe(2e9);
    s3.seed('drive-test', `users/${aliceRow.id}/extra.bin`, 1000);
    const recount = await carol.json(`/api/v1/admin/users/${aliceRow.id}/recount`, { method: 'POST' });
    expect(recount.body.quota.used).toBe(20 * MiB + 1000);

    const bob = list.body.items[1];
    expect((await browsers.bob!.json('/api/v1/me')).status).toBe(200);
    const suspend = await carol.json(`/api/v1/admin/users/${bob.id}`, { method: 'PATCH', body: { status: 'suspended' } });
    expect(suspend.body.status).toBe('suspended');
    expect((await browsers.bob!.json('/api/v1/me')).status).toBe(401);
    expect(await login(new Browser(app), 'bob')).toBe('/login?error=suspended');
    expect((await carol.json(`/api/v1/admin/users/${list.body.items[2].id}`, { method: 'PATCH', body: { status: 'suspended' } })).body.details.reason).toBe('self');

    // Une personne sans droit d'administration est refusée.
    const alice2 = new Browser(app);
    await login(alice2, 'alice');
    expect((await alice2.json('/api/v1/admin/users')).status).toBe(403);
    const actions = (db.prepare("SELECT action FROM audit_log WHERE action LIKE 'admin.%' ORDER BY id").all() as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toEqual(['admin.set_quota', 'admin.recount_usage', 'admin.suspend_user']);
  });

  it('logs out with the provider end-session URL', async () => {
    const carol = browsers.carol!;
    const res = await carol.json('/api/v1/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    const url = new URL(res.body.endSessionUrl);
    expect(url.pathname).toMatch(/logout$/);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(`${PUBLIC_URL}/login`);
    expect(url.searchParams.get('id_token_hint')).toBeTruthy();
    expect(carol.cookies.has('ud_sid')).toBe(false);
    expect((await carol.json('/api/v1/me')).status).toBe(401);
  });

  it('frees abandoned reservations in the periodic cleanup', async () => {
    const b = new Browser(app);
    await login(b, 'alice');
    await b.json('/api/v1/c/drive/b/home/uploads?key=late.bin', { method: 'POST', body: { size: 1000 } });
    const owner = (db.prepare("SELECT id FROM user WHERE subject = 'alice'").get() as { id: string }).id;
    expect(rt.usage.get('home', owner).reserved).toBe(1000);
    now += 3 * 3600_000;
    await cleanup(rt);
    expect(rt.usage.get('home', owner).reserved).toBe(0);
  });
});

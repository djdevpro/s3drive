import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeSecretKey } from '../src/crypto.js';
import { migrate, openDatabase } from '../src/db.js';
import { parseInstanceConfig } from '../src/instance/config.js';
import { createInstanceRuntime, type InstanceRuntime } from '../src/instance/runtime.js';
import { Browser, PUBLIC_URL, login } from './fakes/browser.js';
import { FakeOidc } from './fakes/fake-oidc.js';
import { BASE_YAML } from './fixtures.js';

// Essai contre le RustFS de compose.dev.yaml avec le vrai moteur @ud/s3 (opt-in : UD_TEST_RUSTFS=1).
// Crée un bucket de test dédié, puis le vide et le supprime. Jamais un bucket réel.

const ENDPOINT = process.env['UD_TEST_RUSTFS_ENDPOINT'] ?? 'http://127.0.0.1:9000';
const ACCESS = process.env['UD_DEV_S3_ACCESS_KEY'] ?? 'udadmin';
const SECRET = process.env['UD_DEV_S3_SECRET_KEY'] ?? 'udadmin-dev-secret';
const BUCKET = `ud-test-lotb-${randomBytes(4).toString('hex')}`;
const MiB = 1024 * 1024;

describe.skipIf(!process.env['UD_TEST_RUSTFS'])('instance mode against RustFS', () => {
  let oidc: FakeOidc;
  let db: DatabaseSync;
  let rt: InstanceRuntime;
  let app: Hono;
  // Client d'administration du test seulement (création et suppression du bucket de test).
  let admin: import('@aws-sdk/client-s3').S3Client;
  let sdk: typeof import('@aws-sdk/client-s3');

  beforeAll(async () => {
    sdk = await import('@aws-sdk/client-s3');
    admin = new sdk.S3Client({ endpoint: ENDPOINT, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET } });
    await admin.send(new sdk.CreateBucketCommand({ Bucket: BUCKET }));
    oidc = new FakeOidc({ clientId: 'drive', clientSecret: 'cs' });
    const issuer = await oidc.start();
    oidc.addUser({ sub: 'alice', email: 'a@example.com', roles: ['user'] });
    const yaml = BASE_YAML.replace('https://s3.example.com', ENDPOINT).replaceAll('drive-test', BUCKET).replace(/legal:[\s\S]*$/, '');
    const config = parseInstanceConfig(yaml, {
      env: { UD_OIDC_ISSUER: issuer, UD_OIDC_CLIENT_ID: 'drive', UD_OIDC_CLIENT_SECRET: 'cs', UD_S3_ACCESS_KEY_ID: ACCESS, UD_S3_SECRET_ACCESS_KEY: SECRET },
      allowPrivateEndpoints: true,
    });
    db = openDatabase(':memory:');
    migrate(db);
    const env = loadConfig({ UD_MODE: 'instance', UD_PUBLIC_URL: PUBLIC_URL, UD_ALLOW_PRIVATE_ENDPOINTS: '1' });
    rt = createInstanceRuntime({ mode: 'instance', config, env, key: makeSecretKey(randomBytes(32)), db, allowInsecureOidc: true });
    app = createApp({ db, instance: rt });
  });

  afterAll(async () => {
    try {
      const listed = await admin.send(new sdk.ListObjectsV2Command({ Bucket: BUCKET }));
      for (const o of listed.Contents ?? []) await admin.send(new sdk.DeleteObjectCommand({ Bucket: BUCKET, Key: o.Key! }));
      const uploads = await admin.send(new sdk.ListMultipartUploadsCommand({ Bucket: BUCKET }));
      for (const u of uploads.Uploads ?? []) await admin.send(new sdk.AbortMultipartUploadCommand({ Bucket: BUCKET, Key: u.Key!, UploadId: u.UploadId! }));
      await admin.send(new sdk.DeleteBucketCommand({ Bucket: BUCKET }));
    } finally {
      rt?.storages.destroy();
      admin?.destroy();
      await oidc?.stop();
      db?.close();
    }
  });

  it('uploads (PUT and multipart), lists, copies, downloads and deletes', async () => {
    const b = new Browser(app);
    expect(await login(b, oidc, 'alice')).toBe('/d/drive/b/home/');

    const small = Buffer.alloc(1000, 1);
    const single = await b.json('/api/v1/c/drive/b/home/uploads?key=docs/a.txt', { method: 'POST', body: { size: small.length, contentType: 'text/plain' } });
    expect(single.status).toBe(201);
    const put = await fetch(single.body.url, { method: 'PUT', headers: single.body.headers, body: small });
    expect(put.status).toBe(200);
    const wrong = await fetch(single.body.url, { method: 'PUT', headers: { ...single.body.headers, 'content-length': '999' }, body: small.subarray(0, 999) }).catch(() => null);
    expect(wrong?.ok ?? false).toBe(false);
    const confirm = await b.json('/api/v1/c/drive/b/home/uploads/confirm', { method: 'POST', body: { items: [{ key: 'docs/a.txt', receipt: single.body.receipt, size: small.length }] } });
    expect(confirm.body.results[0].ok).toBe(true);

    const bigSize = 12 * MiB;
    const multi = await b.json('/api/v1/c/drive/b/home/uploads?key=big.bin', { method: 'POST', body: { size: bigSize, mode: 'multipart' } });
    expect(multi.status).toBe(201);
    for (const part of multi.body.parts) {
      const len = Number(part.headers['content-length']);
      const res = await fetch(part.url, { method: 'PUT', headers: part.headers, body: Buffer.alloc(len, 2) });
      expect(res.status).toBe(200);
    }
    const done = await b.json(`/api/v1/c/drive/b/home/uploads/${multi.body.uploadId}/complete?key=big.bin`, { method: 'POST', body: { size: bigSize } });
    expect(done.status).toBe(200);
    expect(done.body.size).toBe(bigSize);

    const me = await b.json('/api/v1/me');
    expect(me.body.quota.used).toBe(1000 + bigSize);
    const list = await b.json('/api/v1/c/drive/b/home/objects');
    expect(list.body.items.map((i: { key: string }) => i.key).sort()).toEqual(['big.bin', 'docs/']);
    expect(JSON.stringify(list.body)).not.toContain(BUCKET);

    const copy = await b.json('/api/v1/c/drive/b/home/object/copy?key=docs/a.txt', { method: 'POST', body: { destination: { key: 'docs/b.txt' } } });
    expect(copy.status).toBe(200);
    const dl = await b.json('/api/v1/c/drive/b/home/download?key=docs/b.txt');
    const body = await (await fetch(dl.body.url)).arrayBuffer();
    expect(body.byteLength).toBe(1000);

    expect((await b.json('/api/v1/c/drive/b/home/object?key=docs/', { method: 'DELETE' })).body.deleted).toBe(2);
    expect((await b.json('/api/v1/c/drive/b/home/object?key=big.bin', { method: 'DELETE' })).body.deleted).toBe(1);
    expect((await b.json('/api/v1/me')).body.quota.used).toBe(0);
  });
});

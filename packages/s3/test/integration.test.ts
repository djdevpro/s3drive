/**
 * Tests d'intégration contre le S3 local de compose.dev.yaml (RustFS, http://127.0.0.1:9000).
 * Sautés proprement si RustFS ne répond pas. Chaque exécution crée un bucket `ud-it-<aléa>`
 * et le supprime à la fin ; aucun autre bucket n'est touché.
 */
import { randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3, S3Error, type FileItem, type ListPage, type UdS3 } from '../src/index.js';

const ENDPOINT = process.env.UD_IT_S3_ENDPOINT ?? 'http://127.0.0.1:9000';
// Identifiants par défaut du S3 local de développement (compose.dev.yaml), surchargeables.
const credentials = {
  accessKeyId: process.env.UD_DEV_S3_ACCESS_KEY ?? 'udadmin',
  secretAccessKey: process.env.UD_DEV_S3_SECRET_KEY ?? 'udadmin-dev-secret',
};
const MIB = 1024 * 1024;

async function rustfsReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${ENDPOINT}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

const reachable = await rustfsReachable();
const bucket = `ud-it-${randomBytes(4).toString('hex')}`;

describe.skipIf(!reachable)('intégration RustFS', () => {
  let s3: UdS3;
  let admin: S3Client;

  async function put(key: string, body: string | Uint8Array, extra: { contentType?: string; metadata?: Record<string, string> } = {}) {
    await admin.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ...(extra.contentType ? { ContentType: extra.contentType } : {}),
        ...(extra.metadata ? { Metadata: extra.metadata } : {}),
      }),
    );
  }

  async function sendSigned(request: { url: string; method: string; headers: Record<string, string> }, body?: Uint8Array | string) {
    return fetch(request.url, { method: request.method, headers: request.headers, ...(body !== undefined ? { body } : {}) });
  }

  async function expectS3Error(promise: Promise<unknown>, code: string, reason?: string) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(S3Error);
    expect((error as S3Error).code).toBe(code);
    if (reason) expect((error as S3Error).reason).toBe(reason);
  }

  beforeAll(async () => {
    admin = new S3Client({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    s3 = createS3({ endpoint: ENDPOINT, region: 'us-east-1', addressing: 'path', credentials, allowPrivate: true, provider: 'rustfs' });
  });

  afterAll(async () => {
    s3?.destroy();
    if (!admin) return;
    // Nettoyage : envois en cours, objets, puis le bucket de test.
    try {
      const uploads = await admin.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
      for (const upload of uploads.Uploads ?? []) {
        await admin.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: upload.Key!, UploadId: upload.UploadId! }));
      }
    } catch {
      // ignoré
    }
    let token: string | undefined;
    do {
      const page = await admin.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
      for (const entry of page.Contents ?? []) await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.Key! }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
    admin.destroy();
  });

  it('headBucket : bucket présent, bucket absent', async () => {
    await s3.headBucket({ bucket });
    await expectS3Error(s3.headBucket({ bucket: `${bucket}-missing` }), 'bucket_not_found');
  });

  it('liste avec dossiers, marqueur masqué, noms décodés et pagination', async () => {
    await s3.putEmpty({ bucket, key: 'docs/' });
    await s3.putEmpty({ bucket, key: 'docs/empty/' });
    await put('docs/a.txt', 'a');
    await put('docs/b b+c%.txt', 'bb');
    await put('docs/été 🌞.txt', 'ccc');
    await put('docs/sub/x.txt', 'xxxx');
    await put('docs/sub/deep/y.txt', 'yyyyy');

    const all: ListPage['items'] = [];
    let cursor: string | null = null;
    let pages = 0;
    let markerSeen = false;
    do {
      const page: ListPage = await s3.listObjects({ bucket, prefix: 'docs/', cursor, limit: 2 });
      pages += 1;
      markerSeen ||= page.folderMarker === true;
      // Dans chaque page : dossiers d'abord.
      const firstFile = page.items.findIndex((item) => item.type === 'file');
      if (firstFile !== -1) expect(page.items.slice(firstFile).every((item) => item.type === 'file')).toBe(true);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && pages < 10);

    expect(pages).toBeGreaterThan(1);
    expect(markerSeen).toBe(true);
    expect(all.find((item) => item.key === 'docs/')).toBeUndefined();
    expect(all.filter((item) => item.type === 'folder').map((item) => item.key).sort()).toEqual(['docs/empty/', 'docs/sub/']);
    const files = all.filter((item): item is FileItem => item.type === 'file');
    expect(files.map((item) => item.key).sort()).toEqual(['docs/a.txt', 'docs/b b+c%.txt', 'docs/été 🌞.txt'].sort());
    const special = files.find((item) => item.key === 'docs/été 🌞.txt')!;
    expect(special).toMatchObject({ name: 'été 🌞.txt', size: Buffer.byteLength('ccc') });
    expect(special.etag).not.toMatch(/"/);
    expect(new Date(special.lastModified).getTime()).toBeGreaterThan(0);

    // Liste récursive : tout le sous-arbre, marqueurs comme dossiers.
    const recursive = await s3.listObjects({ bucket, prefix: 'docs/', delimiter: null });
    expect(recursive.items.map((item) => item.key)).toEqual(
      expect.arrayContaining(['docs/empty/', 'docs/sub/x.txt', 'docs/sub/deep/y.txt']),
    );

    await expectS3Error(s3.listObjects({ bucket, prefix: 'docs/', cursor: 'bogus!' }), 'validation', 'invalid_cursor');
  });

  it('headObject : métadonnées, type, absent', async () => {
    await put('meta/h.txt', 'hello', { contentType: 'text/plain', metadata: { owner: 'alice' } });
    const head = await s3.headObject({ bucket, key: 'meta/h.txt' });
    expect(head).toMatchObject({ key: 'meta/h.txt', size: 5, contentType: 'text/plain', metadata: { owner: 'alice' } });
    expect(head.etag).toMatch(/^[0-9a-f]{32}$/);
    await expectS3Error(s3.headObject({ bucket, key: 'meta/missing.txt' }), 'key_not_found');
  });

  it('PUT présigné : réussi à la longueur signée, refusé à une autre longueur', async () => {
    const body = 'exactly-sixteen!';
    const signed = await s3.presignPut({ bucket, key: 'up/put.txt', expiresIn: 300, contentLength: body.length, contentType: 'text/plain' });
    expect(signed.method).toBe('PUT');
    expect(signed.headers).toEqual({ 'content-length': String(body.length), 'content-type': 'text/plain' });
    const signedHeaders = new URL(signed.url).searchParams.get('X-Amz-SignedHeaders');
    expect(signedHeaders).toBe('content-length;content-type;host');
    expect(signed.url).not.toContain(credentials.secretAccessKey);

    const ok = await sendSigned(signed, body);
    expect(ok.status).toBe(200);
    expect((await s3.headObject({ bucket, key: 'up/put.txt' })).size).toBe(body.length);

    const wrong = await s3.presignPut({ bucket, key: 'up/wrong.txt', expiresIn: 300, contentLength: 4, contentType: 'text/plain' });
    // fetch calcule lui-même Content-Length d'après le corps : 10 octets au lieu des 4 signés.
    const { 'content-length': _ignored, ...headersWithoutLength } = wrong.headers;
    const refused = await fetch(wrong.url, { method: 'PUT', headers: headersWithoutLength, body: '0123456789' });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain('SignatureDoesNotMatch');
    await expectS3Error(s3.headObject({ bucket, key: 'up/wrong.txt' }), 'key_not_found');

    // Type différent de celui signé : refusé aussi.
    const typed = await s3.presignPut({ bucket, key: 'up/typed.txt', expiresIn: 300, contentLength: 2, contentType: 'text/plain' });
    const badType = await fetch(typed.url, { method: 'PUT', headers: { ...typed.headers, 'content-type': 'image/png' }, body: 'ok' });
    expect(badType.status).toBe(403);
  });

  it('GET présigné avec disposition et type', async () => {
    await put('get/rapport.bin', 'contenu', { contentType: 'application/octet-stream' });
    const signed = await s3.presignGet({
      bucket,
      key: 'get/rapport.bin',
      expiresIn: 60,
      disposition: 'attachment',
      filename: 'Rapport été.pdf',
      contentType: 'application/pdf',
    });
    expect(signed.method).toBe('GET');
    expect(signed.headers).toEqual({});
    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('contenu');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain("filename*=UTF-8''Rapport%20%C3%A9t%C3%A9.pdf");

    await expectS3Error(s3.presignGet({ bucket, key: 'get/rapport.bin', expiresIn: 0 }), 'validation', 'expires_out_of_range');
    await expectS3Error(s3.presignGet({ bucket, key: 'get/rapport.bin', expiresIn: 604_801 }), 'validation', 'expires_out_of_range');
  });

  it('multipart complet (2 parties de 5 Mio), longueur de partie signée', async () => {
    const key = 'mp/big.bin';
    const { uploadId } = await s3.createMultipart({ bucket, key, contentType: 'application/x-test' });
    expect(uploadId).toBeTruthy();
    const parts = [randomBytes(5 * MIB), randomBytes(5 * MIB)];
    const etags: Array<{ partNumber: number; etag: string }> = [];
    for (const [index, data] of parts.entries()) {
      const signed = await s3.presignPart({ bucket, key, uploadId, partNumber: index + 1, contentLength: data.length, expiresIn: 600 });
      expect(signed.headers).toEqual({ 'content-length': String(data.length) });
      const response = await sendSigned(signed, data);
      expect(response.status).toBe(200);
      etags.push({ partNumber: index + 1, etag: response.headers.get('etag') ?? '' });
    }
    // Une partie d'une autre longueur que celle signée est refusée.
    const wrong = await s3.presignPart({ bucket, key, uploadId, partNumber: 3, contentLength: 10, expiresIn: 600 });
    const refused = await fetch(wrong.url, { method: 'PUT', body: 'x'.repeat(20) });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain('SignatureDoesNotMatch');

    const listed = await s3.listParts({ bucket, key, uploadId });
    expect(listed.map((part) => [part.partNumber, part.size])).toEqual([
      [1, 5 * MIB],
      [2, 5 * MIB],
    ]);
    expect(listed.map((part) => part.etag)).toEqual(etags.map((part) => part.etag.replace(/"/g, '')));

    const done = await s3.completeMultipart({ bucket, key, uploadId, parts: etags.reverse() });
    expect(done.etag).toMatch(/-2$/);
    const head = await s3.headObject({ bucket, key });
    expect(head.size).toBe(10 * MIB);
    expect(head.contentType).toBe('application/x-test');
  });

  it('abandon d’un multipart (idempotent)', async () => {
    const key = 'mp/aborted.bin';
    const { uploadId } = await s3.createMultipart({ bucket, key });
    const signed = await s3.presignPart({ bucket, key, uploadId, partNumber: 1, contentLength: 1024, expiresIn: 60 });
    expect((await sendSigned(signed, randomBytes(1024))).status).toBe(200);
    await s3.abortMultipart({ bucket, key, uploadId });
    await expectS3Error(s3.listParts({ bucket, key, uploadId }), 'not_found', 'upload_gone');
    await s3.abortMultipart({ bucket, key, uploadId });
  });

  it('copie : métadonnées et type préservés ; copie multipart au-delà du seuil', async () => {
    await put('copy/src.txt', 'source', { contentType: 'text/markdown', metadata: { project: 'ud' } });
    const result = await s3.copyObject({ bucket, key: 'copy/dst.txt', sourceBucket: bucket, sourceKey: 'copy/src.txt' });
    expect(result.etag).toBeTruthy();
    const head = await s3.headObject({ bucket, key: 'copy/dst.txt' });
    expect(head).toMatchObject({ size: 6, contentType: 'text/markdown', metadata: { project: 'ud' } });

    await put('copy/a b+c.txt', 'spécial');
    await s3.copyObject({ bucket, key: 'copy/a b+c (2).txt', sourceBucket: bucket, sourceKey: 'copy/a b+c.txt' });
    expect((await s3.headObject({ bucket, key: 'copy/a b+c (2).txt' })).size).toBe(Buffer.byteLength('spécial'));

    await expectS3Error(s3.copyObject({ bucket, key: 'copy/x', sourceBucket: bucket, sourceKey: 'copy/missing' }), 'key_not_found');

    // Seuil abaissé : UploadPartCopy en 2 parties de 5 Mio.
    const small = createS3({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      addressing: 'path',
      credentials,
      allowPrivate: true,
      copyMultipartThreshold: MIB,
      copyPartSize: 5 * MIB,
    });
    try {
      await put('copy/large.bin', randomBytes(10 * MIB), { contentType: 'application/x-large', metadata: { kind: 'large' } });
      const copied = await small.copyObject({ bucket, key: 'copy/large-copy.bin', sourceBucket: bucket, sourceKey: 'copy/large.bin' });
      expect(copied.etag).toMatch(/-2$/);
      const copiedHead = await small.headObject({ bucket, key: 'copy/large-copy.bin' });
      expect(copiedHead).toMatchObject({ size: 10 * MIB, contentType: 'application/x-large', metadata: { kind: 'large' } });
    } finally {
      small.destroy();
    }
  });

  it('suppression unitaire et en lot', async () => {
    await put('del/one.txt', '1');
    await s3.deleteObject({ bucket, key: 'del/one.txt' });
    await expectS3Error(s3.headObject({ bucket, key: 'del/one.txt' }), 'key_not_found');
    await s3.deleteObject({ bucket, key: 'del/never-existed.txt' });

    const keys = ['del/a.txt', 'del/b b.txt', 'del/c+%.txt', 'del/ü.txt'];
    for (const key of keys) await put(key, key);
    const result = await s3.deleteObjects({ bucket, keys: [...keys, 'del/missing.txt'].map((key) => ({ key })) });
    expect(result.errors).toEqual([]);
    expect(result.deleted.sort()).toEqual([...keys, 'del/missing.txt'].sort());
    const after = await s3.listObjects({ bucket, prefix: 'del/' });
    expect(after.items).toEqual([]);
  });

  it('clés délicates : segments . et .., caractère de contrôle', async () => {
    const key = 'dots/../z.txt';
    const put = await s3.presignPut({ bucket, key, expiresIn: 60, contentLength: 3 });
    expect(put.url).toContain('/dots/%2E%2E/z.txt');
    const status = (await sendSigned(put, 'dot')).status;
    // RustFS 1.0.4 calcule la signature sur le chemin brut et refuse `%2E%2E` (403) :
    // quirk `dot-segment-unsafe`, ces clés passent par le proxy. Un autre résultat doit être revu.
    expect(status).toBe(403);

    const control = 'ctl/ab.txt';
    const putControl = await s3.presignPut({ bucket, key: control, expiresIn: 60, contentLength: 1 });
    expect((await sendSigned(putControl, 'c')).status).toBe(200);
    expect((await s3.listObjects({ bucket, prefix: 'ctl/' })).items.map((item) => item.key)).toEqual([control]);
    // Clé interdite en XML : supprimée par DeleteObject unitaire, jamais dans le corps du lot.
    const result = await s3.deleteObjects({ bucket, keys: [{ key: control }, { key: 'ctl/missing' }] });
    expect(result.errors).toEqual([]);
    expect(result.deleted.sort()).toEqual([control, 'ctl/missing'].sort());
    expect((await s3.listObjects({ bucket, prefix: 'ctl/' })).items).toEqual([]);
  });

  it('sumPrefix : tout le sous-arbre', async () => {
    await put('sum/a.txt', '12345');
    await put('sum/x/b.txt', '123');
    await put('sum/x/y/c.txt', '1');
    await s3.putEmpty({ bucket, key: 'sum/x/z/' });
    expect(await s3.sumPrefix({ bucket, prefix: 'sum/' })).toEqual({ bytes: 9, objects: 4 });
    expect(await s3.sumPrefix({ bucket, prefix: 'sum/x/' })).toEqual({ bytes: 4, objects: 3 });
    expect(await s3.sumPrefix({ bucket, prefix: 'nothing/' })).toEqual({ bytes: 0, objects: 0 });
  });

  it('identifiants refusés : erreur traduite sans secret', async () => {
    const bad = createS3({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      addressing: 'path',
      credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: 'wrong-secret-value' },
      allowPrivate: true,
      maxAttempts: 1,
    });
    try {
      const error = await bad.listObjects({ bucket, prefix: '' }).then(
        () => null,
        (e: unknown) => e as S3Error,
      );
      expect(error).toBeInstanceOf(S3Error);
      expect(['signature_mismatch', 'invalid_credentials', 'access_denied']).toContain(error!.code);
      expect(JSON.stringify(error!.toApiError())).not.toContain('wrong-secret-value');
    } finally {
      bad.destroy();
    }
  });
});

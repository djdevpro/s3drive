/**
 * Intégration du moteur d'envoi contre le S3 local de compose.dev.yaml (RustFS, http://127.0.0.1:9000,
 * adressage par chemin), par un transport de test qui présigne avec `@ud/s3`. Sautés proprement si
 * RustFS ne répond pas. Chaque exécution crée un bucket `ud-it-up-<aléa>` et le supprime à la fin.
 */
import { randomBytes } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { CreateUploadResponse } from '@ud/contracts';
import { createS3, planParts, type UdS3 } from '@ud/s3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MemoryUploadStore,
  UploadEngine,
  UploadError,
  deferred,
  fetchSender,
  sameBytes,
  testBytes,
  testFile,
  type CreateUploadInput,
  type DataSender,
  type UploadRef,
  type UploadTransport,
} from '../src/upload.js';

const ENDPOINT = process.env.UD_IT_S3_ENDPOINT ?? 'http://127.0.0.1:9000';
// Identifiants par défaut du S3 local de développement (compose.dev.yaml), surchargeables.
const credentials = {
  accessKeyId: process.env.UD_DEV_S3_ACCESS_KEY ?? 'udadmin',
  secretAccessKey: process.env.UD_DEV_S3_SECRET_KEY ?? 'udadmin-dev-secret',
};
const MIB = 1024 * 1024;
const TTL_S = 900;

async function rustfsReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${ENDPOINT}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

const reachable = await rustfsReachable();
const bucket = `ud-it-up-${randomBytes(4).toString('hex')}`;

/** Transport de test : ce que ferait le serveur, présigné directement par `@ud/s3` (taille signée). */
class S3TestTransport implements UploadTransport {
  readonly calls: string[] = [];
  readonly #sizes = new Map<string, { size: number; partSize: number; partCount: number }>();
  constructor(private readonly s3: UdS3) {}

  async create(input: CreateUploadInput): Promise<CreateUploadResponse> {
    this.calls.push(`create ${input.mode}`);
    const expiresAt = new Date(Date.now() + TTL_S * 1000).toISOString();
    const common = { key: input.key, transport: 'direct' as const, corsOk: null, weakGuard: false, expiresAt };
    if (input.mode === 'single') {
      const signed = await this.s3.presignPut({ bucket: input.bucket, key: input.key, expiresIn: TTL_S, contentLength: input.size });
      return { ...common, mode: 'single', url: signed.url, headers: signed.headers, receipt: 'test' };
    }
    const plan = planParts(input.size, 5 * MIB);
    const { uploadId } = await this.s3.createMultipart({ bucket: input.bucket, key: input.key });
    this.#sizes.set(uploadId, { size: input.size, ...plan });
    return { ...common, mode: 'multipart', uploadId, partSize: plan.partSize, partCount: plan.partCount, checksum: null, contentMd5Required: false };
  }

  async signParts(input: UploadRef & { parts: Array<{ partNumber: number; size: number }> }) {
    this.calls.push(`sign ${input.parts.map((p) => p.partNumber).join(',')}`);
    return Promise.all(
      input.parts.map(async (p) => {
        const signed = await this.s3.presignPart({ bucket: input.bucket, key: input.key, uploadId: input.uploadId, partNumber: p.partNumber, contentLength: p.size, expiresIn: TTL_S });
        return { partNumber: p.partNumber, url: signed.url, headers: signed.headers, expiresAt: new Date(Date.now() + TTL_S * 1000).toISOString() };
      }),
    );
  }

  async listParts(input: UploadRef) {
    this.calls.push('list');
    try {
      return await this.s3.listParts({ bucket: input.bucket, key: input.key, uploadId: input.uploadId });
    } catch {
      throw new UploadError({ code: 'not_found', details: { reason: 'upload_gone' } });
    }
  }

  async complete(input: UploadRef & { size: number }) {
    this.calls.push('complete');
    const parts = await this.s3.listParts({ bucket: input.bucket, key: input.key, uploadId: input.uploadId });
    const total = parts.reduce((sum, p) => sum + p.size, 0);
    if (total !== input.size) throw new UploadError({ code: 'invalid_request', details: { reason: 'parts_mismatch' } });
    const done = await this.s3.completeMultipart({ bucket: input.bucket, key: input.key, uploadId: input.uploadId, parts });
    return { key: input.key, etag: done.etag, size: total };
  }

  async abort(input: UploadRef) {
    this.calls.push('abort');
    await this.s3.abortMultipart({ bucket: input.bucket, key: input.key, uploadId: input.uploadId });
  }
}

describe.skipIf(!reachable)('moteur d’envoi contre RustFS', () => {
  let s3: UdS3;
  let admin: S3Client;

  async function read(key: string): Promise<Uint8Array> {
    const out = await admin.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return new Uint8Array(await out.Body!.transformToByteArray());
  }

  function engine(transport: UploadTransport, options: { store?: MemoryUploadStore; sender?: DataSender; resolveFile?: () => Promise<Blob | null> } = {}) {
    return new UploadEngine({
      transport,
      sender: options.sender ?? fetchSender,
      store: options.store ?? new MemoryUploadStore(),
      concurrency: 2,
      multipartThreshold: 8 * MIB,
      confirmDelayMs: 0,
      ...(options.resolveFile ? { resolveFile: options.resolveFile } : {}),
    });
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
    const page = await admin.send(new ListObjectsV2Command({ Bucket: bucket }));
    for (const entry of page.Contents ?? []) await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.Key! }));
    await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
    admin.destroy();
  });

  it('PUT simple présigné avec longueur signée', async () => {
    const transport = new S3TestTransport(s3);
    const data = testBytes(64 * 1024, 3);
    const e = engine(transport);
    const [id] = e.add([{ file: testFile(data), bucket, key: 'simple/petit.bin', conflict: 'overwrite' }]);
    await e.whenIdle();
    expect(e.get(id!)!.state).toBe('done');
    expect(sameBytes(await read('simple/petit.bin'), data)).toBe(true);
  });

  it('multipart de 2 parties de 5 Mio', async () => {
    const transport = new S3TestTransport(s3);
    const data = testBytes(10 * MIB, 5);
    const e = engine(transport);
    const [id] = e.add([{ file: testFile(data), bucket, key: 'multi/deux-parties.bin', conflict: 'overwrite' }]);
    await e.whenIdle();
    const item = e.get(id!)!;
    expect(item.state).toBe('done');
    expect(item.mode).toBe('multipart');
    expect(transport.calls).toEqual(['create multipart', 'sign 1,2', 'complete']);
    expect(sameBytes(await read('multi/deux-parties.bin'), data)).toBe(true);
  });

  it('reprise après « rechargement » : seule la partie manquante repart', async () => {
    const transport = new S3TestTransport(s3);
    const store = new MemoryUploadStore();
    const data = testBytes(10 * MIB, 9);
    const file = testFile(data);
    const started = deferred();
    const sentParts: string[] = [];
    // Premier onglet : la partie 2 ne part jamais (fermeture pendant l'envoi).
    const stuck: DataSender = async (request) => {
      if (request.url.includes('partNumber=2')) {
        started.resolve();
        await new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      }
      return fetchSender(request);
    };
    const first = engine(transport, { store, sender: stuck });
    const [id] = first.add([{ file, bucket, key: 'multi/reprise.bin', conflict: 'overwrite' }]);
    await started.promise;
    // La partie 1 doit être confirmée avant la « fermeture ».
    for (let i = 0; i < 200 && !Object.keys((await store.list())[0]?.parts ?? {}).includes('1'); i += 1) await new Promise((r) => setTimeout(r, 25));
    await first.flush();
    first.destroy();

    const counting: DataSender = async (request) => {
      sentParts.push(new URL(request.url).searchParams.get('partNumber') ?? '?');
      return fetchSender(request);
    };
    const second = engine(transport, { store, sender: counting, resolveFile: async () => file });
    await second.restore();
    await second.whenIdle();
    expect(second.get(id!)!.state).toBe('done');
    expect(sentParts).toEqual(['2']);
    expect(transport.calls).toContain('list');
    expect(sameBytes(await read('multi/reprise.bin'), data)).toBe(true);
  });

  it('un corps d’une autre taille que la longueur signée est refusé par S3', async () => {
    const signed = await s3.presignPut({ bucket, key: 'simple/taille.bin', expiresIn: TTL_S, contentLength: 10 });
    const response = await fetch(signed.url, { method: 'PUT', headers: { ...signed.headers, 'content-length': '11' }, body: new Uint8Array(11) }).catch(() => null);
    // Soit S3 refuse, soit le client refuse d'envoyer un corps incohérent : jamais de succès.
    expect(response === null || response.status >= 400).toBe(true);
  });
});

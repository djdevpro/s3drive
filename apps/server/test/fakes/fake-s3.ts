import { createHash, randomBytes } from 'node:crypto';
import type { CreateS3Options, FileItem, FolderItem, ListPage, ObjectHead, SignedRequest, UdS3 } from '@ud/s3';
import type { S3Factory } from '../../src/instance/storage.js';

// Faux S3 en mémoire qui implémente la surface UdS3 de @ud/s3 pour les tests du serveur.
// Les URL présignées sont de la forme fake-s3://<bucket>/<clé>?op=… ; `fulfill()` joue la requête du navigateur
// et vérifie la longueur signée comme le ferait S3.

export class FakeS3Error extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message = code,
  ) {
    super(message);
    this.name = 'S3Error';
  }
  readonly retryable = false;
}

interface StoredObject {
  size: number;
  etag: string;
  lastModified: string;
  contentType?: string;
}

interface Multipart {
  bucket: string;
  key: string;
  contentType?: string;
  parts: Map<number, { size: number; etag: string }>;
}

const etagOf = (data: string) => createHash('md5').update(data).digest('hex');

export class FakeS3 implements UdS3 {
  readonly buckets = new Map<string, Map<string, StoredObject>>();
  readonly uploads = new Map<string, Multipart>();
  /** Journal des appels (nom de l'opération), pour vérifier qu'aucun appel n'a eu lieu. */
  readonly calls: string[] = [];
  destroyed = false;

  constructor(
    readonly options: CreateS3Options | null = null,
    bucketNames: string[] = [],
  ) {
    for (const b of bucketNames) this.buckets.set(b, new Map());
  }

  private bucket(name: string): Map<string, StoredObject> {
    let b = this.buckets.get(name);
    if (!b) {
      b = new Map();
      this.buckets.set(name, b);
    }
    return b;
  }

  /** Dépose un objet directement (préparation des tests). */
  seed(bucket: string, key: string, size: number, contentType?: string): void {
    this.bucket(bucket).set(key, { size, etag: etagOf(`${key}:${size}:${Math.random()}`), lastModified: new Date().toISOString(), ...(contentType ? { contentType } : {}) });
  }

  keys(bucket: string): string[] {
    return [...this.bucket(bucket).keys()].sort();
  }

  async headBucket(): Promise<void> {
    this.calls.push('headBucket');
  }

  async listObjects(input: { bucket: string; prefix: string; delimiter?: '/' | null; cursor?: string | null; limit?: number }): Promise<ListPage> {
    this.calls.push('listObjects');
    const delimiter = input.delimiter === undefined ? '/' : input.delimiter;
    const limit = input.limit ?? 1000;
    const all = [...this.bucket(input.bucket).entries()].filter(([k]) => k.startsWith(input.prefix)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const entries: Array<FolderItem | FileItem> = [];
    const seenFolders = new Set<string>();
    for (const [key, obj] of all) {
      const rest = key.slice(input.prefix.length);
      const slash = delimiter ? rest.indexOf(delimiter) : -1;
      if (slash >= 0) {
        const folder = input.prefix + rest.slice(0, slash + 1);
        if (!seenFolders.has(folder)) {
          seenFolders.add(folder);
          entries.push({ type: 'folder', key: folder, name: rest.slice(0, slash) });
        }
        continue;
      }
      entries.push({ type: 'file', key, name: rest, size: obj.size, lastModified: obj.lastModified, etag: obj.etag, storageClass: 'STANDARD' });
    }
    const start = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) : 0;
    const items = entries.slice(start, start + limit);
    const next = start + limit < entries.length ? Buffer.from(String(start + limit)).toString('base64url') : null;
    return { items, nextCursor: next };
  }

  async headObject(input: { bucket: string; key: string }): Promise<ObjectHead> {
    this.calls.push('headObject');
    const obj = this.bucket(input.bucket).get(input.key);
    if (!obj) throw new FakeS3Error('key_not_found', 404);
    return { key: input.key, size: obj.size, lastModified: obj.lastModified, etag: obj.etag, ...(obj.contentType ? { contentType: obj.contentType } : {}), metadata: {} };
  }

  private url(bucket: string, key: string, params: Record<string, string | number>): string {
    const search = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    return `fake-s3://${bucket}/${encodeURIComponent(key)}?${search}`;
  }

  async presignGet(input: { bucket: string; key: string; expiresIn: number; disposition?: 'inline' | 'attachment' }): Promise<SignedRequest> {
    this.calls.push('presignGet');
    return { url: this.url(input.bucket, input.key, { op: 'get', exp: input.expiresIn, disposition: input.disposition ?? 'attachment' }), method: 'GET', headers: {} };
  }

  async presignPut(input: { bucket: string; key: string; expiresIn: number; contentLength: number; contentType?: string }): Promise<SignedRequest> {
    this.calls.push('presignPut');
    return {
      url: this.url(input.bucket, input.key, { op: 'put', len: input.contentLength, ...(input.contentType ? { type: input.contentType } : {}) }),
      method: 'PUT',
      headers: { 'content-length': String(input.contentLength), ...(input.contentType ? { 'content-type': input.contentType } : {}) },
    };
  }

  async createMultipart(input: { bucket: string; key: string; contentType?: string }): Promise<{ uploadId: string }> {
    this.calls.push('createMultipart');
    const uploadId = randomBytes(8).toString('hex');
    this.uploads.set(uploadId, { bucket: input.bucket, key: input.key, ...(input.contentType ? { contentType: input.contentType } : {}), parts: new Map() });
    return { uploadId };
  }

  async presignPart(input: { bucket: string; key: string; uploadId: string; partNumber: number; contentLength: number }): Promise<SignedRequest> {
    this.calls.push('presignPart');
    if (!this.uploads.has(input.uploadId)) throw new FakeS3Error('not_found', 404);
    return {
      url: this.url(input.bucket, input.key, { op: 'part', uploadId: input.uploadId, partNumber: input.partNumber, len: input.contentLength }),
      method: 'PUT',
      headers: { 'content-length': String(input.contentLength) },
    };
  }

  async listParts(input: { uploadId: string }): Promise<Array<{ partNumber: number; etag: string; size: number }>> {
    this.calls.push('listParts');
    const up = this.uploads.get(input.uploadId);
    if (!up) throw Object.assign(new FakeS3Error('not_found', 404), { details: { reason: 'upload_gone' } });
    return [...up.parts.entries()].map(([partNumber, p]) => ({ partNumber, etag: p.etag, size: p.size })).sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipart(input: { bucket: string; key: string; uploadId: string; parts: Array<{ partNumber: number; etag: string }> }): Promise<{ etag: string }> {
    this.calls.push('completeMultipart');
    const up = this.uploads.get(input.uploadId);
    if (!up) throw new FakeS3Error('not_found', 404);
    const size = input.parts.reduce((s, p) => s + (up.parts.get(p.partNumber)?.size ?? 0), 0);
    const etag = `${createHash('md5').update(input.uploadId).digest('hex')}-${input.parts.length}`;
    this.bucket(input.bucket).set(input.key, { size, etag, lastModified: new Date().toISOString(), ...(up.contentType ? { contentType: up.contentType } : {}) });
    this.uploads.delete(input.uploadId);
    return { etag };
  }

  async abortMultipart(input: { uploadId: string }): Promise<void> {
    this.calls.push('abortMultipart');
    // Un envoi déjà disparu : succès, comme le vrai moteur.
    this.uploads.delete(input.uploadId);
  }

  async putEmpty(input: { bucket: string; key: string }): Promise<void> {
    this.calls.push('putEmpty');
    this.bucket(input.bucket).set(input.key, { size: 0, etag: etagOf(''), lastModified: new Date().toISOString(), contentType: 'application/x-directory' });
  }

  async copyObject(input: { bucket: string; key: string; sourceBucket: string; sourceKey: string }): Promise<{ etag: string }> {
    this.calls.push('copyObject');
    const src = this.bucket(input.sourceBucket).get(input.sourceKey);
    if (!src) throw new FakeS3Error('key_not_found', 404);
    this.bucket(input.bucket).set(input.key, { ...src, lastModified: new Date().toISOString() });
    return { etag: src.etag };
  }

  async deleteObject(input: { bucket: string; key: string }): Promise<void> {
    this.calls.push('deleteObject');
    this.bucket(input.bucket).delete(input.key);
  }

  async deleteObjects(input: { bucket: string; keys: Array<{ key: string }> }): Promise<{ deleted: string[]; errors: [] }> {
    this.calls.push('deleteObjects');
    for (const k of input.keys) this.bucket(input.bucket).delete(k.key);
    return { deleted: input.keys.map((k) => k.key), errors: [] };
  }

  async sumPrefix(input: { bucket: string; prefix: string }): Promise<{ bytes: number; objects: number }> {
    this.calls.push('sumPrefix');
    let bytes = 0;
    let objects = 0;
    for (const [k, o] of this.bucket(input.bucket)) {
      if (k.startsWith(input.prefix)) {
        bytes += o.size;
        objects += 1;
      }
    }
    return { bytes, objects };
  }

  destroy(): void {
    this.destroyed = true;
  }

  /** Joue la requête présignée du navigateur ; refuse un corps d'une autre longueur que celle signée. */
  fulfill(request: { url: string; headers: Record<string, string> }, bodyLength: number): { etag: string } {
    const url = new URL(request.url);
    const bucket = url.host;
    const key = decodeURIComponent(url.pathname.slice(1));
    const op = url.searchParams.get('op');
    const signed = Number(request.headers['content-length']);
    if (signed !== bodyLength || Number(url.searchParams.get('len')) !== bodyLength) throw new FakeS3Error('signature_mismatch', 403);
    if (op === 'put') {
      const etag = etagOf(`${key}:${bodyLength}`);
      const type = url.searchParams.get('type');
      this.bucket(bucket).set(key, { size: bodyLength, etag, lastModified: new Date().toISOString(), ...(type ? { contentType: type } : {}) });
      return { etag };
    }
    if (op === 'part') {
      const up = this.uploads.get(url.searchParams.get('uploadId') ?? '');
      if (!up) throw new FakeS3Error('not_found', 404);
      const etag = etagOf(`${key}:${url.searchParams.get('partNumber')}:${bodyLength}`);
      up.parts.set(Number(url.searchParams.get('partNumber')), { size: bodyLength, etag });
      return { etag };
    }
    throw new Error(`unsupported op ${op}`);
  }
}

/** Fabrique de tests : un seul faux S3 partagé par tous les stockages du fichier. */
export function fakeS3Factory(fake: FakeS3, partSize = 8 * 1024 * 1024): S3Factory & { created: CreateS3Options[] } {
  const created: CreateS3Options[] = [];
  return {
    created,
    create(options) {
      created.push(options);
      return fake;
    },
    multipart: {
      minPartSize: 5 * 1024 * 1024,
      maxPartSize: 5 * 1024 ** 3,
      maxParts: 10_000,
      choosePartSize: () => partSize,
    },
  };
}

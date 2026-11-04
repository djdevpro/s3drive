// Outils de test (moteur, file de l'appli, hôtes tiers) : faux serveur d'envoi en mémoire — routes
// de l'API et octets « S3 » — avec injection de pannes, et réseau pilotable. La longueur signée est
// contrôlée comme le ferait S3. Jamais utilisé par le code livré.
import type { CreateUploadResponse, PresignedPart, UploadResult } from '@ud/contracts';
import { UploadError } from './errors.js';
import type { ConfirmItem, ConfirmResult, CreateUploadInput, DataRequest, DataResponse, NetworkMonitor, UploadRef, UploadTransport } from './types.js';

const MIB = 1024 * 1024;

interface FakeUpload {
  bucket: string;
  key: string;
  size: number;
  partSize: number;
  partCount: number;
  parts: Map<number, { etag: string; data: Uint8Array }>;
}

interface PendingSingle {
  bucket: string;
  key: string;
  size: number;
  receipt: string;
}

/** Décision d'une panne injectée : réponse forcée, exception, ou `undefined` pour laisser passer. */
export type FakeFault = (request: DataRequest, target: { kind: 'single' | 'part'; partNumber: number; uploadId?: string }) => Promise<DataResponse | undefined> | DataResponse | undefined;

export class FakeUploadServer implements UploadTransport {
  readonly objects = new Map<string, Uint8Array>();
  readonly uploads = new Map<string, FakeUpload>();
  readonly singles = new Map<string, PendingSingle>();
  readonly calls: string[] = [];
  readonly sent: Array<{ kind: 'single' | 'part'; partNumber: number; size: number }> = [];
  partSize = 5 * MIB;
  /** Durée de validité des URL émises (ms). */
  urlTtlMs = 3_600_000;
  clock = () => Date.now();
  /** Octets restants du quota (`null` : illimité). */
  remaining: number | null = null;
  fault: FakeFault | null = null;
  createFault: ((input: CreateUploadInput) => UploadError | undefined) | null = null;
  #next = 1;

  #expires(): string {
    return new Date(this.clock() + this.urlTtlMs).toISOString();
  }

  #path(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  async create(input: CreateUploadInput): Promise<CreateUploadResponse> {
    this.calls.push(`create ${input.key} ${input.mode} ${input.conflict}`);
    const injected = this.createFault?.(input);
    if (injected) throw injected;
    if (input.conflict === 'fail' && this.objects.has(this.#path(input.bucket, input.key))) {
      throw new UploadError({ code: 'already_exists', status: 409, details: { reason: 'key_exists' } });
    }
    if (this.remaining !== null && input.size > this.remaining) {
      throw new UploadError({ code: 'quota_exceeded', status: 403, details: { limit: 'user_quota', remaining: this.remaining } });
    }
    const common = { key: input.key, transport: 'direct' as const, corsOk: null, weakGuard: input.conflict === 'fail', expiresAt: this.#expires() };
    if (input.mode === 'single' || input.size === 0) {
      const token = `s${this.#next++}`;
      const receipt = `receipt-${token}`;
      this.singles.set(token, { bucket: input.bucket, key: input.key, size: input.size, receipt });
      return { ...common, mode: 'single', url: `fake://single/${token}`, headers: { 'content-length': String(input.size) }, receipt };
    }
    const uploadId = `u${this.#next++}`;
    const partCount = Math.max(1, Math.ceil(input.size / this.partSize));
    this.uploads.set(uploadId, { bucket: input.bucket, key: input.key, size: input.size, partSize: this.partSize, partCount, parts: new Map() });
    const first = Array.from({ length: Math.min(2, partCount) }, (_, i) => ({ partNumber: i + 1, size: this.#partLength(uploadId, i + 1) }));
    return { ...common, mode: 'multipart', uploadId, partSize: this.partSize, partCount, checksum: null, contentMd5Required: false, parts: this.#sign(uploadId, first) };
  }

  #upload(ref: UploadRef): FakeUpload {
    const upload = this.uploads.get(ref.uploadId);
    if (!upload || upload.key !== ref.key) throw new UploadError({ code: 'not_found', status: 404, details: { reason: 'upload_gone' } });
    return upload;
  }

  #partLength(uploadId: string, partNumber: number): number {
    const upload = this.uploads.get(uploadId)!;
    return partNumber < upload.partCount ? upload.partSize : upload.size - upload.partSize * (upload.partCount - 1);
  }

  #sign(uploadId: string, parts: Array<{ partNumber: number; size: number }>): PresignedPart[] {
    return parts.map((p) => {
      if (p.size !== this.#partLength(uploadId, p.partNumber)) throw new UploadError({ code: 'validation', status: 400, details: { reason: 'part_size' } });
      return { partNumber: p.partNumber, url: `fake://part/${uploadId}/${p.partNumber}`, headers: { 'content-length': String(p.size) }, expiresAt: this.#expires() };
    });
  }

  async signParts(input: UploadRef & { parts: Array<{ partNumber: number; size: number }> }): Promise<PresignedPart[]> {
    this.calls.push(`sign ${input.parts.map((p) => p.partNumber).join(',')}`);
    this.#upload(input);
    return this.#sign(input.uploadId, input.parts);
  }

  async listParts(input: UploadRef) {
    this.calls.push('list');
    const upload = this.#upload(input);
    return [...upload.parts.entries()].map(([partNumber, p]) => ({ partNumber, etag: p.etag, size: p.data.length })).sort((a, b) => a.partNumber - b.partNumber);
  }

  async complete(input: UploadRef & { size: number; parts: Array<{ partNumber: number; etag?: string }> }): Promise<UploadResult> {
    this.calls.push('complete');
    const upload = this.#upload(input);
    if (input.size !== upload.size) throw new UploadError({ code: 'invalid_request', status: 400, details: { reason: 'size_mismatch' } });
    if (upload.parts.size !== upload.partCount) throw new UploadError({ code: 'invalid_request', status: 400, details: { reason: 'parts_mismatch' } });
    const data = new Uint8Array(upload.size);
    let offset = 0;
    for (let n = 1; n <= upload.partCount; n += 1) {
      const part = upload.parts.get(n)!;
      data.set(part.data, offset);
      offset += part.data.length;
    }
    this.objects.set(this.#path(upload.bucket, upload.key), data);
    this.uploads.delete(input.uploadId);
    return { key: input.key, etag: `etag-${upload.partCount}`, size: upload.size };
  }

  async abort(input: UploadRef): Promise<void> {
    this.calls.push('abort');
    if (!this.uploads.delete(input.uploadId)) throw new UploadError({ code: 'not_found', status: 404, details: { reason: 'upload_gone' } });
  }

  async confirm(_bucket: string, items: ConfirmItem[]): Promise<ConfirmResult[]> {
    this.calls.push(`confirm ${items.length}`);
    return items.map((item) => {
      const ok = [...this.singles.values()].some((s) => s.receipt === item.receipt && s.key === item.key && this.objects.has(this.#path(s.bucket, s.key)));
      return ok ? { key: item.key, ok } : { key: item.key, ok, error: { code: 'validation', reason: 'invalid_receipt', retryable: false } };
    });
  }

  /** Envoi des octets « vers S3 ». */
  readonly sender = async (request: DataRequest): Promise<DataResponse> => {
    const url = new URL(request.url);
    const [kind, a, b] = [url.host, ...url.pathname.split('/').filter(Boolean)] as [string, string, string | undefined];
    const target = kind === 'single' ? { kind: 'single' as const, partNumber: 0 } : { kind: 'part' as const, partNumber: Number(b), uploadId: a };
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const forced = await this.fault?.(request, target);
    if (forced) return forced;
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    // Longueur signée : un corps d'une autre taille est refusé.
    if (request.headers['content-length'] !== String(request.body.size)) return { status: 403, etag: null, s3Code: 'SignatureDoesNotMatch' };
    const data = new Uint8Array(await request.body.arrayBuffer());
    request.onProgress?.(Math.floor(data.length / 2));
    request.onProgress?.(data.length);
    this.sent.push({ kind: target.kind, partNumber: target.partNumber, size: data.length });
    if (target.kind === 'single') {
      const single = this.singles.get(a)!;
      this.objects.set(this.#path(single.bucket, single.key), data);
      return { status: 200, etag: '"single"' };
    }
    const upload = this.uploads.get(a);
    if (!upload) return { status: 404, etag: null, s3Code: 'NoSuchUpload' };
    const etag = `p${target.partNumber}-${data.length}`;
    upload.parts.set(target.partNumber, { etag, data });
    return { status: 200, etag: `"${etag}"` };
  };

  object(bucket: string, key: string): Uint8Array | undefined {
    return this.objects.get(this.#path(bucket, key));
  }
}

/** Réseau pilotable. */
export class FakeNetwork implements NetworkMonitor {
  online = true;
  readonly #listeners = new Set<() => void>();
  isOnline(): boolean {
    return this.online;
  }
  onOnline(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  set(online: boolean): void {
    this.online = online;
    if (online) for (const l of [...this.#listeners]) l();
  }
}

/** Octets déterministes. */
export function testBytes(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

export function testFile(data: Uint8Array<ArrayBuffer>, lastModified = 1_700_000_000_000): File {
  return new File([data], 'file.bin', { lastModified });
}

export function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Promesse résolue à la main. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

import { type CreateUploadResponse, type PresignedPart, type UploadPurpose, relativeKeyProblem } from '@ud/contracts';
import { LOCAL_ERRORS, UploadError, isAbortError, toUploadError } from './errors.js';
import { freeNameCandidates, nameOf, withName } from './names.js';
import { defaultSender } from './sender.js';
import { SpeedMeter } from './speed.js';
import { MemoryUploadStore } from './store.js';
import {
  TERMINAL_STATES,
  type ConflictChoice,
  type DataResponse,
  type DataSender,
  type NetworkMonitor,
  type UploadItemView,
  type UploadRecord,
  type UploadSnapshot,
  type UploadSource,
  type UploadState,
  type UploadStore,
  type UploadTransport,
} from './types.js';

// Moteur d'envoi reprenable : PUT simple ou multipart selon la taille et la
// réponse du serveur, créneaux de données partagés, nouveaux essais par requête, pause, reprise,
// annulation, reprise après rechargement par `listParts`, conflits de noms. Aucune URL signée n'est
// journalisée ni persistée.

const MIB = 1024 * 1024;
/** Seuil du PUT simple. */
export const DEFAULT_MULTIPART_THRESHOLD = 16 * MIB;
/** Lot nominal de présignature des parties. */
const SIGN_BATCH = 20;
/** Une URL est représignée s'il lui reste moins de 60 s. */
const RESIGN_MARGIN_MS = 60_000;
/** Une requête qui échoue à moins de 30 s de l'expiration est une expiration. */
const EXPIRY_MARGIN_MS = 30_000;
/** Envois terminés gardés 24 h. */
const DONE_RETENTION_MS = 24 * 3600 * 1000;
const ABORT_ATTEMPTS = 3;

export interface UploadEngineOptions {
  transport: UploadTransport;
  /** Persistance ; défaut : mémoire. */
  store?: UploadStore;
  /** Envoi des octets ; défaut : XHR dans le navigateur, `fetch` ailleurs. */
  sender?: DataSender;
  network?: NetworkMonitor;
  /** Requêtes de données simultanées, défaut 4. */
  concurrency?: number;
  /** Fichiers menés de front, défaut `concurrency + 2`. */
  fileConcurrency?: number;
  /** Envois multipart ouverts à la fois, défaut 3. */
  maxOpenMultipart?: number;
  /** Seuil du multipart en octets, défaut 16 Mio. */
  multipartThreshold?: number;
  /** Tentatives par requête, défaut 5. */
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffCapMs?: number;
  /** Regroupement des confirmations de PUT simples, défaut 250 ms. */
  confirmDelayMs?: number;
  /** Cadence des notifications de progression, défaut 250 ms (4 par seconde). */
  progressIntervalMs?: number;
  /** Fichier d'un envoi restauré (poignée déjà autorisée…) ; `null` → `needs_file`. */
  resolveFile?: (record: UploadRecord) => Promise<Blob | null>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  createId?: () => string;
}

export interface AddUploadInput {
  file: Blob;
  bucket: string;
  key: string;
  /** Défaut : dernier segment de la clé. */
  name?: string;
  relPath?: string;
  groupId?: string;
  conflict?: ConflictChoice;
  purpose?: UploadPurpose;
  contentType?: string;
  lastModified?: number;
  source?: UploadSource;
}

interface Entry {
  record: UploadRecord;
  blob: Blob | null;
  controller: AbortController | null;
  running: boolean;
  /** Octets en vol par partie (0 = PUT simple). */
  inflight: Map<number, number>;
  displayed: number;
  speed: SpeedMeter;
  urls: Map<number, PresignedPart>;
  signing: Promise<void> | null;
  writes: Promise<void>;
}

interface PendingConfirm {
  entry: Entry;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function defaultNetwork(): NetworkMonitor {
  const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
  const target = globalThis as unknown as { addEventListener?: (t: string, l: () => void) => void; removeEventListener?: (t: string, l: () => void) => void };
  return {
    isOnline: () => nav?.onLine !== false,
    onOnline: (listener) => {
      if (typeof target.addEventListener !== 'function') return () => {};
      target.addEventListener('online', listener);
      return () => target.removeEventListener?.('online', listener);
    },
  };
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Erreur d'une requête de données d'après le statut et le code S3. */
function dataError(response: DataResponse): UploadError {
  const { status, s3Code } = response;
  const base = { status, ...(s3Code ? { details: { cause: s3Code } } : {}), ...(response.retryAfterMs !== undefined ? { retryAfterMs: response.retryAfterMs } : {}) };
  if (s3Code === 'SlowDown' || status === 503) return new UploadError({ ...base, code: 'slow_down', retryable: true });
  if (status === 429) return new UploadError({ ...base, code: 'rate_limited', retryable: true });
  if (s3Code === 'RequestTimeout' || s3Code === 'IncompleteBody' || s3Code === 'InternalError') return new UploadError({ ...base, code: 'upstream_error', retryable: true });
  if (s3Code === 'SignatureDoesNotMatch' || s3Code === 'HeadersNotSigned') return new UploadError({ ...base, code: 'signature_mismatch', reason: 'signed_headers', retryable: false });
  if (s3Code === 'RequestTimeTooSkewed') return new UploadError({ ...base, code: 'clock_skew', retryable: false });
  if (s3Code === 'NoSuchUpload') return new UploadError({ ...base, code: 'not_found', reason: 'upload_gone', retryable: false });
  if (s3Code === 'EntityTooLarge' || status === 413) return new UploadError({ ...base, code: 'entity_too_large', retryable: false });
  if (status === 403) return new UploadError({ ...base, code: 'access_denied', retryable: false });
  if (status === 412) return new UploadError({ ...base, code: 'precondition_failed', retryable: false });
  if (status === 409) return new UploadError({ ...base, code: 'conflict', retryable: true });
  if (status >= 500) return new UploadError({ ...base, code: 'upstream_error', retryable: true });
  return new UploadError({ ...base, code: 'invalid_request', retryable: false });
}

/** Sémaphore des créneaux de données (un PUT ou une partie = un créneau). */
class Slots {
  #free: number;
  readonly #waiting: Array<() => void> = [];

  constructor(count: number) {
    this.#free = Math.max(1, count);
  }

  acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    if (this.#free > 0) {
      this.#free -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const i = this.#waiting.indexOf(grant);
        if (i >= 0) this.#waiting.splice(i, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push(grant);
    });
  }

  release(): void {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#free += 1;
  }
}

export class UploadEngine {
  readonly #transport: UploadTransport;
  readonly #store: UploadStore;
  readonly #sender: DataSender;
  readonly #network: NetworkMonitor;
  readonly #slots: Slots;
  readonly #concurrency: number;
  readonly #fileConcurrency: number;
  readonly #maxOpenMultipart: number;
  readonly #threshold: number;
  readonly #maxAttempts: number;
  readonly #backoffBase: number;
  readonly #backoffCap: number;
  readonly #confirmDelay: number;
  readonly #progressInterval: number;
  readonly #resolveFile: UploadEngineOptions['resolveFile'];
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #random: () => number;
  readonly #createId: () => string;

  readonly #entries = new Map<string, Entry>();
  readonly #listeners = new Set<(snapshot: UploadSnapshot) => void>();
  readonly #onlineWaiters = new Set<() => void>();
  readonly #unsubscribeOnline: () => void;
  #snapshot: UploadSnapshot | null = null;
  #notifyTimer: ReturnType<typeof setTimeout> | null = null;
  #microtask = false;
  #confirmQueue: PendingConfirm[] = [];
  #confirmTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;

  constructor(options: UploadEngineOptions) {
    this.#transport = options.transport;
    this.#store = options.store ?? new MemoryUploadStore();
    this.#sender = options.sender ?? defaultSender();
    this.#network = options.network ?? defaultNetwork();
    this.#concurrency = Math.max(1, options.concurrency ?? 4);
    this.#slots = new Slots(this.#concurrency);
    this.#fileConcurrency = Math.max(1, options.fileConcurrency ?? this.#concurrency + 2);
    this.#maxOpenMultipart = Math.max(1, options.maxOpenMultipart ?? 3);
    this.#threshold = options.multipartThreshold ?? DEFAULT_MULTIPART_THRESHOLD;
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.#backoffBase = options.backoffBaseMs ?? 1_000;
    this.#backoffCap = options.backoffCapMs ?? 30_000;
    this.#confirmDelay = options.confirmDelayMs ?? 250;
    this.#progressInterval = options.progressIntervalMs ?? 250;
    this.#resolveFile = options.resolveFile;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
    this.#createId = options.createId ?? defaultId;
    this.#unsubscribeOnline = this.#network.onOnline(() => this.#wakeOnline());
  }

  // -------------------------------------------------------------------------
  // API publique

  /** Relit la persistance (après un rechargement) : terminés gardés 24 h, interrompus repris ou `needs_file`. */
  async restore(): Promise<void> {
    const records = await this.#store.list();
    const now = this.#now();
    for (const stored of records) {
      if (this.#entries.has(stored.id)) continue;
      if (TERMINAL_STATES.includes(stored.state)) {
        if (now - stored.updatedAt > DONE_RETENTION_MS || stored.state !== 'done') {
          await this.#store.delete(stored.id);
          continue;
        }
      }
      const entry = this.#entry({ ...stored, parts: { ...stored.parts } });
      entry.displayed = stored.state === 'done' ? stored.size : stored.bytesConfirmed;
      this.#entries.set(stored.id, entry);
      if (TERMINAL_STATES.includes(stored.state)) continue;
      // Un PUT simple envoyé dont la confirmation s'est perdue est rejoué sans le fichier.
      if (stored.mode === 'single' && stored.receipt) {
        stored.state = 'queued';
        entry.record.state = 'queued';
        continue;
      }
      const blob = this.#resolveFile ? await this.#resolveFile(entry.record).catch(() => null) : null;
      if (blob && blob.size === stored.size) entry.blob = blob;
      const keep: UploadState[] = ['error', 'conflict', 'paused', 'waiting_auth'];
      const next: UploadState = entry.blob ? (keep.includes(stored.state) ? stored.state : 'queued') : stored.state === 'conflict' ? 'conflict' : 'needs_file';
      this.#setState(entry, next);
    }
    this.#notify(true);
    this.#pump();
  }

  /** Ajoute des fichiers ; renvoie leurs identifiants. Chaque fichier reçoit aussitôt une ligne. */
  add(inputs: AddUploadInput[]): string[] {
    const now = this.#now();
    const ids: string[] = [];
    for (const input of inputs) {
      const id = this.#createId();
      const file = input.file as Blob & { lastModified?: number; type?: string };
      const record: UploadRecord = {
        id,
        bucket: input.bucket,
        key: input.key,
        name: input.name ?? nameOf(input.key),
        size: input.file.size,
        lastModified: input.lastModified ?? file.lastModified ?? now,
        source: input.source ?? { kind: 'memory' },
        conflict: input.conflict ?? 'ask',
        purpose: input.purpose ?? 'upload',
        parts: {},
        state: 'queued',
        bytesConfirmed: 0,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      const contentType = input.contentType ?? (file.type ? file.type : undefined);
      if (contentType) record.contentType = contentType;
      if (input.relPath) record.relPath = input.relPath;
      if (input.groupId) record.groupId = input.groupId;
      // Clé validée avant tout appel.
      const problem = relativeKeyProblem(record.key);
      if (problem) {
        record.state = 'error';
        record.error = { code: 'validation', reason: `key_${problem}`, retryable: false };
      }
      const entry = this.#entry(record);
      entry.blob = input.file;
      this.#entries.set(id, entry);
      this.#persist(entry);
      ids.push(id);
    }
    this.#notify(true);
    this.#pump();
    return ids;
  }

  /** Pause : requêtes abandonnées, parties confirmées gardées. */
  pause(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    const pausable: UploadState[] = ['queued', 'uploading', 'waiting_network'];
    if (!pausable.includes(entry.record.state)) return;
    this.#setState(entry, 'paused');
    entry.controller?.abort();
  }

  /** Reprise d'un envoi en pause, en attente de reconnexion ou du réseau. */
  resume(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    if (!['paused', 'waiting_auth', 'waiting_network'].includes(entry.record.state)) return;
    if (!this.#runnable(entry)) {
      this.#setState(entry, 'needs_file');
      return;
    }
    this.#setState(entry, 'queued');
    this.#pump();
  }

  /** Nouvel essai d'un envoi en erreur, depuis les parties confirmées. */
  retry(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry || entry.record.state !== 'error') return;
    const record = entry.record;
    if (record.error?.code === LOCAL_ERRORS.fileChanged) this.#forgetRemote(entry);
    record.attempts = 0;
    delete record.error;
    this.#setState(entry, this.#runnable(entry) ? 'queued' : 'needs_file');
    this.#pump();
  }

  /** Annulation : abandon côté stockage (3 essais), enregistrement supprimé. */
  async cancel(id: string): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry || TERMINAL_STATES.includes(entry.record.state)) return;
    entry.controller?.abort();
    this.#setState(entry, 'canceled', { persist: false });
    this.#rejectConfirm(entry);
    const { bucket, key, uploadId } = entry.record;
    entry.writes = entry.writes.then(() => this.#store.delete(id)).catch(() => {});
    await entry.writes;
    if (uploadId) await this.#abortRemote(bucket, key, uploadId);
  }

  pauseAll(): void {
    for (const id of [...this.#entries.keys()]) this.pause(id);
  }

  resumeAll(): void {
    for (const id of [...this.#entries.keys()]) this.resume(id);
  }

  /** Relance tous les envois en erreur réessayable (« Tout réessayer »). */
  retryAll(): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.record.state === 'error' && entry.record.error?.retryable !== false) this.retry(entry.record.id);
    }
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.#entries.keys()].map((id) => this.cancel(id)));
  }

  /** « Effacer les terminés » : terminés, annulés et ignorés retirés de la liste et de la base. */
  async clearFinished(): Promise<void> {
    const removed: string[] = [];
    for (const [id, entry] of this.#entries) {
      if (TERMINAL_STATES.includes(entry.record.state) && !entry.running) {
        this.#entries.delete(id);
        removed.push(id);
      }
    }
    this.#notify(true);
    await Promise.all(removed.map((id) => this.#store.delete(id).catch(() => {})));
  }

  /**
   * Fournit le fichier d'un envoi restauré (nouvelle sélection). Refusé (`false`) si la taille
   * ou la date diffère : l'appelant propose alors « Envoyer comme nouveau fichier ».
   */
  attachFile(id: string, file: Blob): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    const lastModified = (file as Blob & { lastModified?: number }).lastModified;
    if (file.size !== entry.record.size || (lastModified !== undefined && lastModified !== entry.record.lastModified)) return false;
    entry.blob = file;
    if (entry.record.state === 'needs_file') {
      this.#setState(entry, 'queued');
      this.#pump();
    }
    return true;
  }

  /** Choix d'un conflit : remplacer, conserver les deux, ignorer ; `all` : tous les conflits en attente. */
  resolveConflict(id: string, choice: Exclude<ConflictChoice, 'ask'>, all = false): void {
    const targets = all ? [...this.#entries.values()].filter((e) => e.record.state === 'conflict') : [this.#entries.get(id)].filter((e): e is Entry => !!e);
    for (const entry of targets) {
      if (entry.record.state !== 'conflict') continue;
      entry.record.conflict = choice;
      delete entry.record.error;
      if (choice === 'skip') {
        this.#setState(entry, 'skipped');
        continue;
      }
      this.#setState(entry, entry.blob ? 'queued' : 'needs_file');
    }
    this.#pump();
  }

  get(id: string): UploadItemView | undefined {
    return this.getSnapshot().items.find((item) => item.id === id);
  }

  /** Enregistrement brut (tests, diagnostic). */
  record(id: string): UploadRecord | undefined {
    const entry = this.#entries.get(id);
    return entry ? structuredClone({ ...entry.record, source: { kind: 'memory' } }) : undefined;
  }

  subscribe(listener: (snapshot: UploadSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Instantané stable (même objet tant que rien ne change), compatible avec `useSyncExternalStore`. */
  getSnapshot(): UploadSnapshot {
    this.#snapshot ??= this.#buildSnapshot();
    return this.#snapshot;
  }

  /** Résout quand plus rien n'est en file ni en cours. */
  whenIdle(): Promise<void> {
    const idle = () => [...this.#entries.values()].every((e) => !e.running && !['queued', 'uploading', 'completing'].includes(e.record.state));
    if (idle()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (idle()) {
          this.#listeners.delete(check);
          resolve();
        }
      };
      this.#listeners.add(check);
    });
  }

  /** Arrête tout sans rien abandonner côté stockage (fermeture de l'onglet, tests de reprise). */
  destroy(): void {
    this.#destroyed = true;
    this.#unsubscribeOnline();
    for (const entry of this.#entries.values()) entry.controller?.abort();
    if (this.#notifyTimer) clearTimeout(this.#notifyTimer);
    if (this.#confirmTimer) clearTimeout(this.#confirmTimer);
    this.#listeners.clear();
  }

  /** Écritures en attente vers la persistance (tests, déchargement). */
  async flush(): Promise<void> {
    await Promise.all([...this.#entries.values()].map((e) => e.writes));
  }

  // -------------------------------------------------------------------------
  // Ordonnancement

  #entry(record: UploadRecord): Entry {
    return {
      record,
      blob: null,
      controller: null,
      running: false,
      inflight: new Map(),
      displayed: 0,
      speed: new SpeedMeter(),
      urls: new Map(),
      signing: null,
      writes: Promise.resolve(),
    };
  }

  #isMultipart(entry: Entry): boolean {
    return entry.record.mode === 'multipart' || (!entry.record.mode && entry.record.size > this.#threshold);
  }

  #pump(): void {
    if (this.#destroyed) return;
    const running = [...this.#entries.values()].filter((e) => e.running);
    let active = running.length;
    let openMultipart = running.filter((e) => this.#isMultipart(e)).length;
    // Groupe déjà commencé avant le reste, puis ordre d'ajout.
    const started = new Set<string>();
    for (const e of this.#entries.values()) {
      if (e.record.groupId && (e.running || e.record.state === 'done')) started.add(e.record.groupId);
    }
    const priority = (e: Entry) => (e.record.groupId && started.has(e.record.groupId) ? 1 : 0);
    const queued = [...this.#entries.values()]
      .filter((e) => !e.running && e.record.state === 'queued' && this.#runnable(e))
      .sort((a, b) => priority(b) - priority(a) || a.record.createdAt - b.record.createdAt);
    for (const entry of queued) {
      if (active >= this.#fileConcurrency) break;
      const multipart = this.#isMultipart(entry) && !entry.record.receipt;
      if (multipart && openMultipart >= this.#maxOpenMultipart) continue;
      active += 1;
      if (multipart) openMultipart += 1;
      void this.#run(entry);
    }
  }

  /** Un envoi peut partir sans son fichier s'il ne reste qu'à confirmer ou à finaliser. */
  #runnable(entry: Entry): boolean {
    const record = entry.record;
    if (entry.blob || record.receipt) return true;
    if (record.mode !== 'multipart' || !record.uploadId || !record.partCount) return false;
    return Object.keys(record.parts).length === record.partCount;
  }

  async #run(entry: Entry): Promise<void> {
    const controller = new AbortController();
    entry.controller = controller;
    entry.running = true;
    const { signal } = controller;
    const record = entry.record;
    try {
      if (record.mode === 'single' && record.receipt) {
        this.#setState(entry, 'completing');
        await this.#confirm(entry);
        return;
      }
      this.#setState(entry, 'uploading');
      for (let restart = 0; ; restart += 1) {
        try {
          if (record.mode === 'multipart' && record.uploadId && (await this.#reconcile(entry, signal))) {
            await this.#multipart(entry, signal);
          } else {
            await this.#start(entry, signal);
          }
          return;
        } catch (error) {
          // Envoi expiré côté stockage : il recommence, une fois.
          if (restart === 0 && error instanceof UploadError && error.reason === 'upload_gone' && !signal.aborted) {
            this.#forgetRemote(entry, false);
            this.#setState(entry, 'uploading');
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      this.#fail(entry, toUploadError(error));
    } finally {
      entry.running = false;
      if (entry.controller === controller) entry.controller = null;
      entry.inflight.clear();
      this.#notify(true);
      this.#pump();
    }
  }

  #fail(entry: Entry, error: UploadError): void {
    if (error.code === 'unauthorized' || error.code === 'token_expired') {
      entry.record.error = error.toInfo();
      this.#setState(entry, 'waiting_auth');
      return;
    }
    entry.record.error = error.toInfo();
    this.#setState(entry, 'error');
  }

  // -------------------------------------------------------------------------
  // Création et conflits

  async #start(entry: Entry, signal: AbortSignal): Promise<void> {
    const record = entry.record;
    const mode: 'single' | 'multipart' = record.size > this.#threshold ? 'multipart' : 'single';
    const response = await this.#create(entry, mode, signal);
    if (!response) return;
    if (response.mode === 'single') {
      record.mode = 'single';
      entry.displayed = 0;
      const etag = await this.#send(entry, 0, signal, async () => ({ url: response.url, headers: response.headers, expiresAt: response.expiresAt }));
      record.receipt = response.receipt;
      record.bytesConfirmed = record.size;
      record.result = { key: record.key, etag: etag ?? '', size: record.size };
      this.#setState(entry, 'completing');
      await this.#confirm(entry);
      return;
    }
    record.mode = 'multipart';
    record.uploadId = response.uploadId;
    record.partSize = response.partSize;
    record.partCount = response.partCount;
    record.parts = {};
    record.bytesConfirmed = 0;
    entry.urls.clear();
    for (const part of response.parts ?? []) entry.urls.set(part.partNumber, part);
    this.#persist(entry);
    await this.#multipart(entry, signal);
  }

  /** Création avec la conduite de conflit ; `null` si l'envoi attend un choix ou est ignoré. */
  async #create(entry: Entry, mode: 'single' | 'multipart', signal: AbortSignal): Promise<CreateUploadResponse | null> {
    const record = entry.record;
    const attempt = (key: string, conflict: 'overwrite' | 'fail') =>
      this.#retrying(
        () =>
          this.#transport.create({
            bucket: record.bucket,
            key,
            size: record.size,
            mode,
            purpose: record.purpose,
            conflict,
            idempotencyKey: record.id,
            lastModified: record.lastModified,
            ...(record.contentType ? { contentType: record.contentType } : {}),
            signal,
          }),
        signal,
      );
    const exists = (error: unknown) => error instanceof UploadError && error.code === 'already_exists';
    if (record.conflict === 'overwrite') return attempt(record.key, 'overwrite');
    try {
      return await attempt(record.key, 'fail');
    } catch (error) {
      if (!exists(error)) throw error;
    }
    if (record.conflict === 'skip') {
      this.#setState(entry, 'skipped');
      return null;
    }
    if (record.conflict === 'ask') {
      record.error = { code: 'already_exists', reason: 'key_exists', retryable: false, details: { existingKey: record.key } };
      this.#setState(entry, 'conflict');
      return null;
    }
    // « Conserver les deux » : premier nom libre.
    for (const candidate of freeNameCandidates(record.name)) {
      const key = withName(record.key, candidate);
      try {
        const response = await attempt(key, 'fail');
        record.key = key;
        record.name = candidate;
        this.#persist(entry);
        return response;
      } catch (error) {
        if (!exists(error)) throw error;
      }
    }
    throw new UploadError({ code: 'conflict', reason: 'no_free_name', retryable: false });
  }

  // -------------------------------------------------------------------------
  // Multipart

  #partSize(record: UploadRecord, partNumber: number): number {
    const partSize = record.partSize!;
    const count = record.partCount!;
    return partNumber < count ? partSize : record.size - partSize * (count - 1);
  }

  /** Réconciliation par `listParts` ; `false` si l'envoi n'existe plus côté stockage. */
  async #reconcile(entry: Entry, signal: AbortSignal): Promise<boolean> {
    const record = entry.record;
    let listed: Array<{ partNumber: number; etag: string; size: number }>;
    try {
      listed = await this.#retrying(() => this.#transport.listParts({ bucket: record.bucket, key: record.key, uploadId: record.uploadId!, signal }), signal);
    } catch (error) {
      if (error instanceof UploadError && error.code === 'not_found') {
        this.#forgetRemote(entry, false);
        return false;
      }
      throw error;
    }
    const parts: UploadRecord['parts'] = {};
    let confirmed = 0;
    for (const part of listed) {
      if (part.partNumber > record.partCount! || part.size !== this.#partSize(record, part.partNumber)) continue;
      parts[part.partNumber] = { etag: part.etag, size: part.size };
      confirmed += part.size;
    }
    record.parts = parts;
    record.bytesConfirmed = confirmed;
    entry.displayed = Math.max(entry.displayed, confirmed);
    this.#persist(entry);
    this.#notify(true);
    return true;
  }

  /** Oublie l'envoi multipart côté stockage (expiré, ou fichier changé : abandon en arrière-plan). */
  #forgetRemote(entry: Entry, abort = true): void {
    const { bucket, key, uploadId } = entry.record;
    if (abort && uploadId) void this.#abortRemote(bucket, key, uploadId);
    delete entry.record.uploadId;
    delete entry.record.partSize;
    delete entry.record.partCount;
    delete entry.record.mode;
    delete entry.record.receipt;
    entry.record.parts = {};
    entry.record.bytesConfirmed = 0;
    entry.displayed = 0;
    entry.urls.clear();
  }

  async #multipart(entry: Entry, signal: AbortSignal): Promise<void> {
    const record = entry.record;
    for (let round = 0; round < 2; round += 1) {
      await this.#uploadMissing(entry, signal);
      this.#setState(entry, 'completing');
      try {
        const parts = Object.entries(record.parts)
          .map(([n, p]) => ({ partNumber: Number(n), ...(p.etag ? { etag: p.etag } : {}) }))
          .sort((a, b) => a.partNumber - b.partNumber);
        const result = await this.#retrying(
          () => this.#transport.complete({ bucket: record.bucket, key: record.key, uploadId: record.uploadId!, size: record.size, parts, signal }),
          signal,
        );
        record.result = result;
        record.bytesConfirmed = record.size;
        entry.displayed = record.size;
        this.#setState(entry, 'done');
        return;
      } catch (error) {
        // Liste incohérente : on relit les parties et on renvoie les manquantes, une fois.
        if (round === 0 && error instanceof UploadError && error.reason === 'parts_mismatch') {
          this.#setState(entry, 'uploading');
          if (await this.#reconcile(entry, signal)) continue;
        }
        throw error;
      }
    }
  }

  async #uploadMissing(entry: Entry, signal: AbortSignal): Promise<void> {
    const record = entry.record;
    const missing: number[] = [];
    for (let n = 1; n <= record.partCount!; n += 1) if (!record.parts[n]) missing.push(n);
    if (missing.length === 0) return;
    const child = new AbortController();
    const onAbort = () => child.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let failure: unknown = null;
    const worker = async () => {
      while (missing.length > 0 && !child.signal.aborted) {
        const partNumber = missing.shift()!;
        try {
          const etag = await this.#send(entry, partNumber, child.signal, (force) => this.#partUrl(entry, partNumber, force, child.signal));
          record.parts[partNumber] = { etag: etag ?? '', size: this.#partSize(record, partNumber) };
          record.bytesConfirmed += this.#partSize(record, partNumber);
          this.#persist(entry);
        } catch (error) {
          failure ??= error;
          child.abort();
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(this.#concurrency, missing.length) }, worker));
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    if (failure) throw failure;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  /** URL d'une partie, par lots de 20 ; représignée si elle expire dans moins de 60 s. */
  async #partUrl(entry: Entry, partNumber: number, force: boolean, signal: AbortSignal): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }> {
    if (force) entry.urls.delete(partNumber);
    for (;;) {
      const cached = entry.urls.get(partNumber);
      if (cached && Date.parse(cached.expiresAt) - this.#now() > RESIGN_MARGIN_MS) return cached;
      if (entry.signing) {
        await entry.signing;
        continue;
      }
      const record = entry.record;
      const wanted: Array<{ partNumber: number; size: number }> = [];
      for (let n = partNumber; n <= record.partCount! && wanted.length < SIGN_BATCH; n += 1) {
        const known = entry.urls.get(n);
        const fresh = known && Date.parse(known.expiresAt) - this.#now() > RESIGN_MARGIN_MS;
        if (n !== partNumber && (record.parts[n] || fresh)) continue;
        wanted.push({ partNumber: n, size: this.#partSize(record, n) });
      }
      entry.signing = this.#retrying(
        () => this.#transport.signParts({ bucket: record.bucket, key: record.key, uploadId: record.uploadId!, parts: wanted, signal }),
        signal,
      ).then((parts) => {
        for (const part of parts) entry.urls.set(part.partNumber, part);
      });
      try {
        await entry.signing;
      } finally {
        entry.signing = null;
      }
      if (!entry.urls.has(partNumber)) throw new UploadError({ code: LOCAL_ERRORS.invalidResponse, reason: 'part_missing', retryable: false });
    }
  }

  // -------------------------------------------------------------------------
  // Données

  /** Envoie une partie (ou le PUT simple, numéro 0) avec les nouveaux essais ; renvoie l'ETag lisible. */
  async #send(
    entry: Entry,
    partNumber: number,
    signal: AbortSignal,
    sign: (force: boolean) => Promise<{ url: string; headers: Record<string, string>; expiresAt: string }>,
  ): Promise<string | null> {
    const record = entry.record;
    const start = partNumber === 0 ? 0 : (partNumber - 1) * record.partSize!;
    const end = partNumber === 0 ? record.size : start + this.#partSize(record, partNumber);
    const blob = entry.blob;
    if (!blob) throw new UploadError({ code: LOCAL_ERRORS.fileUnreadable, retryable: false });
    const body = partNumber === 0 && start === 0 && end === blob.size ? blob : blob.slice(start, end);
    let attempts = 0;
    let force = false;
    let resigned = false;
    for (;;) {
      if (!this.#network.isOnline()) await this.#waitOnline(entry, signal);
      const signed = await sign(force);
      force = false;
      await this.#slots.acquire(signal);
      let response: DataResponse | null = null;
      let failure: UploadError | null = null;
      let last = 0;
      try {
        response = await this.#sender({
          url: signed.url,
          headers: signed.headers,
          body,
          signal,
          onProgress: (loaded) => {
            const delta = loaded - last;
            last = loaded;
            entry.speed.add(delta, this.#now());
            entry.inflight.set(partNumber, loaded);
            this.#notify(false);
          },
        });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error;
        failure = toUploadError(error);
      } finally {
        this.#slots.release();
        entry.inflight.delete(partNumber);
      }
      if (response && response.status >= 200 && response.status < 300) {
        const etag = response.etag ? response.etag.replace(/"/g, '') : null;
        // Progression : les octets de la requête passent dans les confirmés (sans recul de l'affichage).
        if (last < body.size) entry.speed.add(body.size - last, this.#now());
        return etag;
      }
      const expired = this.#now() >= Date.parse(signed.expiresAt) - EXPIRY_MARGIN_MS;
      // URL expirée (y compris un échec opaque près de l'échéance) : nouvelle signature sans essai consommé.
      if (expired && (failure || response?.status === 403)) {
        force = true;
        continue;
      }
      const error = failure ?? dataError(response!);
      if (error.code === LOCAL_ERRORS.network && !this.#network.isOnline()) continue;
      if (error.code === 'signature_mismatch' && !resigned) {
        resigned = true;
        force = true;
        continue;
      }
      if (!error.retryable) throw error;
      attempts += 1;
      record.attempts += 1;
      if (attempts >= this.#maxAttempts) throw error;
      await this.#sleep(this.#backoff(attempts, error.retryAfterMs), signal);
      force = Date.parse(signed.expiresAt) - this.#now() < RESIGN_MARGIN_MS;
    }
  }

  /** Appel de l'API avec nouveaux essais ; réseau coupé : attente sans essai consommé. */
  async #retrying<T>(call: () => Promise<T>, signal: AbortSignal): Promise<T> {
    let attempts = 0;
    for (;;) {
      try {
        return await call();
      } catch (raw) {
        if (signal.aborted || isAbortError(raw)) throw raw;
        const error = toUploadError(raw);
        if (error.code === LOCAL_ERRORS.network && !this.#network.isOnline()) {
          await this.#waitOnline(null, signal);
          continue;
        }
        if (!error.retryable) throw error;
        attempts += 1;
        if (attempts >= this.#maxAttempts) throw error;
        await this.#sleep(this.#backoff(attempts, error.retryAfterMs), signal);
      }
    }
  }

  /** Recul exponentiel à gigue complète : base 1 s, ×2, plafond 30 s ; `Retry-After` prioritaire. */
  #backoff(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return retryAfterMs;
    return Math.round(this.#random() * Math.min(this.#backoffCap, this.#backoffBase * 2 ** (attempt - 1)));
  }

  async #waitOnline(entry: Entry | null, signal: AbortSignal): Promise<void> {
    if (this.#network.isOnline()) return;
    const previous = entry?.record.state;
    if (entry) this.#setState(entry, 'waiting_network');
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        this.#onlineWaiters.delete(done);
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        this.#onlineWaiters.delete(done);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#onlineWaiters.add(done);
    });
    if (entry && entry.record.state === 'waiting_network' && previous) this.#setState(entry, previous);
  }

  #wakeOnline(): void {
    for (const waiter of [...this.#onlineWaiters]) waiter();
    for (const entry of this.#entries.values()) {
      if (entry.record.state === 'waiting_network' && !entry.running) this.#setState(entry, 'queued');
    }
    this.#pump();
  }

  // -------------------------------------------------------------------------
  // Confirmation des PUT simples

  #confirm(entry: Entry): Promise<void> {
    if (!this.#transport.confirm) {
      this.#finishSingle(entry);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.#confirmQueue.push({ entry, resolve, reject });
      if (this.#confirmQueue.length >= 100) void this.#flushConfirm();
      else this.#confirmTimer ??= setTimeout(() => void this.#flushConfirm(), this.#confirmDelay);
    });
  }

  #rejectConfirm(entry: Entry): void {
    const pending = this.#confirmQueue.filter((p) => p.entry === entry);
    this.#confirmQueue = this.#confirmQueue.filter((p) => p.entry !== entry);
    for (const p of pending) p.reject(new DOMException('Aborted', 'AbortError'));
  }

  async #flushConfirm(): Promise<void> {
    if (this.#confirmTimer) clearTimeout(this.#confirmTimer);
    this.#confirmTimer = null;
    const batch = this.#confirmQueue.splice(0, 100);
    if (batch.length === 0) return;
    if (this.#confirmQueue.length > 0) this.#confirmTimer = setTimeout(() => void this.#flushConfirm(), 0);
    const byBucket = new Map<string, PendingConfirm[]>();
    for (const item of batch) byBucket.set(item.entry.record.bucket, [...(byBucket.get(item.entry.record.bucket) ?? []), item]);
    const signal = new AbortController().signal;
    for (const [bucket, items] of byBucket) {
      try {
        const results = await this.#retrying(
          () =>
            this.#transport.confirm!(
              bucket,
              items.map(({ entry }) => ({
                key: entry.record.key,
                receipt: entry.record.receipt!,
                size: entry.record.size,
              })),
              signal,
            ),
          signal,
        );
        for (const item of items) {
          const result = results.find((r) => r.key === item.entry.record.key);
          if (result?.ok) {
            this.#finishSingle(item.entry);
            item.resolve();
          } else {
            item.reject(new UploadError({ ...(result?.error ?? { code: LOCAL_ERRORS.invalidResponse, retryable: false }) }));
          }
        }
      } catch (error) {
        for (const item of items) item.reject(error);
      }
    }
  }

  #finishSingle(entry: Entry): void {
    const record = entry.record;
    if (record.state === 'canceled') return;
    delete record.receipt;
    record.result ??= { key: record.key, etag: '', size: record.size };
    record.bytesConfirmed = record.size;
    entry.displayed = record.size;
    this.#setState(entry, 'done');
  }

  async #abortRemote(bucket: string, key: string, uploadId: string): Promise<void> {
    const signal = new AbortController().signal;
    for (let attempt = 1; attempt <= ABORT_ATTEMPTS; attempt += 1) {
      try {
        await this.#transport.abort({ bucket, key, uploadId, signal });
        return;
      } catch (error) {
        if (error instanceof UploadError && error.code === 'not_found') return;
        if (attempt < ABORT_ATTEMPTS) await this.#sleep(this.#backoff(attempt), signal).catch(() => {});
      }
    }
  }

  // -------------------------------------------------------------------------
  // État, persistance, notifications

  #setState(entry: Entry, state: UploadState, { persist = true }: { persist?: boolean } = {}): void {
    if (entry.record.state === state) return;
    entry.record.state = state;
    entry.record.updatedAt = this.#now();
    if (state === 'paused' && entry.record.mode === 'single') {
      // Un PUT simple en pause repart de zéro.
      entry.displayed = 0;
      entry.speed.reset();
    }
    if (persist) this.#persist(entry);
    this.#notify(true);
  }

  /** Écriture sérialisée par envoi (jamais d'URL signée : elles ne sont pas dans l'enregistrement). */
  #persist(entry: Entry): void {
    if (entry.record.state === 'canceled') return;
    const record = entry.record;
    entry.writes = entry.writes
      .then(() => (entry.record.state === 'canceled' ? undefined : this.#store.put({ ...record, parts: { ...record.parts } })))
      .catch(() => {});
  }

  #notify(immediate: boolean): void {
    this.#snapshot = null;
    if (this.#destroyed) return;
    if (immediate) {
      if (this.#microtask) return;
      this.#microtask = true;
      queueMicrotask(() => {
        this.#microtask = false;
        if (this.#notifyTimer) {
          clearTimeout(this.#notifyTimer);
          this.#notifyTimer = null;
        }
        this.#emit();
      });
      return;
    }
    this.#notifyTimer ??= setTimeout(() => {
      this.#notifyTimer = null;
      this.#emit();
    }, this.#progressInterval);
  }

  #emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.#listeners]) listener(snapshot);
  }

  #buildSnapshot(): UploadSnapshot {
    const now = this.#now();
    const items: UploadItemView[] = [];
    let bytes = 0;
    let sent = 0;
    let speed = 0;
    let active = 0;
    let errors = 0;
    let done = 0;
    let reliable = false;
    for (const entry of this.#entries.values()) {
      const record = entry.record;
      let inflight = 0;
      for (const loaded of entry.inflight.values()) inflight += loaded;
      const current = record.state === 'done' ? record.size : Math.min(record.size, record.bytesConfirmed + inflight);
      entry.displayed = Math.max(entry.displayed, current);
      const running = record.state === 'uploading' || record.state === 'completing';
      const itemSpeed = running ? entry.speed.value(now) : 0;
      const remaining = record.size - entry.displayed;
      const view: UploadItemView = {
        id: record.id,
        bucket: record.bucket,
        key: record.key,
        name: record.name,
        size: record.size,
        state: record.state,
        sent: entry.displayed,
        speed: itemSpeed,
        remainingMs: running && entry.speed.reliable(now) && itemSpeed > 0 ? Math.round((remaining / itemSpeed) * 1000) : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
      if (record.relPath) view.relPath = record.relPath;
      if (record.groupId) view.groupId = record.groupId;
      if (record.contentType) view.contentType = record.contentType;
      if (record.mode) view.mode = record.mode;
      if (record.error) view.error = { ...record.error };
      if (record.result) view.result = { ...record.result };
      items.push(view);
      if (record.state === 'canceled' || record.state === 'skipped') continue;
      if (record.state === 'error') errors += 1;
      else if (record.state === 'done') done += 1;
      else if (record.state !== 'conflict') active += 1;
      if (record.state !== 'error') {
        bytes += record.size;
        sent += entry.displayed;
      }
      speed += itemSpeed;
      reliable ||= running && entry.speed.reliable(now);
    }
    items.sort((a, b) => a.createdAt - b.createdAt);
    const remainingMs = reliable && speed > 0 && active > 0 ? Math.round(((bytes - sent) / speed) * 1000) : null;
    return { items, totals: { active, bytes, sent, speed, remainingMs, errors, done } };
  }
}

/** Crée un moteur d'envoi. */
export function createUploadEngine(options: UploadEngineOptions): UploadEngine {
  return new UploadEngine(options);
}


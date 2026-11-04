import type { CreateUploadResponse, PresignedPart, UploadPurpose, UploadResult } from '@ud/contracts';

// Types du moteur d'envoi : état persisté, transport et persistance injectables.

/** États d'un envoi ; `skipped` : conflit résolu par « Ignorer ». */
export type UploadState =
  | 'queued'
  | 'uploading'
  | 'paused'
  | 'waiting_network'
  | 'waiting_auth'
  | 'completing'
  | 'done'
  | 'error'
  | 'canceled'
  | 'needs_file'
  | 'conflict'
  | 'skipped';

/** États terminaux : plus rien ne part. */
export const TERMINAL_STATES: readonly UploadState[] = ['done', 'canceled', 'skipped'];
/** États où l'envoi occupe un créneau. */
export const ACTIVE_STATES: readonly UploadState[] = ['uploading', 'completing'];

/**
 * Conduite en cas de clé existante : `ask` refuse l'écrasement et met l'envoi en `conflict`
 * jusqu'au choix (`resolveConflict`) ; `rename` cherche le premier nom libre ; `skip` ignore.
 */
export type ConflictChoice = 'ask' | 'overwrite' | 'rename' | 'skip';

/** Origine des octets : la reprise après rechargement en dépend. */
export type UploadSource =
  | { kind: 'memory' }
  /** Poignée File System Access (Chromium), clonable dans IndexedDB. */
  | { kind: 'handle'; handle: unknown };

/** Erreur enregistrée : code stable ou erreur locale (`local.*`), jamais d'URL ni de secret. */
export interface UploadErrorInfo {
  code: string;
  reason?: string;
  retryable: boolean;
  status?: number;
  /** Champs utiles à l'affichage (`remaining`, `limit` d'un refus de quota, `existingKey`…). */
  details?: Record<string, unknown>;
}

export interface UploadedPartRecord {
  etag: string;
  size: number;
}

/** Enregistrement persisté d'un envoi (table `uploads` d'08) ; sérialisable, sans `Blob`. */
export interface UploadRecord {
  /** Identifiant local (aussi `Idempotency-Key` de la création). */
  id: string;
  bucket: string;
  /** Clé cible (relative à l'espace en mode instance). */
  key: string;
  /** Chemin relatif dans un dossier envoyé (`Photos/2024/a.jpg`). */
  relPath?: string;
  /** Lot d'un dossier glissé. */
  groupId?: string;
  name: string;
  size: number;
  lastModified: number;
  contentType?: string;
  source: UploadSource;
  conflict: ConflictChoice;
  purpose: UploadPurpose;
  mode?: 'single' | 'multipart';
  uploadId?: string;
  partSize?: number;
  partCount?: number;
  /** Parties confirmées, par numéro. */
  parts: Record<number, UploadedPartRecord>;
  /** Reçu d'un PUT simple envoyé, à confirmer. */
  receipt?: string;
  state: UploadState;
  error?: UploadErrorInfo;
  bytesConfirmed: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  result?: UploadResult;
}

/** Vue d'un envoi pour l'interface (progression monotone, débit, temps restant). */
export interface UploadItemView {
  id: string;
  bucket: string;
  key: string;
  name: string;
  relPath?: string;
  groupId?: string;
  size: number;
  contentType?: string;
  state: UploadState;
  mode?: 'single' | 'multipart';
  /** Octets affichés (monotone). */
  sent: number;
  /** Octets par seconde (moyenne mobile sur 5 s) ; 0 si inconnu. */
  speed: number;
  /** Millisecondes restantes, `null` tant que la mesure n'est pas fiable. */
  remainingMs: number | null;
  error?: UploadErrorInfo;
  result?: UploadResult;
  createdAt: number;
  updatedAt: number;
}

export interface UploadTotals {
  /** Envois non terminaux (hors erreurs et conflits en attente). */
  active: number;
  /** Octets de tous les envois non annulés. */
  bytes: number;
  sent: number;
  speed: number;
  remainingMs: number | null;
  errors: number;
  done: number;
}

export interface UploadSnapshot {
  items: UploadItemView[];
  totals: UploadTotals;
}

// ---------------------------------------------------------------------------
// Transport : les routes de l'API, jamais les octets.

export interface CreateUploadInput {
  bucket: string;
  key: string;
  size: number;
  contentType?: string;
  lastModified?: number;
  mode: 'single' | 'multipart';
  purpose: UploadPurpose;
  /** `fail` : la clé ne doit pas exister (`already_exists` sinon). */
  conflict: 'overwrite' | 'fail';
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface UploadRef {
  bucket: string;
  key: string;
  uploadId: string;
  signal?: AbortSignal;
}

export interface ConfirmItem {
  key: string;
  receipt: string;
  size: number;
  etag?: string;
}

export interface ConfirmResult {
  key: string;
  ok: boolean;
  error?: UploadErrorInfo;
}

/**
 * Accès aux routes d'envoi. Chaque méthode lève une `UploadError` en cas de refus.
 * La taille déclarée à `create` est réservée par le serveur.
 */
export interface UploadTransport {
  create(input: CreateUploadInput): Promise<CreateUploadResponse>;
  signParts(input: UploadRef & { parts: Array<{ partNumber: number; size: number }> }): Promise<PresignedPart[]>;
  listParts(input: UploadRef): Promise<Array<{ partNumber: number; etag: string; size: number }>>;
  complete(input: UploadRef & { size: number; parts: Array<{ partNumber: number; etag?: string }> }): Promise<UploadResult>;
  abort(input: UploadRef): Promise<void>;
  /** Confirmation groupée des PUT simples ; facultative (le serveur finalise seul sinon). */
  confirm?(bucket: string, items: ConfirmItem[], signal?: AbortSignal): Promise<ConfirmResult[]>;
}

/** Requête de données vers S3 : en-têtes signés envoyés tels quels. */
export interface DataRequest {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  signal: AbortSignal;
  /** Octets envoyés jusqu'ici pour cette requête. */
  onProgress?: (loaded: number) => void;
}

export interface DataResponse {
  status: number;
  /** ETag lisible (CORS `ExposeHeaders`), sinon `null`. */
  etag: string | null;
  /** Code S3 lu dans un corps d'erreur XML, si lisible. */
  s3Code?: string;
  retryAfterMs?: number;
}

/** Envoi des octets ; lève une `TypeError` (ou équivalent) pour une erreur réseau. */
export type DataSender = (request: DataRequest) => Promise<DataResponse>;

// ---------------------------------------------------------------------------
// Persistance injectable (IndexedDB dans le navigateur, mémoire sous Node).

export interface UploadStore {
  list(): Promise<UploadRecord[]>;
  put(record: UploadRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** État du réseau ; défaut : `navigator.onLine` et les événements `online`. */
export interface NetworkMonitor {
  isOnline(): boolean;
  onOnline(listener: () => void): () => void;
}

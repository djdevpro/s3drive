import { apiErrorSchema } from '@ud/contracts';
import type { UploadErrorInfo } from './types.js';

// Erreurs du moteur d'envoi : codes stables de l'API et erreurs locales `local.*` (06 annexe A).

/** Codes d'erreur locaux (jamais émis par le serveur). */
export const LOCAL_ERRORS = {
  network: 'local.network',
  fileChanged: 'local.file_changed',
  reselectMismatch: 'local.reselect_mismatch',
  fileUnreadable: 'local.file_unreadable',
  invalidResponse: 'local.invalid_response',
} as const;

/** Codes de l'API rejoués par le moteur. */
const RETRYABLE_CODES = new Set(['internal', 'upstream_error', 'slow_down', 'rate_limited', 'endpoint_unreachable', 'clock_skew']);
const RETRYABLE_STATUS = new Set([0, 408, 429, 500, 502, 503, 504]);
/** Code d'une réponse d'erreur illisible (proxy, page HTML). */
const STATUS_CODES: Record<number, string> = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 413: 'entity_too_large', 429: 'rate_limited' };

export class UploadError extends Error {
  readonly code: string;
  readonly reason: string | undefined;
  readonly status: number | undefined;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  /** Délai demandé par le serveur (`Retry-After`), en millisecondes. */
  readonly retryAfterMs: number | undefined;

  constructor(init: { code: string; message?: string; reason?: string; status?: number; details?: Record<string, unknown>; retryable?: boolean; retryAfterMs?: number }) {
    super(init.message ?? init.code);
    this.name = 'UploadError';
    this.code = init.code;
    this.reason = init.reason ?? (typeof init.details?.['reason'] === 'string' ? (init.details['reason'] as string) : undefined);
    this.status = init.status;
    this.details = init.details ?? {};
    this.retryAfterMs = init.retryAfterMs;
    this.retryable = init.retryable ?? (RETRYABLE_CODES.has(init.code) || (init.status !== undefined && RETRYABLE_STATUS.has(init.status) && init.code !== 'quota_exceeded'));
  }

  toInfo(): UploadErrorInfo {
    const info: UploadErrorInfo = { code: this.code, retryable: this.retryable };
    if (this.reason) info.reason = this.reason;
    if (this.status !== undefined) info.status = this.status;
    // Seuls des champs d'affichage sont gardés : jamais d'URL, d'en-tête ou de corps brut.
    const details: Record<string, unknown> = {};
    for (const name of ['remaining', 'limit', 'existingKey', 'maxBytes', 'partNumber', 'requestId']) {
      if (this.details[name] !== undefined) details[name] = this.details[name];
    }
    if (Object.keys(details).length > 0) info.details = details;
    return info;
  }
}

/** Délai `Retry-After` (secondes ou date HTTP), borné à 60 s. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(ms, 60_000);
}

/** Erreur typée à partir d'une réponse d'erreur de l'API (`{ error, message, details? }`). */
export async function errorFromResponse(response: Response): Promise<UploadError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    return new UploadError({
      code: parsed.data.error,
      message: parsed.data.message,
      status: response.status,
      details: { ...(parsed.data.details ?? {}), ...(parsed.data.s3?.requestId ? { requestId: parsed.data.s3.requestId } : {}) },
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  return new UploadError({
    code: STATUS_CODES[response.status] ?? (response.status >= 500 ? 'upstream_error' : 'invalid_request'),
    message: `HTTP ${response.status}`,
    status: response.status,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

/** Erreur réseau (statut 0, `TypeError` de `fetch`), réessayable. */
export function networkError(cause?: unknown): UploadError {
  const error = new UploadError({ code: LOCAL_ERRORS.network, status: 0, retryable: true, message: 'Network error' });
  if (cause !== undefined) (error as { cause?: unknown }).cause = cause;
  return error;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/** Toute erreur ramenée à une `UploadError`. */
export function toUploadError(error: unknown): UploadError {
  if (error instanceof UploadError) return error;
  if (error instanceof TypeError) return networkError(error);
  return new UploadError({ code: 'internal', message: error instanceof Error ? error.message : 'Unknown error', retryable: false });
}

import { type ErrorCode, type ErrorDetails, httpStatusForError, isErrorCode } from '@ud/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Erreur d'API rendue en enveloppe `{ error, message, details?, s3? }`. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails | undefined;
  readonly s3: { code: string; requestId?: string } | undefined;

  constructor(code: ErrorCode, message: string, details?: ErrorDetails, s3?: { code: string; requestId?: string }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.s3 = s3;
  }

  get status(): number {
    return httpStatusForError(this.code);
  }
}

export function apiError(code: ErrorCode, message: string, details?: ErrorDetails): ApiError {
  return new ApiError(code, message, details);
}

/**
 * Reconnaît une erreur du moteur `@ud/s3` (`S3Error` : `code` de la liste fermée, `status`, `s3`)
 * sans en importer la classe : le moteur peut être remplacé (tests, autre implémentation).
 */
export function fromEngineError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (!(err instanceof Error)) return null;
  const candidate = err as Error & { code?: unknown; retryable?: unknown; s3?: { code?: unknown; requestId?: unknown } };
  if (!isErrorCode(candidate.code)) return null;
  const s3 =
    candidate.s3 && typeof candidate.s3.code === 'string'
      ? {
          code: candidate.s3.code,
          ...(typeof candidate.s3.requestId === 'string' ? { requestId: candidate.s3.requestId } : {}),
        }
      : undefined;
  // `S3Error.details` du moteur : seuls les champs connus et sans donnée de l'utilisateur sont repris.
  const raw = (err as { details?: Record<string, unknown> }).details ?? {};
  const picked: ErrorDetails = {};
  if (typeof raw['reason'] === 'string') picked.reason = raw['reason'];
  if (typeof raw['retryAfter'] === 'number') picked.retryAfter = raw['retryAfter'];
  if (typeof raw['cause'] === 'string') picked.cause = raw['cause'];
  const retryable = typeof raw['retryable'] === 'boolean' ? raw['retryable'] : candidate.retryable;
  if (typeof retryable === 'boolean') picked.retryable = retryable;
  const details: ErrorDetails | undefined = Object.keys(picked).length > 0 ? picked : undefined;
  // Le message du moteur peut citer une clé réelle (préfixe de l'espace) : jamais renvoyé tel quel.
  return new ApiError(candidate.code, 'Storage request failed', details, s3);
}

export function errorBody(err: ApiError): Record<string, unknown> {
  return {
    error: err.code,
    message: err.message,
    ...(err.details ? { details: err.details } : {}),
    ...(err.s3 ? { s3: err.s3 } : {}),
  };
}

export function sendError(c: Context, err: ApiError): Response {
  c.header('Cache-Control', 'no-store');
  return c.json(errorBody(err), err.status as ContentfulStatusCode);
}

/** Gestionnaire global : une erreur inconnue devient `internal`, sans fuite de message ni de pile. */
export function handleError(err: unknown, c: Context): Response {
  const known = fromEngineError(err);
  if (known) return sendError(c, known);
  console.error('unhandled error', { name: err instanceof Error ? err.name : typeof err, route: c.req.routePath });
  return sendError(c, new ApiError('internal', 'Internal error'));
}

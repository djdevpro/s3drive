/*
 * Lecture des erreurs de l'API (`DriveApiError { code, status, details, reason }` du client) sans
 * dépendre de sa classe : un objet qui porte `code` suffit. Une erreur réseau (fetch rejeté)
 * n'a pas de code : elle est lue comme `network`.
 */

export interface ApiErrorLike {
  code: string;
  status?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export function apiError(error: unknown): ApiErrorLike | null {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string') {
    const e = error as { code: string; status?: unknown; reason?: unknown; details?: unknown };
    const details = e.details && typeof e.details === 'object' ? (e.details as Record<string, unknown>) : undefined;
    const reason = typeof e.reason === 'string' ? e.reason : typeof details?.['reason'] === 'string' ? (details['reason'] as string) : undefined;
    return {
      code: e.code,
      ...(typeof e.status === 'number' ? { status: e.status } : {}),
      ...(reason ? { reason } : {}),
      ...(details ? { details } : {}),
    };
  }
  return null;
}

/** Code d'erreur, `network` pour un échec de transport, `unknown` sinon. */
export function errorCode(error: unknown): string {
  const api = apiError(error);
  // Erreur réseau du client (`local.network`) ou fetch rejeté.
  if (api) return api.code === 'local.network' ? 'network' : api.code;
  if (error instanceof TypeError) return 'network';
  return 'unknown';
}

/** Codes traduits par l'espace `explorer` (`errors.<code>`) ; les autres passent par `errors.unknown`. */
export const KNOWN_ERROR_CODES = new Set([
  'network',
  'unauthorized',
  'forbidden',
  'scope_denied',
  'access_denied',
  'bucket_not_found',
  'key_not_found',
  'already_exists',
  'validation',
  'quota_exceeded',
  'rate_limited',
  'slow_down',
  'upstream_error',
  'endpoint_unreachable',
  'not_implemented',
  'internal',
]);

/** Clé de traduction d'une erreur d'action, motif `batch_too_large` compris. */
export function errorMessageKey(error: unknown): string {
  const api = apiError(error);
  if (api?.reason === 'batch_too_large') return 'errors.batch_too_large';
  if (api?.code === 'already_exists' && api.reason === 'folder_exists') return 'errors.folder_exists';
  const code = errorCode(error);
  return KNOWN_ERROR_CODES.has(code) ? `errors.${code}` : 'errors.unknown';
}

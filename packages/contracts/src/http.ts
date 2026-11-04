/** Préfixe unique de l'API. */
export const API_PREFIX = '/api/v1';
export const API_VERSION = '1';

/** Noms d'en-têtes de l'API. */
export const HEADERS = {
  /** Anti-CSRF, obligatoire sur les méthodes non sûres authentifiées par cookie. */
  csrf: 'X-UD',
  /** Confirmation des actions dangereuses (nom du bucket, ou `all`). */
  confirm: 'X-UD-Confirm',
  idempotencyKey: 'Idempotency-Key',
  idempotentReplayed: 'Idempotent-Replayed',
  authorization: 'Authorization',
  wwwAuthenticate: 'WWW-Authenticate',
  lastEventId: 'Last-Event-ID',
  requestId: 'X-Request-Id',
  retryAfter: 'Retry-After',
  rateLimit: 'RateLimit',
  rateLimitPolicy: 'RateLimit-Policy',
  ifMatch: 'If-Match',
  ifNoneMatch: 'If-None-Match',
  link: 'Link',
} as const;

export const CSRF_HEADER_VALUE = '1';
/** Valeur de `X-UD-Confirm` pour une action globale. */
export const CONFIRM_ALL = 'all';

/** Méthodes dispensées de l'en-tête `X-UD`. */
export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

export function requiresCsrfHeader(method: string): boolean {
  return !(SAFE_METHODS as readonly string[]).includes(method.toUpperCase());
}

/** Cookies. Les noms « dev » servent en HTTP de développement. */
export const COOKIES = {
  session: '__Host-ud_sid',
  sessionDev: 'ud_sid',
  shareVisitor: '__Secure-ud_sv',
  shareVisitorDev: 'ud_sv',
} as const;

export function sessionCookieName(secure: boolean): string {
  return secure ? COOKIES.session : COOKIES.sessionDev;
}

export function shareVisitorCookieName(secure: boolean): string {
  return secure ? COOKIES.shareVisitor : COOKIES.shareVisitorDev;
}

/** Paramètre de requête de l'essai à blanc (`PUT …/config/:aspect?dryRun=1`). */
export const DRY_RUN_PARAM = 'dryRun';

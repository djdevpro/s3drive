// Limites communes chiffrées par 01 (sans variable d'environnement) et 09.
// Durées en secondes (suffixe _S) ou millisecondes (suffixe _MS), tailles en octets.

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
const KIB = 1024;

// Sessions (01).
export const SESSION_SLIDING_TTL_S = 30 * DAY_S;
export const SESSION_ABSOLUTE_TTL_S = 400 * DAY_S;
export const SESSION_SHARED_COMPUTER_TTL_S = 12 * HOUR_S;
/** Prolongation glissante au plus une fois par intervalle. */
export const SESSION_EXTEND_MIN_INTERVAL_S = 10 * MINUTE_S;
export const SESSION_ROTATION_GRACE_S = 60;
export const MAX_CONNECTIONS_PER_SESSION = 10;
export const MAX_REMEMBERED_STORAGES = 20;
export const CREDENTIAL_EXPIRY_WARNING_S = 10 * MINUTE_S;
/** Résultat d'une vérification de refus d'identifiants gardé en cache. */
export const CREDENTIAL_RECHECK_CACHE_S = 30;

// Connexion au fournisseur (01).
export const CONNECT_BUDGET_MS = 20_000;
export const CONNECT_TCP_TLS_TIMEOUT_MS = 5_000;
export const CONNECT_S3_REQUEST_TIMEOUT_MS = 10_000;
export const PROBE_TIMEOUT_MS = 5_000;

// Jetons, délégation, appareils (01).
export const MAX_ACTIVE_TOKENS_PER_CONNECTION = 50;
export const ORPHAN_DELEGATION_TTL_S = 10 * MINUTE_S;
export const DEVICE_CODE_TTL_S = 10 * MINUTE_S;

// Tailles (01).
export const AUDIT_DETAILS_MAX_BYTES = 8 * KIB;
/** `details` des actions `permission.*`. */
export const AUDIT_PERMISSION_DETAILS_MAX_BYTES = 64 * KIB;
export const SETTINGS_MAX_BYTES = 64 * KIB;

// Pagination.
export const S3_LIST_DEFAULT_LIMIT = 1_000;
export const S3_LIST_MAX_LIMIT = 1_000;
export const APP_LIST_DEFAULT_LIMIT = 50;
export const APP_LIST_MAX_LIMIT = 500;
export const CURSOR_TTL_S = HOUR_S;

// Idempotence.
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const IDEMPOTENCY_TTL_S = DAY_S;

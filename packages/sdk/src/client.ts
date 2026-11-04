import {
  API_PREFIX,
  CSRF_HEADER_VALUE,
  HEADERS,
  type AdminUser,
  type AdminUserList,
  type AdminUserPatch,
  type DeleteObjectResponse,
  type DownloadResponse,
  type ErrorCode,
  type InstanceConnectionSummary,
  type InstanceInfo,
  type LogoutResponse,
  type MeResponse,
  type ObjectDetails,
  type ObjectListPage,
  type ObjectOperationResult,
  type RenameRequest,
  type SpaceBucket,
  type TermsResponse,
  type TransferRequest,
  adminUserListSchema,
  adminUserSchema,
  apiErrorSchema,
  deleteObjectResponseSchema,
  downloadResponseSchema,
  instanceConnectionSummarySchema,
  instanceInfoSchema,
  logoutResponseSchema,
  meResponseSchema,
  objectDetailsSchema,
  objectListPageSchema,
  objectOperationResultSchema,
  requiresCsrfHeader,
  spaceBucketListSchema,
  termsResponseSchema,
} from '@ud/contracts';

// Client typé de /api/v1 pour le mode instance (12) : cookie de session et `X-UD: 1`
// (01), clés en `?key=`, réponses validées par les schémas de `@ud/contracts`,
// redirections non suivies pour détecter une passerelle expirée.

/** Codes d'erreur de l'API et erreurs locales du client. */
export type DriveErrorCode = ErrorCode | 'local.gate_expired' | 'local.network' | 'local.invalid_response';

export class DriveApiError extends Error {
  readonly code: DriveErrorCode;
  /** Statut HTTP ; 0 pour une erreur réseau ou une redirection opaque. */
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(init: { code: DriveErrorCode; status: number; message?: string; details?: Record<string, unknown> }) {
    super(init.message ?? init.code);
    this.name = 'DriveApiError';
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? {};
  }

  /** Motif précis (`details.reason`, ex. `session_ended`, `terms_required`). */
  get reason(): string | undefined {
    const reason = this.details['reason'];
    return typeof reason === 'string' ? reason : undefined;
  }
}

export interface DriveClientOptions {
  /** Origine de l'API ; défaut `''` (même origine). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Passerelle d'authentification expirée : redirection opaque ou 401 sans enveloppe. */
  onGateExpired?: () => void;
  /** Réponse 401 de l'API, avec son motif (`session_ended`, `idp_unreachable`, `suspended`…). */
  onUnauthorized?: (reason: string | undefined) => void;
}

export interface DriveClient {
  instance(): Promise<InstanceInfo>;
  me(): Promise<MeResponse>;
  terms(): Promise<TermsResponse>;
  acceptTerms(version: string): Promise<void>;
  logout(): Promise<LogoutResponse>;
  /** Adresse de `GET /api/v1/auth/oidc/login`, à ouvrir par une navigation réseau. */
  loginHref(next?: string): string;
  connection(conn: string): Promise<InstanceConnectionSummary>;
  buckets(conn: string): Promise<SpaceBucket[]>;
  list(conn: string, bucket: string, input: { prefix: string; cursor?: string | null; limit?: number }): Promise<ObjectListPage>;
  object(conn: string, bucket: string, key: string): Promise<ObjectDetails>;
  /** Marqueur de dossier : clé terminée par `/`. */
  createFolder(conn: string, bucket: string, key: string): Promise<void>;
  rename(conn: string, bucket: string, key: string, body: RenameRequest): Promise<ObjectOperationResult>;
  move(conn: string, bucket: string, key: string, body: TransferRequest): Promise<ObjectOperationResult>;
  copy(conn: string, bucket: string, key: string, body: TransferRequest): Promise<ObjectOperationResult>;
  remove(conn: string, bucket: string, key: string): Promise<DeleteObjectResponse>;
  downloadUrl(conn: string, bucket: string, key: string, input?: { disposition?: 'inline' | 'attachment' }): Promise<DownloadResponse>;
  admin: {
    users(input?: { q?: string; cursor?: string | null; limit?: number; sort?: string; dir?: 'asc' | 'desc' }): Promise<AdminUserList>;
    user(id: string): Promise<AdminUser>;
    updateUser(id: string, patch: AdminUserPatch): Promise<AdminUser>;
    recount(id: string): Promise<AdminUser>;
  };
}

/** Schéma zod réduit à ce qui sert ici (le SDK ne dépend que de `@ud/contracts`). */
type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

type Query = Record<string, string | number | null | undefined>;

function queryString(query: Query): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(name, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

const seg = encodeURIComponent;

export function createDriveClient(options: DriveClientOptions = {}): DriveClient {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  // Lecture tardive de globalThis.fetch : un fetch remplacé après la création reste pris en compte.
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  const url = (path: string, query: Query = {}) => `${base}${API_PREFIX}${path}${queryString(query)}`;
  const conn = (id: string) => `/c/${seg(id)}`;
  const bucketPath = (id: string, bucket: string) => `${conn(id)}/b/${seg(bucket)}`;

  function gateExpired(status: number): DriveApiError {
    options.onGateExpired?.();
    return new DriveApiError({ code: 'local.gate_expired', status, message: 'Access gateway session expired' });
  }

  async function failure(response: Response): Promise<DriveApiError> {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const parsed = apiErrorSchema.safeParse(body);
    if (!parsed.success) {
      // 401 sans enveloppe Universal Drive : la passerelle a répondu à notre place.
      if (response.status === 401) return gateExpired(401);
      return new DriveApiError({ code: 'local.invalid_response', status: response.status, message: `Unexpected error response (${response.status})` });
    }
    const details: Record<string, unknown> = { ...(parsed.data.details ?? {}) };
    if (parsed.data.s3) details['s3'] = parsed.data.s3;
    const error = new DriveApiError({ code: parsed.data.error, status: response.status, message: parsed.data.message, details });
    if (response.status === 401) options.onUnauthorized?.(error.reason);
    return error;
  }

  async function call<T>(method: string, target: string, schema: Schema<T> | null, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (requiresCsrfHeader(method)) headers[HEADERS.csrf] = CSRF_HEADER_VALUE;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await doFetch(target, {
        method,
        headers,
        credentials: 'include',
        redirect: 'manual',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      throw new DriveApiError({ code: 'local.network', status: 0, message: cause instanceof Error ? cause.message : 'Network error' });
    }
    // Navigateur : redirection opaque (type `opaqueredirect`, statut 0) ; Node : la 3xx elle-même.
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      throw gateExpired(response.status);
    }
    if (!response.ok) throw await failure(response);
    if (schema === null) {
      await response.body?.cancel().catch(() => {});
      return undefined as T;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new DriveApiError({ code: 'local.invalid_response', status: response.status, message: 'Response is not JSON' });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new DriveApiError({ code: 'local.invalid_response', status: response.status, message: 'Response does not match its schema', details: { reason: 'schema' } });
    }
    return parsed.data;
  }

  const get = <T>(path: string, schema: Schema<T>, query?: Query) => call('GET', url(path, query), schema);

  return {
    instance: () => get('/instance', instanceInfoSchema),
    me: () => get('/me', meResponseSchema),
    terms: () => get('/me/terms', termsResponseSchema),
    acceptTerms: (version) => call('POST', url('/me/terms'), null, { version }),
    logout: () => call('POST', url('/auth/logout'), logoutResponseSchema),
    loginHref: (next) => url('/auth/oidc/login', { next }),

    connection: (id) => get(conn(id), instanceConnectionSummarySchema),
    buckets: async (id) => (await get(`${conn(id)}/buckets`, spaceBucketListSchema)).items,
    list: (id, bucket, input) =>
      get(`${bucketPath(id, bucket)}/objects`, objectListPageSchema, { prefix: input.prefix, cursor: input.cursor, limit: input.limit }),
    object: (id, bucket, key) => get(`${bucketPath(id, bucket)}/object`, objectDetailsSchema, { key }),
    createFolder: async (id, bucket, key) => {
      if (!key.endsWith('/')) throw new DriveApiError({ code: 'validation', status: 0, message: 'A folder key ends with /', details: { reason: 'folder_key' } });
      await call('PUT', url(`${bucketPath(id, bucket)}/object`, { key }), null);
    },
    rename: (id, bucket, key, body) => call('POST', url(`${bucketPath(id, bucket)}/object/rename`, { key }), objectOperationResultSchema, body),
    move: (id, bucket, key, body) => call('POST', url(`${bucketPath(id, bucket)}/object/move`, { key }), objectOperationResultSchema, body),
    copy: (id, bucket, key, body) => call('POST', url(`${bucketPath(id, bucket)}/object/copy`, { key }), objectOperationResultSchema, body),
    remove: (id, bucket, key) => call('DELETE', url(`${bucketPath(id, bucket)}/object`, { key }), deleteObjectResponseSchema),
    downloadUrl: (id, bucket, key, input = {}) =>
      get(`${bucketPath(id, bucket)}/download`, downloadResponseSchema, { key, disposition: input.disposition }),

    admin: {
      users: (input = {}) =>
        get('/admin/users', adminUserListSchema, { q: input.q, cursor: input.cursor, limit: input.limit, sort: input.sort, dir: input.dir }),
      user: (id) => get(`/admin/users/${seg(id)}`, adminUserSchema),
      updateUser: (id, patch) => call('PATCH', url(`/admin/users/${seg(id)}`), adminUserSchema, patch),
      recount: (id) => call('POST', url(`/admin/users/${seg(id)}/recount`), adminUserSchema),
    },
  };
}

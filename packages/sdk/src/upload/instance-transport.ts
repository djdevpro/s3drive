import {
  API_PREFIX,
  CSRF_HEADER_VALUE,
  HEADERS,
  type CreateUploadRequest,
  type DownloadResponse,
  confirmUploadsResponseSchema,
  createUploadResponseSchema,
  downloadResponseSchema,
  presignPartsResponseSchema,
  uploadPartsPageSchema,
  uploadResultSchema,
} from '@ud/contracts';
import { LOCAL_ERRORS, UploadError, errorFromResponse, networkError } from './errors.js';
import type { ConfirmItem, ConfirmResult, CreateUploadInput, UploadRef, UploadTransport } from './types.js';

// Transport du mode instance (12) : routes de `apps/server/src/instance/routes/uploads.ts`,
// cookie de session et `X-UD: 1` (01), réponses validées par les schémas de `@ud/contracts`.

export interface InstanceTransportOptions {
  /** Id de la connexion de l'instance (`drive`). */
  connection: string;
  /** Origine de l'API ; défaut `''` (même origine, navigateur). Sous Node : `http://127.0.0.1:3000`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** En-têtes ajoutés à chaque appel (ex. `Cookie` sous Node). Jamais journalisés. */
  headers?: Record<string, string>;
  /** Défaut `same-origin`. */
  credentials?: RequestCredentials;
}

/** Schéma zod réduit à ce qui sert ici (le SDK ne dépend que de `@ud/contracts`). */
type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

export class InstanceUploadTransport implements UploadTransport {
  readonly #connection: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #headers: Record<string, string>;
  readonly #credentials: RequestCredentials;

  constructor(options: InstanceTransportOptions) {
    this.#connection = options.connection;
    this.#base = (options.baseUrl ?? '').replace(/\/$/, '');
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#headers = options.headers ?? {};
    this.#credentials = options.credentials ?? 'same-origin';
  }

  /** `…/c/:conn/b/:bucket<path>?key=` ; la clé passe toujours en paramètre de requête. */
  #url(bucket: string, path: string, query: Record<string, string | undefined> = {}): string {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (value !== undefined) params.set(name, value);
    const qs = params.toString();
    return `${this.#base}${API_PREFIX}/c/${encodeURIComponent(this.#connection)}/b/${encodeURIComponent(bucket)}${path}${qs ? `?${qs}` : ''}`;
  }

  async #call<T>(method: string, url: string, schema: Schema<T> | null, body?: unknown, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { ...this.#headers, ...extra, Accept: 'application/json' };
    if (method !== 'GET') headers[HEADERS.csrf] = CSRF_HEADER_VALUE;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers,
        credentials: this.#credentials,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw networkError(error);
    }
    if (!response.ok) throw await errorFromResponse(response);
    if (schema === null) {
      await response.body?.cancel().catch(() => {});
      return undefined as T;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new UploadError({ code: LOCAL_ERRORS.invalidResponse, status: response.status, retryable: false });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new UploadError({ code: LOCAL_ERRORS.invalidResponse, reason: 'schema', status: response.status, retryable: false });
    return parsed.data;
  }

  create(input: CreateUploadInput) {
    const body: CreateUploadRequest = {
      size: input.size,
      mode: input.mode,
      purpose: input.purpose,
      conflict: input.conflict,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.lastModified !== undefined ? { lastModified: Math.max(0, Math.round(input.lastModified)) } : {}),
    };
    return this.#call('POST', this.#url(input.bucket, '/uploads', { key: input.key }), createUploadResponseSchema, body, { [HEADERS.idempotencyKey]: input.idempotencyKey }, input.signal);
  }

  async signParts(input: UploadRef & { parts: Array<{ partNumber: number; size: number }> }) {
    const out = [];
    // 100 parties au plus par appel (presignPartsRequestSchema).
    for (let i = 0; i < input.parts.length; i += 100) {
      const page = await this.#call(
        'POST',
        this.#url(input.bucket, `/uploads/${encodeURIComponent(input.uploadId)}/parts`, { key: input.key }),
        presignPartsResponseSchema,
        { parts: input.parts.slice(i, i + 100) },
        {},
        input.signal,
      );
      out.push(...page.parts);
    }
    return out;
  }

  async listParts(input: UploadRef) {
    const page = await this.#call('GET', this.#url(input.bucket, `/uploads/${encodeURIComponent(input.uploadId)}/parts`, { key: input.key }), uploadPartsPageSchema, undefined, {}, input.signal);
    return page.items;
  }

  complete(input: UploadRef & { size: number; parts: Array<{ partNumber: number; etag?: string }> }) {
    return this.#call(
      'POST',
      this.#url(input.bucket, `/uploads/${encodeURIComponent(input.uploadId)}/complete`, { key: input.key }),
      uploadResultSchema,
      { size: input.size, parts: input.parts },
      {},
      input.signal,
    );
  }

  async abort(input: UploadRef): Promise<void> {
    await this.#call('DELETE', this.#url(input.bucket, `/uploads/${encodeURIComponent(input.uploadId)}`, { key: input.key }), null, undefined, {}, input.signal);
  }

  async confirm(bucket: string, items: ConfirmItem[], signal?: AbortSignal): Promise<ConfirmResult[]> {
    const response = await this.#call('POST', this.#url(bucket, '/uploads/confirm'), confirmUploadsResponseSchema, { items }, {}, signal);
    return response.results.map((r) => {
      const result: ConfirmResult = { key: r.key, ok: r.ok };
      if (r.error) {
        const reason = typeof r.error.details?.['reason'] === 'string' ? (r.error.details['reason'] as string) : undefined;
        result.error = { code: r.error.error, retryable: false, ...(reason ? { reason } : {}) };
      }
      return result;
    });
  }

  /** Marqueur d'un dossier vide ; un dossier déjà présent vaut succès. */
  async createFolder(bucket: string, prefix: string, signal?: AbortSignal): Promise<void> {
    const key = prefix.endsWith('/') ? prefix : `${prefix}/`;
    try {
      await this.#call('PUT', this.#url(bucket, '/object', { key }), null, undefined, {}, signal);
    } catch (error) {
      if (error instanceof UploadError && error.code === 'already_exists') return;
      throw error;
    }
  }

  /** URL de téléchargement présignée, valable 1 h ; à ouvrir par navigation. */
  download(bucket: string, key: string, options: { filename?: string; disposition?: 'inline' | 'attachment'; versionId?: string; signal?: AbortSignal } = {}): Promise<DownloadResponse> {
    return this.#call(
      'GET',
      this.#url(bucket, '/download', { key, disposition: options.disposition ?? 'attachment', filename: options.filename, versionId: options.versionId }),
      downloadResponseSchema,
      undefined,
      {},
      options.signal,
    );
  }

  /** URL qui redirige vers le fichier (`?redirect=1`), sans appel préalable. */
  downloadHref(bucket: string, key: string, options: { filename?: string; disposition?: 'inline' | 'attachment' } = {}): string {
    return this.#url(bucket, '/download', { key, disposition: options.disposition ?? 'attachment', filename: options.filename, redirect: '1' });
  }
}

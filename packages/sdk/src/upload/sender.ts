import { networkError, parseRetryAfter } from './errors.js';
import type { DataRequest, DataResponse, DataSender } from './types.js';

// Envoi des octets vers l'URL présignée : XHR dans le navigateur (progression
// `upload.onprogress`), `fetch` ailleurs (Node 24). Les en-têtes signés partent tels quels.

/**
 * En-têtes que le navigateur pose lui-même et refuse de laisser fixer (`content-length`, `host`) :
 * la longueur signée est celle du `Blob` envoyé, donc identique.
 */
const BROWSER_MANAGED = new Set(['content-length', 'host', 'connection']);

function s3CodeOf(text: string): string | undefined {
  const match = /<Code>([^<]+)<\/Code>/.exec(text);
  return match?.[1];
}

/** Envoi par `XMLHttpRequest` (navigateur). */
export const xhrSender: DataSender = (request: DataRequest) =>
  new Promise<DataResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', request.url, true);
    for (const [name, value] of Object.entries(request.headers)) {
      if (!BROWSER_MANAGED.has(name.toLowerCase())) xhr.setRequestHeader(name, value);
    }
    const onAbort = () => xhr.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    const done = () => request.signal.removeEventListener('abort', onAbort);
    if (request.onProgress) {
      const report = request.onProgress;
      xhr.upload.onprogress = (event) => report(event.loaded);
    }
    xhr.onload = () => {
      done();
      const text = typeof xhr.responseText === 'string' ? xhr.responseText : '';
      const response: DataResponse = { status: xhr.status, etag: xhr.getResponseHeader('ETag') };
      const code = xhr.status >= 300 ? s3CodeOf(text) : undefined;
      if (code) response.s3Code = code;
      const retryAfterMs = parseRetryAfter(xhr.getResponseHeader('Retry-After'));
      if (retryAfterMs !== undefined) response.retryAfterMs = retryAfterMs;
      resolve(response);
    };
    xhr.onerror = () => {
      done();
      reject(networkError());
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      done();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    xhr.send(request.body);
  });

/** Envoi par `fetch` (Node 24, workers) ; progression connue à la fin seulement. */
export const fetchSender: DataSender = async (request: DataRequest) => {
  let response: Response;
  try {
    response = await fetch(request.url, { method: 'PUT', headers: request.headers, body: request.body, signal: request.signal });
  } catch (error) {
    if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    throw networkError(error);
  }
  const result: DataResponse = { status: response.status, etag: response.headers.get('etag') };
  if (response.status >= 300) {
    const code = s3CodeOf(await response.text().catch(() => ''));
    if (code) result.s3Code = code;
  } else {
    await response.body?.cancel().catch(() => {});
  }
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
  request.onProgress?.(request.body.size);
  return result;
};

/** XHR s'il existe, sinon `fetch`. */
export function defaultSender(): DataSender {
  return typeof XMLHttpRequest === 'function' ? xhrSender : fetchSender;
}

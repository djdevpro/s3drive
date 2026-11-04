import type { Context } from 'hono';
import type { z } from 'zod';
import { apiError } from '../../errors.js';

// Lecture et validation des entrées ; jamais de valeur dans les messages d'erreur.

/** Corps JSON maximal de ces routes (32 Kio ; plus pour les listes de parties). */
export const MAX_JSON_BYTES = 256 * 1024;

function issues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

export async function parseJson<T extends z.ZodType>(c: Context, schema: T, maxBytes = MAX_JSON_BYTES): Promise<z.infer<T>> {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > maxBytes) throw apiError('entity_too_large', 'Request body too large');
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    throw apiError('validation', 'Unreadable body', { reason: 'invalid_json' });
  }
  if (Buffer.byteLength(text) > maxBytes) throw apiError('entity_too_large', 'Request body too large');
  let value: unknown;
  try {
    value = text === '' ? {} : JSON.parse(text);
  } catch {
    throw apiError('validation', 'Invalid JSON', { reason: 'invalid_json' });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw apiError('validation', 'Invalid request', { reason: 'invalid_body', issues: issues(parsed.error) });
  return parsed.data;
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw apiError('validation', 'Invalid query', { reason: 'invalid_query', issues: issues(parsed.error) });
  return parsed.data;
}

/** Paramètre `?key=` obligatoire. */
export function requireKeyParam(c: Context): string {
  const key = c.req.query('key');
  if (key === undefined) throw apiError('validation', 'Missing key', { reason: 'key_required' });
  return key;
}

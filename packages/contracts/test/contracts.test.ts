import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BUCKET_CAPABILITY_KEYS,
  BUCKET_CONFIG_CAPABILITY_KEYS,
  CAPABILITY_KEY_BY_ASPECT,
  EVENT_TYPES,
  capSchema,
  configCapSchema,
  entryDiscriminantSchema,
  pageSchema,
  paginationQuerySchema,
  parseServerEvent,
  requiresCsrfHeader,
  sessionCookieName,
} from '../src/index.js';

describe('capabilities', () => {
  it('has unique keys and maps aspects to known keys', () => {
    expect(new Set(BUCKET_CAPABILITY_KEYS).size).toBe(BUCKET_CAPABILITY_KEYS.length);
    for (const key of Object.values(CAPABILITY_KEY_BY_ASPECT)) expect(BUCKET_CAPABILITY_KEYS).toContain(key);
    expect(BUCKET_CONFIG_CAPABILITY_KEYS).toContain('cors');
  });
  it('validates caps', () => {
    expect(capSchema.safeParse({ state: 'supported', configured: false }).success).toBe(true);
    expect(configCapSchema.safeParse({ state: 'denied', writeState: 'unknown' }).success).toBe(true);
    expect(capSchema.safeParse({ state: 'configured' }).success).toBe(false);
  });
});

describe('events', () => {
  it('lists the closed set', () => expect(EVENT_TYPES).toHaveLength(9));
  it('parses objects.changed and rejects bad payloads', () => {
    const event = parseServerEvent('7', 'objects.changed', { bucket: 'b', prefixes: ['a/'], origin: 'web' });
    expect(event).toEqual({ id: '7', type: 'objects.changed', data: { bucket: 'b', prefixes: ['a/'], origin: 'web' } });
    expect(parseServerEvent('8', 'objects.changed', { bucket: 'b', prefixes: [], origin: 'ftp' })).toBeNull();
    expect(parseServerEvent('9', 'objects.deleted', {})).toBeNull();
    expect(parseServerEvent('10', 'connection.status', { connectionId: 'c', stream: { replay: 'gap' } })).not.toBeNull();
  });
});

describe('pagination', () => {
  it('validates pages', () => {
    const schema = pageSchema(entryDiscriminantSchema);
    expect(schema.safeParse({ items: [{ kind: 'folder', key: 'a/' }], nextCursor: null }).success).toBe(true);
    expect(schema.safeParse({ items: [{ kind: 'link' }], nextCursor: null }).success).toBe(false);
    expect(pageSchema(z.number()).safeParse({ items: [], nextCursor: '' }).success).toBe(false);
  });
  it('coerces query params with defaults and bounds', () => {
    const app = paginationQuerySchema();
    expect(app.parse({})).toEqual({ limit: 50 });
    expect(app.parse({ cursor: '', limit: '' })).toEqual({ limit: 50 });
    expect(app.parse({ cursor: 'abc', limit: '20' })).toEqual({ cursor: 'abc', limit: 20 });
    expect(app.safeParse({ limit: '501' }).success).toBe(false);
    expect(app.safeParse({ limit: '0' }).success).toBe(false);
    expect(paginationQuerySchema({ defaultLimit: 1000, maxLimit: 1000 }).parse({})).toEqual({ limit: 1000 });
  });
});

describe('http', () => {
  it('requires X-UD on unsafe methods only', () => {
    expect(requiresCsrfHeader('get')).toBe(false);
    expect(requiresCsrfHeader('POST')).toBe(true);
    expect(requiresCsrfHeader('DELETE')).toBe(true);
  });
  it('names the session cookie by transport', () => {
    expect(sessionCookieName(true)).toBe('__Host-ud_sid');
    expect(sessionCookieName(false)).toBe('ud_sid');
  });
});

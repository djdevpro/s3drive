import { describe, expect, it } from 'vitest';
import {
  connectionRefSchema,
  isConnectionId,
  isSessionId,
  looksLikeAccessToken,
  parseAccessToken,
  parseSessionCookie,
  principalSchema,
  readBearerToken,
} from '../src/auth.js';

const ID16 = 'Ab3dEf6hIj9lMn0p';
const SECRET = 'q'.repeat(42) + 'A';
const SESSION_ID = '0123456789abcdef0123456789abcdef';

describe('connection id', () => {
  it.each(['a1B2c3D4e5', '0000000000', 'ZZZZZZZZZZ'])('accepts %s', (id) => expect(isConnectionId(id)).toBe(true));
  it.each(['a1B2c3D4e', 'a1B2c3D4e5f', 'a1B2c3D4e_', 'a1B2c3D4é5', ''])('rejects %s', (id) =>
    expect(isConnectionId(id)).toBe(false),
  );
  it('accepts me as a connection ref', () => {
    expect(connectionRefSchema.safeParse('me').success).toBe(true);
    expect(connectionRefSchema.safeParse('a1B2c3D4e5').success).toBe(true);
    expect(connectionRefSchema.safeParse('you').success).toBe(false);
  });
});

describe('access token', () => {
  it('parses a valid token', () => {
    expect(parseAccessToken(`ud_at_${ID16}.${SECRET}`)).toEqual({ id: ID16, secret: SECRET });
    expect(parseAccessToken(`ud_at_${ID16}.${'-_'.repeat(21)}x`)).not.toBeNull();
  });

  it.each([
    ['wrong prefix', `ud_xx_${ID16}.${SECRET}`],
    ['short id', `ud_at_${ID16.slice(1)}.${SECRET}`],
    ['id with symbol', `ud_at_${ID16.slice(1)}-.${SECRET}`],
    ['short secret', `ud_at_${ID16}.${SECRET.slice(1)}`],
    ['long secret', `ud_at_${ID16}.${SECRET}A`],
    ['padding', `ud_at_${ID16}.${SECRET.slice(1)}=`],
    ['no dot', `ud_at_${ID16}${SECRET}`],
    ['trailing space', `ud_at_${ID16}.${SECRET} `],
  ])('rejects %s', (_label, value) => expect(parseAccessToken(value)).toBeNull());

  it('detects token-like values by prefix', () => {
    expect(looksLikeAccessToken('ud_at_anything')).toBe(true);
    expect(looksLikeAccessToken('Bearer ud_at_x')).toBe(false);
  });

  it('reads bearer credentials', () => {
    expect(readBearerToken(`Bearer ud_at_${ID16}.${SECRET}`)).toBe(`ud_at_${ID16}.${SECRET}`);
    expect(readBearerToken('bearer abc')).toBe('abc');
    expect(readBearerToken('Basic abc')).toBeNull();
    expect(readBearerToken('Bearer a b')).toBeNull();
    expect(readBearerToken('Bearer')).toBeNull();
    expect(readBearerToken(undefined)).toBeNull();
  });
});

describe('session cookie', () => {
  it('parses <sessionId>.<secret>', () => {
    expect(parseSessionCookie(`${SESSION_ID}.${SECRET}`)).toEqual({ sessionId: SESSION_ID, secret: SECRET });
    expect(isSessionId(SESSION_ID)).toBe(true);
  });
  it.each([
    `${SESSION_ID.toUpperCase()}.${SECRET}`,
    `${SESSION_ID.slice(1)}.${SECRET}`,
    `${SESSION_ID}.${SECRET}.x`,
    SESSION_ID,
    '',
  ])('rejects %s', (value) => expect(parseSessionCookie(value)).toBeNull());
});

describe('principal', () => {
  it('accepts the three kinds', () => {
    expect(principalSchema.parse({ kind: 'session', sessionId: SESSION_ID, connectionId: 'a1B2c3D4e5' }).kind).toBe(
      'session',
    );
    expect(
      principalSchema.safeParse({
        kind: 'token',
        tokenId: ID16,
        connectionId: 'a1B2c3D4e5',
        scopes: ['read', 'share'],
        restrictions: { buckets: null, prefix: 'docs/' },
      }).success,
    ).toBe(true);
    expect(
      principalSchema.safeParse({
        kind: 'share',
        shareId: 's1',
        connectionId: 'a1B2c3D4e5',
        role: 'viewer',
        root: { bucket: 'b', prefix: '' },
      }).success,
    ).toBe(true);
  });
  it('rejects unknown scopes', () => {
    expect(
      principalSchema.safeParse({
        kind: 'token',
        tokenId: ID16,
        connectionId: 'a1B2c3D4e5',
        scopes: ['root'],
        restrictions: { buckets: null, prefix: null },
      }).success,
    ).toBe(false);
  });
});

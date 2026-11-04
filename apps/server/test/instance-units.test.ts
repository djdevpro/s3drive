import { relativeKeyProblem, utf8Length } from '@ud/contracts';
import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../src/db.js';
import { ApiError } from '../src/errors.js';
import { resolveSpace, toRealKey, toRelativeKey } from '../src/instance/keys.js';
import { checkLinkPolicy } from '../src/instance/links.js';
import { UsageStore } from '../src/instance/usage.js';
import { computeGrants } from '../src/instance/grants.js';
import { parseInstanceConfig } from '../src/instance/config.js';
import { BASE_YAML } from './fixtures.js';

const home = resolveSpace({ id: 'home', storage: 'main', bucket: 'b', prefix: 'users/{userId}/', name: null, quota: null }, 'U123456789');

function reason(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('validation');
    return (err as ApiError).details?.reason;
  }
  throw new Error('expected a validation error');
}

describe('keys confined to their space', () => {
  it('prefixes and strips the real root', () => {
    expect(home.root).toBe('users/U123456789/');
    expect(toRealKey(home, 'Documents/a.pdf')).toBe('users/U123456789/Documents/a.pdf');
    expect(toRealKey(home, '', { allowEmpty: true })).toBe('users/U123456789/');
    expect(toRelativeKey(home, 'users/U123456789/x/y')).toBe('x/y');
    expect(toRelativeKey(home, 'users/OTHER/x')).toBeNull();
  });

  it.each([
    ['../x', 'key_dot_segment'],
    ['/x', 'key_leading_slash'],
    ['a/./b', 'key_dot_segment'],
    ['a//b', 'key_double_slash'],
    ['a/..', 'key_dot_segment'],
    ['.', 'key_dot_segment'],
    ['a\u0000b', 'key_control_char'],
    ['a\nb', 'key_control_char'],
    ['', 'key_empty'],
    ['.universal-drive/trash/x', 'reserved_prefix'],
  ])('refuses %j', (key, expected) => {
    expect(reason(() => toRealKey(home, key))).toBe(expected);
  });

  it('counts the 1024 bytes after prefixing, in UTF-8', () => {
    const room = 1024 - utf8Length(home.root);
    expect(toRealKey(home, 'a'.repeat(room))).toHaveLength(1024);
    expect(reason(() => toRealKey(home, 'a'.repeat(room + 1)))).toBe('key_too_long');
    expect(utf8Length('é😀')).toBe(6);
    expect(relativeKeyProblem('dossier/é')).toBeNull();
  });
});

describe('quotas with reservation', () => {
  function store() {
    const db = openDatabase(':memory:');
    migrate(db);
    return new UsageStore(db, () => 1_000);
  }

  it('refuses before any byte when bytes + reserved + size > quota, with the remaining space', () => {
    const usage = store();
    usage.add('home', 'u1', 600, 2);
    const r = usage.reserve({ spaceId: 'home', ownerId: 'u1', userId: 'u1', key: 'a', size: 300, replacedSize: null, limit: 1000, limitKind: 'user_quota', ttlMs: 1000 });
    expect(usage.get('home', 'u1')).toEqual({ bytes: 600, objects: 2, reserved: 300 });
    try {
      usage.reserve({ spaceId: 'home', ownerId: 'u1', userId: 'u1', key: 'b', size: 101, replacedSize: null, limit: 1000, limitKind: 'user_quota', ttlMs: 1000 });
      throw new Error('expected quota_exceeded');
    } catch (err) {
      expect((err as ApiError).code).toBe('quota_exceeded');
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).details).toMatchObject({ limit: 'user_quota', remaining: 100 });
    }
    // Succès : la réservation devient de l'usage réel.
    usage.release(r, 300);
    expect(usage.get('home', 'u1')).toEqual({ bytes: 900, objects: 3, reserved: 0 });
    // Libérer deux fois ne compte pas deux fois.
    usage.release(r, 300);
    expect(usage.get('home', 'u1').bytes).toBe(900);
  });

  it('counts only the difference when replacing, and frees an abandoned upload', () => {
    const usage = store();
    usage.add('home', 'u1', 900, 1);
    const r = usage.reserve({ spaceId: 'home', ownerId: 'u1', userId: 'u1', key: 'a', size: 950, replacedSize: 900, limit: 1000, limitKind: 'user_quota', ttlMs: 1000 });
    expect(usage.get('home', 'u1').reserved).toBe(50);
    usage.release(r, 950);
    expect(usage.get('home', 'u1')).toEqual({ bytes: 950, objects: 1, reserved: 0 });
    const abandoned = usage.reserve({ spaceId: 'home', ownerId: 'u1', userId: 'u1', key: 'b', size: 40, replacedSize: null, limit: 1000, limitKind: 'user_quota', ttlMs: 0 });
    expect(usage.expired().map((x) => x.id)).toEqual([abandoned.id]);
    usage.release(abandoned);
    expect(usage.get('home', 'u1')).toEqual({ bytes: 950, objects: 1, reserved: 0 });
  });

  it('unlimited quota never refuses', () => {
    const usage = store();
    expect(() => usage.check('commun', '', 1e15, null, 'space_quota')).not.toThrow();
  });
});

describe('links by role', () => {
  const cfg = parseInstanceConfig(BASE_YAML, {
    env: { UD_OIDC_ISSUER: 'https://i.example.com/r', UD_OIDC_CLIENT_ID: 'drive', UD_OIDC_CLIENT_SECRET: 'x', UD_S3_ACCESS_KEY_ID: 'a', UD_S3_SECRET_ACCESS_KEY: 'b' },
  });
  const now = 1_000_000;
  const day = 86_400_000;

  it('refuses "anyone" links to the user role, with link_policy', () => {
    const user = computeGrants(cfg, ['user']);
    try {
      checkLinkPolicy(user, { audience: 'anyone', expiresAt: now + day }, now);
      throw new Error('expected scope_denied');
    } catch (err) {
      expect((err as ApiError).code).toBe('scope_denied');
      expect((err as ApiError).details?.reason).toBe('link_policy');
    }
    expect(() => checkLinkPolicy(user, { audience: 'people', expiresAt: now + 30 * day }, now)).not.toThrow();
    expect(() => checkLinkPolicy(user, { audience: 'people', expiresAt: now + 31 * day }, now)).toThrow(ApiError);
    expect(() => checkLinkPolicy(user, { audience: 'people', expiresAt: null }, now)).toThrow(ApiError);
  });

  it('super admin may create anything without expiration', () => {
    expect(() => checkLinkPolicy(computeGrants(cfg, ['super_admin']), { audience: 'anyone', expiresAt: null }, now)).not.toThrow();
  });
});

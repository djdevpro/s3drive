import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InstanceConfigError, parseInstanceConfig, parseQuota } from '../src/instance/config.js';
import { BASE_YAML } from './fixtures.js';
import { computeGrants, extractProviderRoles, mapDriveRoles } from '../src/instance/grants.js';

const ENV = {
  UD_OIDC_ISSUER: 'https://iam.example.com/realms/test',
  UD_OIDC_CLIENT_ID: 'drive',
  UD_OIDC_CLIENT_SECRET: 'oidc-secret-value',
  UD_S3_ACCESS_KEY_ID: 'AKIATEST',
  UD_S3_SECRET_ACCESS_KEY: 's3-secret-value',
};


const parse = (yaml: string, env: Record<string, string> = ENV, extra = {}) => parseInstanceConfig(yaml, { env, ...extra });

function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InstanceConfigError);
    return (err as Error).message;
  }
  throw new Error('expected an error');
}

describe('instance configuration', () => {
  it('parses the reference file with interpolation and defaults', () => {
    const cfg = parse(BASE_YAML);
    expect(cfg.connection).toBe('drive');
    expect(cfg.oidc).toMatchObject({ issuer: ENV.UD_OIDC_ISSUER, clientId: 'drive', clientSecret: 'oidc-secret-value', label: 'iam.example.com', audience: 'drive' });
    expect(cfg.oidc!.scopes).toEqual(['openid', 'profile', 'email']);
    expect(cfg.storages.get('main')!.secretAccessKey).toBe('s3-secret-value');
    expect(cfg.spaces.map((s) => s.id)).toEqual(['home', 'commun']);
    expect(cfg.spaces[0]!.name).toBeNull();
    expect(cfg.spaces[1]!.name).toEqual({ fr: 'Commun', en: 'Shared' });
    expect(cfg.spaces[1]!.quota).toBe(50e9);
    expect(cfg.roles.find((r) => r.name === 'user')!.quota).toBe(1e9);
    expect(cfg.roles.find((r) => r.name === 'super_admin')!.quota).toBeNull();
    expect(cfg.legal).toEqual({ termsVersion: '2026-11-03', termsUrl: null, uploadLogDays: 365, abuseEmail: null });
  });

  it('applies ${VAR:-default} and refuses a missing variable without default', () => {
    const cfg = parse(BASE_YAML.replace('name: Drive test', 'name: ${UD_NAME:-Mon Drive}'));
    expect(cfg.name).toBe('Mon Drive');
    const { UD_S3_ACCESS_KEY_ID: _omit, ...env } = ENV;
    expect(errorOf(() => parse(BASE_YAML, env))).toMatch(/storages\.main\.accessKeyId: environment variable UD_S3_ACCESS_KEY_ID is not set/);
  });

  it('refuses a literal secret, citing the path and never the value', () => {
    const msg = errorOf(() => parse(BASE_YAML.replace('secretAccessKey: ${UD_S3_SECRET_ACCESS_KEY}', 'secretAccessKey: verysecretliteral')));
    expect(msg).toContain('storages.main.secretAccessKey');
    expect(msg).not.toContain('verysecretliteral');
    const msg2 = errorOf(() => parse(BASE_YAML.replace('clientSecret: ${UD_OIDC_CLIENT_SECRET}', 'clientSecret: "abc${UD_OIDC_CLIENT_SECRET}"')));
    expect(msg2).toContain('auth.oidc.clientSecret');
    expect(msg2).not.toContain('abc');
    expect(errorOf(() => parse(BASE_YAML.replace('secretAccessKey: ${UD_S3_SECRET_ACCESS_KEY}', 'secretAccessKey: ${UD_S3_SECRET_ACCESS_KEY:-fallback}')))).toContain('secretAccessKey');
  });

  it('never echoes values in schema errors', () => {
    const msg = errorOf(() => parse(BASE_YAML.replace('addressing: path', 'addressing: sideways-xyz')));
    expect(msg).toContain('storages.main.addressing');
    expect(msg).not.toContain('sideways-xyz');
    expect(errorOf(() => parse('version: 1\n  bad: [indent'))).toMatch(/invalid YAML/);
  });

  it.each([
    ['instance.connection = me', BASE_YAML.replace('connection: drive', 'connection: me'), 'instance.connection'],
    ['connection id look-alike', BASE_YAML.replace('connection: drive', 'connection: abcdefghij'), 'instance.connection'],
    ['storage slug = connection', BASE_YAML.replace('  main:\n', '  drive:\n').replaceAll('storage: main', 'storage: drive'), 'storages.drive'],
    ['private endpoint', BASE_YAML.replace('https://s3.example.com', 'http://127.0.0.1:9000'), 'storages.main.endpoint'],
    ['home missing', BASE_YAML.replace('  home:\n    storage: main\n    bucket: drive-test\n    prefix: users/{userId}/\n', ''), 'spaces'],
    ['home without {userId}', BASE_YAML.replace('users/{userId}/', 'users/'), 'spaces.home.prefix'],
    ['{userId} elsewhere', BASE_YAML.replace('prefix: commun/', 'prefix: commun/{userId}/'), 'spaces.commun.prefix'],
    ['prefix without slash', BASE_YAML.replace('prefix: commun/', 'prefix: commun'), 'spaces.commun.prefix'],
    ['prefix with ..', BASE_YAML.replace('prefix: commun/', 'prefix: a/../commun/'), 'spaces.commun.prefix'],
    ['prefix with //', BASE_YAML.replace('prefix: commun/', 'prefix: a//commun/'), 'spaces.commun.prefix'],
    ['overlapping spaces', BASE_YAML.replace('prefix: commun/', 'prefix: users/shared/'), 'spaces.commun.prefix'],
    ['whole-bucket space overlaps', BASE_YAML.replace('prefix: commun/', "prefix: ''"), 'spaces.commun.prefix'],
    ['name on home', BASE_YAML.replace('    prefix: users/{userId}/\n', '    prefix: users/{userId}/\n    name: Moi\n'), 'spaces.home.name'],
    ['bad space id', BASE_YAML.replace('  commun:\n', '  Commun_X:\n'), 'spaces.Commun_X'],
    ['unknown storage', BASE_YAML.replace('    storage: main\n    bucket: drive-test\n    prefix: commun/', '    storage: other\n    bucket: drive-test\n    prefix: commun/'), 'spaces.commun.storage'],
    ['bad role name', BASE_YAML.replace('  user:\n    from: [user]', '  User:\n    from: [user]'), 'roles.User'],
    ['unknown space in role', BASE_YAML.replace('commun: [read] }', 'nope: [read] }'), 'roles.user.spaces.nope'],
    ['bad scope', BASE_YAML.replace('commun: [read] }', 'commun: [admin] }'), 'roles.user.spaces.commun'],
    ['bad quota', BASE_YAML.replace('quota: 1GB', 'quota: 1GiB'), 'roles.user.quota'],
    ['offline_access', BASE_YAML.replace('    roleClaims:', '    scopes: [openid, offline_access]\n    roleClaims:'), 'auth.oidc.scopes'],
    ['no oidc', BASE_YAML.replace(/ {2}oidc:[\s\S]*?realm_access\.roles\]\n/, '  gateway:\n    subjectHeader: X-User\n'), 'auth.oidc'],
  ])('refuses %s', (_label, yaml, path) => {
    expect(errorOf(() => parse(yaml))).toContain(path);
  });

  it('accepts a private endpoint when allowed and checks UD_ALLOWED_ENDPOINTS', () => {
    const yaml = BASE_YAML.replace('https://s3.example.com', 'http://127.0.0.1:9000');
    expect(parse(yaml, ENV, { allowPrivateEndpoints: true }).storages.get('main')!.endpoint).toBe('http://127.0.0.1:9000');
    expect(errorOf(() => parse(BASE_YAML, ENV, { allowedEndpoints: ['*.your-objectstorage.com'] }))).toContain('UD_ALLOWED_ENDPOINTS');
    expect(parse(BASE_YAML, ENV, { allowedEndpoints: ['*.example.com'] }).storages.size).toBe(1);
  });

  it('parses quotas in base 1000', () => {
    expect(parseQuota('1GB')).toBe(1e9);
    expect(parseQuota('512 MB')).toBe(512e6);
    expect(parseQuota('1.5KB')).toBe(1500);
    expect(parseQuota(42)).toBe(42);
    expect(parseQuota('unlimited')).toBeNull();
    expect(() => parseQuota('1 GiB')).toThrow();
  });
});

describe('roles and grants', () => {
  const cfg = parse(BASE_YAML);

  it('reads roles at dotted claim paths, arrays or single strings, across sources', () => {
    const roles = extractProviderRoles(
      [{ resource_access: { drive: { roles: ['user'] } } }, { realm_access: { roles: 'admin' } }, { other: 1 }],
      cfg.oidc!.roleClaims,
    );
    expect(roles.sort()).toEqual(['admin', 'user']);
    expect(mapDriveRoles(cfg, ['user', 'unknown'])).toEqual(['user']);
    expect(mapDriveRoles(cfg, ['nothing'])).toEqual([]);
  });

  it('unions permissions, takes the largest quota and the widest links', () => {
    const g = computeGrants(cfg, ['admin', 'user']);
    expect(g.superAdmin).toBe(false);
    expect(g.spaces).toEqual({ home: ['read', 'write', 'delete', 'share'], commun: ['read', 'write', 'delete', 'share'] });
    expect(g.quota).toBe(10e9);
    expect(g.links).toEqual({ public: true, people: true, maxDays: 90 });
    expect(g.admin).toEqual(['users.read', 'users.manage']);
  });

  it('user only: read-only shared space, 1 GB, no public links', () => {
    const g = computeGrants(cfg, ['user']);
    expect(g.spaces['commun']).toEqual(['read']);
    expect(g.quota).toBe(1e9);
    expect(g.links).toEqual({ public: false, people: true, maxDays: 30 });
    expect(g.admin).toEqual([]);
  });

  it('maxDays 0 (free) and unlimited quota win', () => {
    const yaml = BASE_YAML.replace('maxDays: 30', 'maxDays: 0').replace('quota: 1GB', 'quota: unlimited');
    const g = computeGrants(parse(yaml), ['admin', 'user']);
    expect(g.links.maxDays).toBe(0);
    expect(g.quota).toBeNull();
  });

  it('super_admin gives everything; quota_override replaces the role quota', () => {
    const g = computeGrants(cfg, ['super_admin']);
    expect(g.superAdmin).toBe(true);
    expect(Object.keys(g.spaces)).toEqual(['home', 'commun']);
    expect(g.quota).toBeNull();
    expect(g.admin).toContain('files.inspect');
    expect(computeGrants(cfg, ['user'], 5000).quota).toBe(5000);
  });
});

describe('shipped configuration files', () => {
  const root = new URL('../../../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

  it('drive.config.example.yaml is valid with its variables and contains no secret', () => {
    const cfg = parseInstanceConfig(read('drive.config.example.yaml'), { env: ENV });
    expect(cfg.spaces.map((s) => s.id)).toEqual(['home', 'commun']);
    expect(cfg.roles.map((r) => r.name)).toEqual(['super_admin', 'admin', 'user']);
  });

  it('dev/drive.config.dev.yaml targets the local RustFS in path addressing', () => {
    const cfg = parseInstanceConfig(read('dev/drive.config.dev.yaml'), {
      env: { UD_OIDC_CLIENT_SECRET: 'x', UD_DEV_S3_SECRET_KEY: 'y' },
      allowPrivateEndpoints: true,
    });
    expect(cfg.storages.get('local')).toMatchObject({ endpoint: 'http://127.0.0.1:9000', addressing: 'path' });
    expect(cfg.oidc!.issuer).toBe('http://localhost:8180/realms/ud-dev');
  });
});

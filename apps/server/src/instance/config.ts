import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import {
  ADMIN_PERMISSIONS,
  type AdminPermission,
  CONNECTION_ID_PATTERN,
  CONNECTION_REF_ME,
  HOME_SPACE,
  type LinkPolicy,
  SPACE_SCOPES,
  SUPER_ADMIN_ROLE,
  type SpaceScope,
  USER_ID_PLACEHOLDER,
} from '@ud/contracts';
import { parseDocument } from 'yaml';
import { z } from 'zod';

// Fichier du mode instance : YAML 1.2, interpolation ${VAR} et ${VAR:-défaut}, schéma zod.
// Toute erreur cite le chemin YAML fautif, jamais une valeur.

export class InstanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstanceConfigError';
  }
}

export type Addressing = 'path' | 'virtual';

export interface StorageConfig {
  slug: string;
  endpoint: string;
  region: string;
  addressing: Addressing;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SpaceConfig {
  id: string;
  storage: string;
  bucket: string;
  /** Préfixe réel ; pour `home`, contient `{userId}`. */
  prefix: string;
  /** Libellé par langue ; `null` pour `home`. */
  name: Record<string, string> | null;
  /** Plafond de l'espace entier (octets) ; `null` = aucun. */
  quota: number | null;
}

export interface RoleConfig {
  name: string;
  from: string[];
  /** Octets ; `null` = illimité. */
  quota: number | null;
  /** Espace (ou `*`) → permissions. */
  spaces: Record<string, SpaceScope[]>;
  links: LinkPolicy;
  admin: Array<AdminPermission | '*'>;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  roleClaims: string[];
  label: string;
  audience: string;
}

export interface InstanceConfig {
  version: 1;
  connection: string;
  name: string;
  oidc: OidcConfig | null;
  gateway: { subjectHeader: string; emailHeader?: string; nameHeader?: string; rolesHeader?: string } | null;
  storages: Map<string, StorageConfig>;
  /** Dans l'ordre du fichier. */
  spaces: SpaceConfig[];
  roles: RoleConfig[];
  legal: { termsVersion: string | null; termsUrl: string | null; uploadLogDays: number; abuseEmail: string | null };
}

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  allowPrivateEndpoints?: boolean;
  allowedEndpoints?: string[];
  instanceName?: string;
  production?: boolean;
}

// ---------------------------------------------------------------------------
// Interpolation

const INTERPOLATION = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
/** Une valeur secrète doit être exactement une interpolation (défaut vide toléré). */
const SECRET_REFERENCE = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-)?\}$/;
const SECRET_FIELDS = new Set(['secretAccessKey', 'sessionToken', 'clientSecret']);

type PathSegment = string | number;

function formatPath(path: readonly PathSegment[]): string {
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}

function interpolate(value: string, path: PathSegment[], env: NodeJS.ProcessEnv): string {
  return value.replace(INTERPOLATION, (_match, name: string, fallback: string | undefined) => {
    const current = env[name];
    if (fallback !== undefined) return current === undefined || current === '' ? fallback : current;
    if (current === undefined) {
      throw new InstanceConfigError(`${formatPath(path)}: environment variable ${name} is not set`);
    }
    return current;
  });
}

/** Parcourt l'arbre brut : refuse les secrets en clair, puis interpole les chaînes. */
function resolveTree(node: unknown, path: PathSegment[], env: NodeJS.ProcessEnv): unknown {
  if (Array.isArray(node)) return node.map((item, i) => resolveTree(item, [...path, i], env));
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = [...path, key];
      if (SECRET_FIELDS.has(key) && value !== undefined && value !== null) {
        if (typeof value !== 'string' || !SECRET_REFERENCE.test(value)) {
          throw new InstanceConfigError(
            `${formatPath(childPath)}: secrets must be a reference to an environment variable (\${VAR}), never a literal value`,
          );
        }
      }
      out[key] = resolveTree(value, childPath, env);
    }
    return out;
  }
  if (typeof node === 'string') return interpolate(node, path, env);
  return node;
}

// ---------------------------------------------------------------------------
// Quotas : octets, KB/MB/GB/TB (base 1000), ou unlimited.

const QUOTA_UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

export function parseQuota(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('quota must be a non-negative integer');
    return value;
  }
  const text = value.trim();
  if (text.toLowerCase() === 'unlimited') return null;
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i.exec(text);
  if (!match) throw new Error('quota must be bytes, a size with KB, MB, GB or TB, or "unlimited"');
  const unit = QUOTA_UNITS[(match[2] ?? 'B').toUpperCase()]!;
  const bytes = Math.round(Number(match[1]) * unit);
  if (!Number.isSafeInteger(bytes)) throw new Error('quota is too large');
  return bytes;
}

// ---------------------------------------------------------------------------
// Schéma

const SLUG = /^[a-z][a-z0-9-]{1,31}$/;
const SPACE_ID = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ROLE_NAME = /^[a-z][a-z0-9_]{1,31}$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ENV_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

const quotaInput = z.union([z.string(), z.number()]).superRefine((v, ctx) => {
  try {
    parseQuota(v);
  } catch (err) {
    ctx.addIssue({ code: 'custom', message: (err as Error).message });
  }
});

const labelInput = z.union([z.string().min(1).max(100), z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string().min(1).max(100))]);

const storageSchema = z.object({
  endpoint: z.url({ protocol: /^https?$/ }),
  region: z.string().min(1).max(64).default('us-east-1'),
  addressing: z.enum(['path', 'virtual']).default('path'),
  accessKeyId: z.string().min(1).max(256),
  secretAccessKey: z.string().min(1).max(512),
  sessionToken: z.string().max(8192).optional(),
});

const spaceSchema = z.object({
  name: labelInput.optional(),
  storage: z.string().regex(SLUG),
  bucket: z.string().regex(BUCKET_NAME, 'invalid bucket name'),
  prefix: z.string().max(512).default(''),
  quota: quotaInput.optional(),
});

const linksSchema = z.object({
  public: z.boolean().default(false),
  people: z.boolean().default(false),
  maxDays: z.number().int().min(0).max(36_500).default(0),
});

const roleSchema = z.object({
  from: z.array(z.string().min(1).max(200)).min(1),
  quota: quotaInput.default('1GB'),
  spaces: z.record(z.string(), z.array(z.enum(SPACE_SCOPES))).default({}),
  links: linksSchema.default({ public: false, people: false, maxDays: 0 }),
  admin: z.array(z.enum([...ADMIN_PERMISSIONS, '*'])).default([]),
});

const oidcSchema = z.object({
  issuer: z.url({ protocol: /^https?$/ }),
  clientId: z.string().min(1).max(200),
  clientSecret: z.string().min(1).max(1000),
  scopes: z.array(z.string().min(1)).default(['openid', 'profile', 'email']),
  roleClaims: z.array(z.string().min(1)).min(1).optional(),
  label: z.string().min(1).max(100).optional(),
  audience: z.string().min(1).optional(),
});

const fileSchema = z.object({
  version: z.literal(1),
  instance: z
    .object({
      connection: z.string().regex(SLUG).default('drive'),
      name: z.string().min(1).max(100).optional(),
    })
    .default({ connection: 'drive' }),
  auth: z.object({
    oidc: oidcSchema.optional(),
    gateway: z
      .object({
        subjectHeader: z.string().regex(ENV_NAME),
        emailHeader: z.string().regex(ENV_NAME).optional(),
        nameHeader: z.string().regex(ENV_NAME).optional(),
        rolesHeader: z.string().regex(ENV_NAME).optional(),
      })
      .optional(),
  }),
  storages: z.record(z.string(), storageSchema),
  spaces: z.record(z.string(), spaceSchema),
  roles: z.record(z.string(), roleSchema),
  legal: z
    .object({
      termsVersion: z.union([z.string().min(1).max(100), z.number()]).nullable().optional(),
      termsUrl: z.url({ protocol: /^https?$/ }).nullable().optional(),
      uploadLogDays: z.number().int().min(1).max(3650).default(365),
      abuseEmail: z.string().max(320).nullable().optional(),
    })
    .default({ uploadLogDays: 365 }),
});

// ---------------------------------------------------------------------------
// Contrôles qui dépassent le schéma

function fail(path: string, message: string): never {
  throw new InstanceConfigError(`${path}: ${message}`);
}

/** Adresse IP privée, de bouclage, link-local ou de métadonnées (01 annexe B, version courte). */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const kind = isIP(h);
  if (kind === 4) {
    const [a = 0, b = 0] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (kind === 6) {
    return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
  }
  return false;
}

function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) return host.endsWith(p.slice(1)) && host.length > p.length - 1;
  return host === p;
}

function checkPrefix(path: string, prefix: string): void {
  if (prefix === '') return;
  if (prefix.startsWith('/')) fail(path, 'must not start with "/"');
  if (!prefix.endsWith('/')) fail(path, 'must be empty or end with "/"');
  if (prefix.includes('//')) fail(path, 'must not contain "//"');
  if (/[\u0000-\u001f\u007f]/.test(prefix)) fail(path, 'must not contain control characters');
  for (const segment of prefix.slice(0, -1).split('/')) {
    if (segment === '.' || segment === '..') fail(path, 'must not contain "." or ".." segments');
  }
}

/** Partie du préfixe qui précède `{userId}` (le préfixe entier pour un espace partagé). */
export function prefixBase(prefix: string): string {
  const at = prefix.indexOf(USER_ID_PLACEHOLDER);
  return at < 0 ? prefix : prefix.slice(0, at);
}

function normalizeLabel(input: z.infer<typeof labelInput> | undefined, id: string): Record<string, string> | null {
  if (input === undefined) return { en: id };
  if (typeof input === 'string') return { en: input };
  return { ...input };
}

function expandAdmin(list: Array<AdminPermission | '*'>): Array<AdminPermission | '*'> {
  return [...new Set(list)];
}

/** Lit un texte YAML et renvoie la configuration validée (sans accès disque). */
export function parseInstanceConfig(text: string, options: LoadOptions = {}): InstanceConfig {
  const env = options.env ?? process.env;
  const doc = parseDocument(text, { version: '1.2', prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    const first = doc.errors[0]!;
    const pos = first.linePos?.[0];
    // Le message de `yaml` peut citer le texte source : seul le code et la position sont gardés.
    throw new InstanceConfigError(`invalid YAML (${first.code}${pos ? ` at line ${pos.line}, column ${pos.col}` : ''})`);
  }
  const raw = doc.toJS({ maxAliasCount: 50 }) as unknown;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InstanceConfigError('(root): the file must be a YAML mapping');
  }
  const resolved = resolveTree(raw, [], env);
  const parsed = fileSchema.safeParse(resolved);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new InstanceConfigError(`${formatPath(issue.path as PathSegment[])}: ${issue.message}`);
  }
  const file = parsed.data;

  const connection = file.instance.connection;
  if (connection === CONNECTION_REF_ME || CONNECTION_ID_PATTERN.test(connection)) {
    fail('instance.connection', 'must not be "me" nor look like a connection id (10 base62 characters)');
  }

  const storages = new Map<string, StorageConfig>();
  const storageEntries = Object.entries(file.storages);
  if (storageEntries.length === 0) fail('storages', 'at least one storage is required');
  for (const [slug, s] of storageEntries) {
    const path = `storages.${slug}`;
    if (!SLUG.test(slug)) fail(path, 'storage slug must match ^[a-z][a-z0-9-]{1,31}$');
    if (slug === connection) fail(path, 'storage slug must differ from instance.connection');
    const url = new URL(s.endpoint);
    const host = url.hostname.toLowerCase();
    if (url.username || url.password) fail(`${path}.endpoint`, 'must not contain credentials');
    if (!options.allowPrivateEndpoints && isPrivateHost(host)) {
      fail(`${path}.endpoint`, 'private or loopback endpoints require UD_ALLOW_PRIVATE_ENDPOINTS=1');
    }
    const allowed = options.allowedEndpoints ?? [];
    if (allowed.length > 0 && !allowed.some((p) => hostMatches(host, p))) {
      fail(`${path}.endpoint`, 'endpoint host is not in UD_ALLOWED_ENDPOINTS');
    }
    if (options.production && url.protocol === 'http:' && !isPrivateHost(host)) {
      fail(`${path}.endpoint`, 'plain HTTP endpoints are refused in production');
    }
    storages.set(slug, {
      slug,
      endpoint: s.endpoint.replace(/\/+$/, ''),
      region: s.region,
      addressing: s.addressing,
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey,
      ...(s.sessionToken ? { sessionToken: s.sessionToken } : {}),
    });
  }

  const spaces: SpaceConfig[] = [];
  if (!(HOME_SPACE in file.spaces)) fail('spaces', `the "${HOME_SPACE}" space is required`);
  for (const [id, s] of Object.entries(file.spaces)) {
    const path = `spaces.${id}`;
    if (!SPACE_ID.test(id)) fail(path, 'space id must match ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$');
    if (!storages.has(s.storage)) fail(`${path}.storage`, 'unknown storage');
    checkPrefix(`${path}.prefix`, s.prefix);
    const placeholders = s.prefix.split(USER_ID_PLACEHOLDER).length - 1;
    if (id === HOME_SPACE) {
      if (placeholders !== 1) fail(`${path}.prefix`, `must contain ${USER_ID_PLACEHOLDER} exactly once`);
      const at = s.prefix.indexOf(USER_ID_PLACEHOLDER);
      const before = s.prefix.slice(0, at);
      const after = s.prefix.slice(at + USER_ID_PLACEHOLDER.length);
      if ((before !== '' && !before.endsWith('/')) || !after.startsWith('/')) {
        fail(`${path}.prefix`, `${USER_ID_PLACEHOLDER} must be a whole path segment`);
      }
      if (s.name !== undefined) fail(`${path}.name`, 'the home space has no name (i18n label "My drive")');
      if (s.quota !== undefined) fail(`${path}.quota`, 'the home space quota comes from roles');
    } else if (placeholders > 0 || s.prefix.includes('{')) {
      fail(`${path}.prefix`, `only the home space may contain ${USER_ID_PLACEHOLDER}`);
    }
    spaces.push({
      id,
      storage: s.storage,
      bucket: s.bucket,
      prefix: s.prefix,
      name: id === HOME_SPACE ? null : normalizeLabel(s.name, id),
      quota: s.quota === undefined ? null : parseQuota(s.quota),
    });
  }
  // Aucun recouvrement entre deux espaces d'un même bucket.
  for (let i = 0; i < spaces.length; i++) {
    for (let j = i + 1; j < spaces.length; j++) {
      const a = spaces[i]!;
      const b = spaces[j]!;
      if (a.storage !== b.storage || a.bucket !== b.bucket) continue;
      const pa = prefixBase(a.prefix);
      const pb = prefixBase(b.prefix);
      if (pa.startsWith(pb) || pb.startsWith(pa)) {
        fail(`spaces.${b.id}.prefix`, `overlaps space "${a.id}" in the same bucket`);
      }
    }
  }
  const spaceIds = new Set(spaces.map((s) => s.id));

  const roles: RoleConfig[] = [];
  const roleEntries = Object.entries(file.roles);
  if (roleEntries.length === 0) fail('roles', 'at least one role is required');
  for (const [name, r] of roleEntries) {
    const path = `roles.${name}`;
    if (!ROLE_NAME.test(name)) fail(path, 'role name must match ^[a-z][a-z0-9_]{1,31}$');
    for (const spaceId of Object.keys(r.spaces)) {
      if (spaceId !== '*' && !spaceIds.has(spaceId)) fail(`${path}.spaces.${spaceId}`, 'unknown space');
    }
    roles.push({
      name,
      from: r.from,
      quota: parseQuota(r.quota),
      spaces: Object.fromEntries(Object.entries(r.spaces).map(([k, v]) => [k, [...new Set(v)]])),
      links: r.links,
      admin: expandAdmin(r.admin),
    });
  }

  // Authentification
  let oidc: OidcConfig | null = null;
  if (file.auth.oidc) {
    const o = file.auth.oidc;
    if (!o.scopes.includes('openid')) fail('auth.oidc.scopes', 'must include "openid"');
    if (o.scopes.includes('offline_access')) fail('auth.oidc.scopes', '"offline_access" is refused');
    const issuer = new URL(o.issuer);
    if (options.production && issuer.protocol === 'http:' && !isPrivateHost(issuer.hostname)) {
      fail('auth.oidc.issuer', 'must use HTTPS in production');
    }
    oidc = {
      issuer: o.issuer.replace(/\/+$/, ''),
      clientId: o.clientId,
      clientSecret: o.clientSecret,
      scopes: o.scopes,
      roleClaims: o.roleClaims ?? [`resource_access.${o.clientId}.roles`, 'realm_access.roles'],
      label: o.label ?? issuer.host,
      audience: o.audience ?? o.clientId,
    };
  }
  if (!oidc) {
    fail('auth.oidc', 'is required (auth.gateway alone is not supported yet: P1)');
  }
  const gateway = file.auth.gateway
    ? {
        subjectHeader: file.auth.gateway.subjectHeader,
        ...(file.auth.gateway.emailHeader ? { emailHeader: file.auth.gateway.emailHeader } : {}),
        ...(file.auth.gateway.nameHeader ? { nameHeader: file.auth.gateway.nameHeader } : {}),
        ...(file.auth.gateway.rolesHeader ? { rolesHeader: file.auth.gateway.rolesHeader } : {}),
      }
    : null;

  const termsVersion = file.legal.termsVersion === undefined || file.legal.termsVersion === null ? null : String(file.legal.termsVersion);
  const abuseEmail = file.legal.abuseEmail ? file.legal.abuseEmail : null;

  return {
    version: 1,
    connection,
    name: file.instance.name ?? options.instanceName ?? 'Universal Drive',
    oidc,
    gateway,
    storages,
    spaces,
    roles,
    legal: {
      termsVersion,
      termsUrl: file.legal.termsUrl ?? null,
      uploadLogDays: file.legal.uploadLogDays,
      abuseEmail,
    },
  };
}

/** Lit et valide le fichier `UD_CONFIG`. */
export function loadInstanceConfig(file: string, options: LoadOptions = {}): InstanceConfig {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new InstanceConfigError(`cannot read instance configuration file ${file}`);
  }
  try {
    return parseInstanceConfig(text, options);
  } catch (err) {
    if (err instanceof InstanceConfigError) throw new InstanceConfigError(`${file}: ${err.message}`);
    throw err;
  }
}

export function spaceById(config: InstanceConfig, id: string): SpaceConfig | undefined {
  return config.spaces.find((s) => s.id === id);
}

export function isSuperAdminRole(name: string): boolean {
  return name === SUPER_ADMIN_ROLE;
}

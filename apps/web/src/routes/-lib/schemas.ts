import { z } from 'zod';

/*
 * Schémas de recherche : chaque champ optionnel, valeur invalide ignorée (.catch),
 * jamais de .default(). Provisoires ici : ils migreront vers @ud/contracts (`uiSearch.*`),
 * et des schémas plus précis remplaceront les versions génériques.
 */

const text = (max = 1024) => z.string().max(max).optional().catch(undefined);
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional().catch(undefined);
const flag = () => z.coerce.number().pipe(z.literal(1)).optional().catch(undefined);
const oneOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

const DETAILS_ALIASES: Record<string, string> = { '1': 'info', access: 'permissions' };
const detailsTab = z
  .preprocess(
    (value) => (typeof value === 'string' || typeof value === 'number' ? (DETAILS_ALIASES[String(value)] ?? value) : value),
    z.enum(['info', 'activity', 'versions', 'permissions']).optional(),
  )
  .catch(undefined);

const listShape = {
  view: oneOf(['list', 'grid']),
  dir: oneOf(['asc', 'desc']),
  details: detailsTab,
};

export const listSearch = z.object(listShape);

export const explorerSearch = z.object({
  ...listShape,
  sort: oneOf(['name', 'modified', 'size', 'type']),
  share: flag(),
  sharePane: oneOf(['settings', 'links', 'presign', 'qr']),
  permFocus: text(256),
  focus: text(),
  versions: flag(),
  version: text(),
  key: text(2048),
  object: flag(),
  page: int(1, 1_000_000),
  t: int(0, 1_000_000_000),
});

export const indexSearch = z.object({ to: oneOf(['recent', 'starred', 'upload']), shareFailed: flag() });

export const connectSearch = z.object({
  preset: text(64),
  endpoint: text(2048),
  region: text(64),
  bucket: text(255),
  prefix: text(),
  next: text(4096),
  lang: text(16),
});

export const accountsSearch = z.object({ next: text(4096) });

export const connLayoutSearch = z.object({ settings: text(64) });

export const homeSearch = z.object({
  ...listShape,
  q: text(256),
  sort: oneOf(['name', 'created', 'size', 'region']),
  hidden: flag(),
  newBucket: text(64),
});

export const recentSearch = z.object({
  ...listShape,
  action: oneOf(['opened', 'uploaded', 'edited']),
  source: oneOf(['web', 'mcp', 'api', 'share']),
  sort: oneOf(['activity', 'name', 'size']),
});

export const starredSearch = z.object({
  ...listShape,
  kind: oneOf(['file', 'folder', 'bucket']),
  sort: oneOf(['added', 'name']),
});

export const sharedSearch = z.object({
  tab: oneOf(['links', 'presigned', 'short']),
  status: text(32),
  bucket: text(255),
  role: text(32),
  access: text(32),
  via: text(32),
  app: text(128),
  q: text(256),
  sort: text(32),
  dir: oneOf(['asc', 'desc']),
  link: text(128),
  valid: text(32),
});

export const trashSearch = z.object({
  ...listShape,
  bucket: text(255),
  sort: oneOf(['deleted', 'name', 'size', 'expires']),
});

export const storageSearch = z.object({
  sort: oneOf(['size', 'objects', 'name', 'computed']),
  dir: oneOf(['asc', 'desc']),
});

// SearchSearch complet : avec la recherche.
export const searchSearch = z.object({ ...listShape, q: text(256) });

export const ADMIN_TABS = [
  'overview',
  'permissions',
  'policy',
  'versioning',
  'lifecycle',
  'cors',
  'encryption',
  'object-lock',
  'website',
  'logging',
  'notifications',
  'replication',
  'tags',
  'properties',
  'aws',
  'uploads',
  'usage',
  'advanced',
] as const;

export const adminSearch = z.object(
  Object.fromEntries(
    [
      'section',
      'rule',
      'id',
      'new',
      'entry',
      'prefix',
      'depth',
      'assist',
      'preset',
      'origin',
      'aspect',
      'format',
      'olderThan',
      'sort',
      'dir',
      'mode',
      'statement',
      'template',
      'review',
      'pabWizard',
      'key',
    ].map((name) => [name, text()]),
  ),
);

export const ACCESS_TABS = ['tokens', 'temporary', 'security', 'activity', 'clients', 'identities', 'exposure'] as const;

export const accessSearch = z.object(
  Object.fromEntries(
    [
      'token',
      'new',
      'preset',
      'section',
      'filter',
      'bucket',
      'status',
      'id',
      'prefix',
      'level',
      'method',
      'step',
      'kind',
      'tab',
    ].map((name) => [name, text()]),
  ),
);

export const jobsSearch = z.object({ state: text(32), type: text(64), job: text(128) });

/** Identifiant de stockage : 10 caractères base62. */
export const CONN_ID = /^[0-9A-Za-z]{10}$/;

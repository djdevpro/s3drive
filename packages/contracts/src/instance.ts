import { z } from 'zod';
import type { Scope } from './auth.js';

// Mode instance : contrats des routes /instance, /auth/oidc/*, /me, /admin/*
// et des routes d'objets et d'envoi servies sur la connexion de l'instance.

/** `UD_MODE`. */
export const INSTANCE_MODES = ['personal', 'instance', 'both'] as const;
export type InstanceMode = (typeof INSTANCE_MODES)[number];
export const instanceModeSchema = z.enum(INSTANCE_MODES);

/** Permissions d'un espace : sous-ensemble des permissions de l'API. */
export const SPACE_SCOPES = ['read', 'write', 'delete', 'share'] as const satisfies readonly Scope[];
export type SpaceScope = (typeof SPACE_SCOPES)[number];
export const spaceScopeSchema = z.enum(SPACE_SCOPES);

/** Droits d'administration de l'instance. */
export const ADMIN_PERMISSIONS = ['users.read', 'users.manage', 'reports.manage', 'audit.read', 'files.inspect'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export const adminPermissionSchema = z.enum(ADMIN_PERMISSIONS);

/** Rôle Drive réservé qui donne tout, partout. */
export const SUPER_ADMIN_ROLE = 'super_admin';
/** Espace réservé : le drive personnel. */
export const HOME_SPACE = 'home';
/** Marqueur de l'id de la personne dans le préfixe de `home`. */
export const USER_ID_PLACEHOLDER = '{userId}';
/** Préfixe système caché à la racine d'un espace. */
export const RESERVED_PREFIX = '.universal-drive/';

/** Motifs (`details.reason`) propres au mode instance. */
export const INSTANCE_REASONS = {
  noRole: 'no_role',
  suspended: 'suspended',
  sessionEnded: 'session_ended',
  idpUnreachable: 'idp_unreachable',
  termsRequired: 'terms_required',
  linkPolicy: 'link_policy',
  oidcError: 'oidc_error',
} as const;

/** Valeurs de `?error=` de `/login`. */
export const LOGIN_ERRORS = ['no_role', 'suspended', 'session_ended', 'idp_unreachable', 'oidc_error'] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];
export const loginErrorSchema = z.enum(LOGIN_ERRORS);

/** `details.limit` d'un refus de quota. */
export const QUOTA_LIMITS = ['user_quota', 'space_quota'] as const;
export type QuotaLimit = (typeof QUOTA_LIMITS)[number];

const bytes = z.number().int().nonnegative();
/** Octets ; `null` = illimité. */
const quotaValue = bytes.nullable();

export const linkPolicySchema = z.object({
  public: z.boolean(),
  people: z.boolean(),
  /** Expiration maximale en jours ; 0 = libre. */
  maxDays: z.number().int().nonnegative(),
});
export type LinkPolicy = z.infer<typeof linkPolicySchema>;

/** Droits effectifs d'une personne, union de ses rôles. */
export const grantsSchema = z.object({
  superAdmin: z.boolean(),
  /** Espace → permissions (`"*"` déjà développé). */
  spaces: z.record(z.string(), z.array(spaceScopeSchema)),
  quota: quotaValue,
  links: linkPolicySchema,
  admin: z.array(adminPermissionSchema),
});
export type Grants = z.infer<typeof grantsSchema>;

/** Principal `user`, complément de `principalSchema` d'auth.ts. */
export const userPrincipalSchema = z.object({
  kind: z.literal('user'),
  userId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  via: z.enum(['oidc', 'gateway', 'bearer']),
  roles: z.array(z.string()),
  grants: grantsSchema,
});
export type UserPrincipal = z.infer<typeof userPrincipalSchema>;

/** Libellé d'un espace : table par langue, ou `null` pour `home` (libellé i18n « Mon drive »). */
export const spaceLabelSchema = z.record(z.string(), z.string()).nullable();

export const usageSchema = z.object({ bytes, objects: bytes });
export type Usage = z.infer<typeof usageSchema>;

// ---------------------------------------------------------------------------
// GET /api/v1/instance (publique)

export const instanceInfoSchema = z.object({
  mode: instanceModeSchema,
  /** Id de la connexion de l'instance ; `null` en mode personnel. */
  connection: z.string().nullable(),
  name: z.string(),
  /** Bouton « Se connecter avec … » ; `null` sans connexion OIDC. */
  login: z.object({ label: z.string() }).nullable(),
  /** Vrai si `/connect` (stockages personnels) est ouvert. */
  personal: z.boolean(),
});
export type InstanceInfo = z.infer<typeof instanceInfoSchema>;

// ---------------------------------------------------------------------------
// Compte : GET /api/v1/me, GET|POST /api/v1/me/terms, POST /api/v1/auth/logout

export const meSpaceSchema = z.object({
  id: z.string(),
  label: spaceLabelSchema,
  scopes: z.array(spaceScopeSchema),
  quota: quotaValue,
  usage: usageSchema,
});
export type MeSpace = z.infer<typeof meSpaceSchema>;

export const termsStateSchema = z.object({
  required: z.boolean(),
  version: z.string().nullable(),
  url: z.string().nullable(),
});

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    /** Rôles Drive (jamais les noms bruts du fournisseur). */
    roles: z.array(z.string()),
  }),
  connection: z.string(),
  spaces: z.array(meSpaceSchema),
  /** Drive personnel. */
  quota: z.object({ limit: quotaValue, used: bytes, reserved: bytes }),
  links: linkPolicySchema,
  admin: z.array(adminPermissionSchema),
  superAdmin: z.boolean(),
  terms: termsStateSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `GET /api/v1/me/terms` : texte des conditions (Markdown de `UD_TERMS_FILE`) ou lien externe. */
export const termsResponseSchema = z.object({
  version: z.string().nullable(),
  markdown: z.string().nullable(),
  url: z.string().nullable(),
  acceptedVersion: z.string().nullable(),
});
export type TermsResponse = z.infer<typeof termsResponseSchema>;

export const acceptTermsRequestSchema = z.object({ version: z.string().min(1).max(100) });
export type AcceptTermsRequest = z.infer<typeof acceptTermsRequestSchema>;

export const logoutResponseSchema = z.object({ endSessionUrl: z.string().nullable() });
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

// ---------------------------------------------------------------------------
// Connexion de l'instance : GET /api/v1/c/:conn, GET /api/v1/c/:conn/buckets

export const instanceConnectionSummarySchema = z.object({
  id: z.string(),
  kind: z.literal('instance'),
  name: z.string(),
  apiVersion: z.string(),
});
export type InstanceConnectionSummary = z.infer<typeof instanceConnectionSummarySchema>;

/** Un espace présenté comme un bucket. */
export const spaceBucketSchema = z.object({
  name: z.string(),
  kind: z.literal('space'),
  label: spaceLabelSchema,
  scopes: z.array(spaceScopeSchema),
  quota: quotaValue,
  usage: usageSchema,
});
export type SpaceBucket = z.infer<typeof spaceBucketSchema>;

export const spaceBucketListSchema = z.object({ items: z.array(spaceBucketSchema), nextCursor: z.null() });

// ---------------------------------------------------------------------------
// Objets — clés relatives à l'espace

export const folderItemSchema = z.object({
  kind: z.literal('folder'),
  /** Préfixe relatif complet, `/` final. */
  key: z.string(),
  name: z.string(),
});
export type FolderItem = z.infer<typeof folderItemSchema>;

export const fileItemSchema = z.object({
  kind: z.literal('file'),
  key: z.string(),
  name: z.string(),
  size: bytes,
  lastModified: z.string(),
  etag: z.string(),
  storageClass: z.string(),
});
export type FileItem = z.infer<typeof fileItemSchema>;

export const listItemSchema = z.discriminatedUnion('kind', [folderItemSchema, fileItemSchema]);
export type ListItem = z.infer<typeof listItemSchema>;

export const objectListPageSchema = z.object({
  items: z.array(listItemSchema),
  nextCursor: z.string().min(1).nullable(),
  prefix: z.string(),
  partial: z.boolean(),
});
export type ObjectListPage = z.infer<typeof objectListPageSchema>;

export const objectDetailsSchema = z.object({
  kind: z.literal('file'),
  bucket: z.string(),
  key: z.string(),
  name: z.string(),
  size: bytes,
  lastModified: z.string(),
  etag: z.string(),
  contentType: z.string().optional(),
  versionId: z.string().optional(),
  metadata: z.record(z.string(), z.string()),
});
export type ObjectDetails = z.infer<typeof objectDetailsSchema>;

/** Stratégies de conflit ; `skip` pour copier et déplacer. */
export const CONFLICT_POLICIES = ['fail', 'overwrite', 'rename', 'skip'] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];
export const conflictPolicySchema = z.enum(CONFLICT_POLICIES);

export const renameRequestSchema = z.object({
  newName: z.string().min(1).max(1024),
  conflict: conflictPolicySchema.default('fail'),
});
export type RenameRequest = z.infer<typeof renameRequestSchema>;

/** Déplacer ou copier : `destination.key` est la clé complète visée (préfixe `/` final pour un dossier). */
export const transferRequestSchema = z.object({
  destination: z.object({ bucket: z.string().min(1).optional(), key: z.string().min(1) }),
  conflict: conflictPolicySchema.default('fail'),
});
export type TransferRequest = z.infer<typeof transferRequestSchema>;

export const objectOperationResultSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  /** Nombre d'objets touchés (1 pour un fichier, davantage pour un dossier). */
  objects: bytes,
  skipped: z.boolean().optional(),
});
export type ObjectOperationResult = z.infer<typeof objectOperationResultSchema>;

export const deleteObjectResponseSchema = z.object({ deleted: bytes });
export type DeleteObjectResponse = z.infer<typeof deleteObjectResponseSchema>;

export const downloadResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  transport: z.literal('direct'),
});
export type DownloadResponse = z.infer<typeof downloadResponseSchema>;

// ---------------------------------------------------------------------------
// Envois

export const UPLOAD_PURPOSES = ['upload', 'edit', 'version'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

export const createUploadRequestSchema = z.object({
  size: bytes,
  contentType: z.string().min(1).max(255).optional(),
  lastModified: z.number().int().nonnegative().optional(),
  mode: z.enum(['auto', 'single', 'multipart']).default('auto'),
  purpose: z.enum(UPLOAD_PURPOSES).default('upload'),
  conflict: z.enum(['overwrite', 'fail']).default('overwrite'),
  origin: z.object({ app: z.string().max(100), ref: z.string().max(500) }).optional(),
});
export type CreateUploadRequest = z.input<typeof createUploadRequestSchema>;

export const presignedPartSchema = z.object({
  partNumber: z.number().int().min(1),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type PresignedPart = z.infer<typeof presignedPartSchema>;

const createUploadCommon = {
  key: z.string(),
  transport: z.literal('direct'),
  corsOk: z.boolean().nullable(),
  weakGuard: z.boolean(),
  expiresAt: z.string(),
};

export const createUploadResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    ...createUploadCommon,
    mode: z.literal('single'),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    receipt: z.string(),
  }),
  z.object({
    ...createUploadCommon,
    mode: z.literal('multipart'),
    uploadId: z.string(),
    partSize: z.number().int().positive(),
    partCount: z.number().int().positive(),
    checksum: z.null(),
    contentMd5Required: z.boolean(),
    parts: z.array(presignedPartSchema).optional(),
  }),
]);
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

export const presignPartsRequestSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10_000), size: bytes }))
    .min(1)
    .max(100),
});
export type PresignPartsRequest = z.infer<typeof presignPartsRequestSchema>;

export const presignPartsResponseSchema = z.object({ parts: z.array(presignedPartSchema) });

export const uploadedPartSchema = z.object({
  partNumber: z.number().int().min(1),
  etag: z.string(),
  size: bytes,
});
export const uploadPartsPageSchema = z.object({ items: z.array(uploadedPartSchema), nextCursor: z.null() });

export const completeUploadRequestSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().optional() }))
    .max(10_000)
    .optional(),
  size: bytes,
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

export const uploadResultSchema = z.object({
  key: z.string(),
  etag: z.string(),
  versionId: z.string().optional(),
  size: bytes,
});
export type UploadResult = z.infer<typeof uploadResultSchema>;

export const confirmUploadsRequestSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1),
        receipt: z.string().min(1).max(200),
        etag: z.string().optional(),
        versionId: z.string().optional(),
        size: bytes,
      }),
    )
    .min(1)
    .max(1000),
});
export type ConfirmUploadsRequest = z.infer<typeof confirmUploadsRequestSchema>;

export const confirmUploadsResponseSchema = z.object({
  results: z.array(
    z.object({
      key: z.string(),
      ok: z.boolean(),
      verified: z.boolean(),
      error: z.object({ error: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() }).optional(),
    }),
  ),
});
export type ConfirmUploadsResponse = z.infer<typeof confirmUploadsResponseSchema>;

// ---------------------------------------------------------------------------
// Administration

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const userStatusSchema = z.enum(USER_STATUSES);

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  /** Rôles Drive vus à la dernière connexion (lecture seule : ils viennent du fournisseur). */
  roles: z.array(z.string()),
  status: userStatusSchema,
  quota: z.object({ limit: quotaValue, used: bytes, reserved: bytes, objects: bytes }),
  quotaOverride: bytes.nullable(),
  termsVersion: z.string().nullable(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const ADMIN_USER_SORTS = ['name', 'email', 'lastLogin', 'usage', 'created'] as const;
export const adminUserListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  sort: z.enum(ADMIN_USER_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export const adminUserListSchema = z.object({
  items: z.array(adminUserSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type AdminUserList = z.infer<typeof adminUserListSchema>;

export const adminUserPatchSchema = z
  .object({
    status: userStatusSchema.optional(),
    quotaOverride: bytes.nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.quotaOverride !== undefined, { message: 'Nothing to update' });
export type AdminUserPatch = z.infer<typeof adminUserPatchSchema>;

// ---------------------------------------------------------------------------
// Clés relatives : fonction pure, utilisable par le front pour prévalider.

export type RelativeKeyProblem = 'empty' | 'leading_slash' | 'double_slash' | 'dot_segment' | 'control_char' | 'too_long';

const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
/** Longueur UTF-8 d'une chaîne, sans TextEncoder ni Buffer (paquet isomorphe sans lib DOM). */
export function utf8Length(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Motif de refus d'une clé relative à un espace, ou `null` si elle est acceptable.
 * `allowEmpty` : la racine d'une liste (préfixe vide). `rootBytes` : longueur en octets
 * de la racine réelle de l'espace, ajoutée pour le contrôle des 1 024 octets.
 */
export function relativeKeyProblem(
  key: string,
  options: { allowEmpty?: boolean; rootBytes?: number } = {},
): RelativeKeyProblem | null {
  if (key === '') return options.allowEmpty ? null : 'empty';
  if (key.startsWith('/')) return 'leading_slash';
  if (key.includes('//')) return 'double_slash';
  if (CONTROL_CHAR.test(key)) return 'control_char';
  const segments = key.split('/');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return 'dot_segment';
  }
  if (utf8Length(key) + (options.rootBytes ?? 0) > 1024) return 'too_long';
  return null;
}

/** Vrai si la clé désigne un dossier (préfixe terminé par `/`). */
export function isFolderKey(key: string): boolean {
  return key.endsWith('/');
}

/** Dernier segment non vide d'une clé, sans le `/` final. */
export function keyName(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
  const slash = trimmed.lastIndexOf('/');
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/** Dossier parent d'une clé (`''` à la racine), `/` final compris. */
export function parentPrefix(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
  const slash = trimmed.lastIndexOf('/');
  return slash < 0 ? '' : trimmed.slice(0, slash + 1);
}


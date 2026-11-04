import { z } from 'zod';

/** États d'une capacité. Une configuration absente mais possible = `supported` + `configured: false`. */
export const CAP_STATES = ['supported', 'unsupported', 'denied', 'unknown'] as const;
export type CapState = (typeof CAP_STATES)[number];
export const capStateSchema = z.enum(CAP_STATES);

export const CAP_SOURCES = ['observed', 'probe', 'conformance', 'manual', 'prior'] as const;
export type CapSource = (typeof CAP_SOURCES)[number];
export const capSourceSchema = z.enum(CAP_SOURCES);

/** `Cap` de 02 ; ouvert, car certaines capacités portent des champs propres (`values`, `maxSeconds`…). */
export const capSchema = z.looseObject({
  state: capStateSchema,
  source: capSourceSchema.optional(),
  configured: z.boolean().optional(),
  checkedAt: z.string().optional(),
  detail: z.string().optional(),
  docUrl: z.string().optional(),
});
export type Cap = z.infer<typeof capSchema>;

/** Capacité d'un aspect de configuration : l'écriture peut différer de la lecture. */
export const configCapSchema = capSchema.extend({ writeState: capStateSchema.optional() });
export type ConfigCap = z.infer<typeof configCapSchema>;

/** Clés de `ServiceCapabilities` qui portent un `Cap`. */
export const SERVICE_CAPABILITY_KEYS = [
  'listBuckets',
  'listBucketsPaginated',
  'createBucket',
  'directoryBuckets',
  's3Control',
  'sts',
  'iam',
] as const;
export type ServiceCapabilityKey = (typeof SERVICE_CAPABILITY_KEYS)[number];

/** Clés de `BucketCapabilities` qui portent un `ConfigCap`. */
export const BUCKET_CONFIG_CAPABILITY_KEYS = [
  'versioning',
  'objectLock',
  'acl',
  'policy',
  'publicAccessBlock',
  'ownershipControls',
  'abac',
  'cors',
  'lifecycle',
  'encryption',
  'tagging',
  'website',
  'logging',
  'notifications',
  'replication',
  'requestPayment',
  'accelerate',
  'analytics',
  'inventory',
  'metrics',
  'intelligentTiering',
  'metadataTable',
] as const;

/** Toutes les clés de capacités de `BucketCapabilities`. `conditionalWrites` est un groupe d'états. */
export const BUCKET_CAPABILITY_KEYS = [
  'read',
  'write',
  'delete',
  'list',
  'listV2',
  'listVersions',
  'encodingTypeUrl',
  'listOrdered',
  'listRestoreStatus',
  'mfaDelete',
  'objectRetention',
  'legalHold',
  'policyStatus',
  'sseS3',
  'sseKms',
  'sseC',
  'objectTagging',
  'storageClasses',
  'restore',
  'multipart',
  'uploadPartCopy',
  'copyCrossBucket',
  'deleteObjects',
  'getObjectAttributes',
  'annotations',
  'updateObjectEncryption',
  'conditionalWrites',
  'checksums',
  'postPolicy',
  'responseOverrides',
  'presign',
  'quota',
  ...BUCKET_CONFIG_CAPABILITY_KEYS,
] as const;
export type BucketCapabilityKey = (typeof BUCKET_CAPABILITY_KEYS)[number];
export type BucketConfigCapabilityKey = (typeof BUCKET_CONFIG_CAPABILITY_KEYS)[number];

export type CapabilityKey = ServiceCapabilityKey | BucketCapabilityKey;

/** `:aspect` de `…/config/:aspect` → clé de capacité. */
export const CAPABILITY_KEY_BY_ASPECT = {
  versioning: 'versioning',
  lifecycle: 'lifecycle',
  cors: 'cors',
  encryption: 'encryption',
  website: 'website',
  logging: 'logging',
  notifications: 'notifications',
  replication: 'replication',
  abac: 'abac',
  accelerate: 'accelerate',
  inventory: 'inventory',
  analytics: 'analytics',
  metrics: 'metrics',
  quota: 'quota',
  acl: 'acl',
  policy: 'policy',
  'object-lock': 'objectLock',
  tags: 'tagging',
  'request-payment': 'requestPayment',
  'intelligent-tiering': 'intelligentTiering',
  'metadata-table': 'metadataTable',
  'public-access-block': 'publicAccessBlock',
  ownership: 'ownershipControls',
} as const satisfies Record<string, BucketCapabilityKey>;

export function isCapSupported(cap: Pick<Cap, 'state'> | undefined): boolean {
  return cap?.state === 'supported';
}

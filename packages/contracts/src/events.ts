import { z } from 'zod';
import { connectionStatusSchema, delegationStateSchema } from './auth.js';
import { apiErrorSchema } from './errors.js';

/** Liste fermée des événements SSE de `GET /api/v1/c/:conn/events` (A8). */
export const EVENT_TYPES = [
  'job.progress',
  'job.done',
  'upload.completed',
  'objects.changed',
  'capabilities.updated',
  'connection.status',
  'stars.changed',
  'settings.changed',
  'share.accessed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const eventTypeSchema = z.enum(EVENT_TYPES);

/** Origine d'un changement. */
export const CHANGE_ORIGINS = ['web', 'mcp', 'api', 'share', 'job', 'system'] as const;
export type ChangeOrigin = (typeof CHANGE_ORIGINS)[number];
export const changeOriginSchema = z.enum(CHANGE_ORIGINS);

/** États d'un job. */
export const JOB_STATES = ['queued', 'running', 'paused', 'cancelling', 'cancelled', 'done', 'failed'] as const;
export type JobState = (typeof JOB_STATES)[number];
export const jobStateSchema = z.enum(JOB_STATES);

const count = z.number().int().nonnegative();

// Charges (01 ConnectionStatusEvent / SettingsChangedEvent).
export const jobProgressEventSchema = z.object({
  jobId: z.string().min(1),
  type: z.string().min(1),
  state: jobStateSchema,
  phase: z.enum(['listing', 'processing']),
  doneItems: count,
  totalItems: count.optional(),
  doneBytes: count,
  totalBytes: count.optional(),
  failedItems: count,
  rate: z.number().nonnegative().optional(),
});

export const jobDoneEventSchema = z.object({
  jobId: z.string().min(1),
  type: z.string().min(1),
  state: jobStateSchema,
  doneItems: count,
  failedItems: count,
  bucket: z.string().optional(),
  prefixes: z.array(z.string()),
  error: apiErrorSchema.optional(),
});

export const uploadCompletedEventSchema = z.object({
  operationId: z.string().min(1),
  uploadId: z.string().min(1),
  bucket: z.string().min(1),
  key: z.string().min(1),
  state: z.enum(['completed', 'failed']),
  /** `UploadResult` de 06, précisé par son lot. */
  result: z.unknown().optional(),
  error: apiErrorSchema.optional(),
});

export const objectsChangedEventSchema = z.object({
  bucket: z.string().min(1),
  prefixes: z.array(z.string()),
  origin: changeOriginSchema,
  jobId: z.string().optional(),
});

export const capabilitiesUpdatedEventSchema = z.object({
  bucket: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

export const connectionStatusEventSchema = z.object({
  connectionId: z.string().min(1),
  status: z.union([connectionStatusSchema, z.literal('removed')]).optional(),
  delegation: delegationStateSchema.optional(),
  reason: z
    .enum(['credentials_rejected', 'session_token_expired', 'delegation_broken', 'forgotten', 'rekeyed', 'revoked'])
    .optional(),
  newSession: z.object({ browser: z.string(), os: z.string(), at: z.string() }).optional(),
  /** Perte de rejeu : le client invalide toutes ses listes. */
  stream: z.object({ replay: z.literal('gap') }).optional(),
});

export const starRefSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  kind: z.enum(['file', 'folder', 'bucket']),
});

export const starsChangedEventSchema = z.object({
  origin: changeOriginSchema,
  /** Absent : tout invalider. */
  refs: z.array(starRefSchema).optional(),
});

export const settingsChangedEventSchema = z.object({
  connectionId: z.string().min(1),
  etag: z.string(),
  keys: z.array(z.string()),
});

export const shareAccessedEventSchema = z.object({
  shareId: z.string().min(1),
  action: z.enum(['view', 'download', 'zip', 'upload', 'access_request']),
  path: z.string().optional(),
  at: z.string(),
  visitor: z.object({ email: z.string().optional(), anonymous: z.boolean() }),
});

export const EVENT_PAYLOAD_SCHEMAS = {
  'job.progress': jobProgressEventSchema,
  'job.done': jobDoneEventSchema,
  'upload.completed': uploadCompletedEventSchema,
  'objects.changed': objectsChangedEventSchema,
  'capabilities.updated': capabilitiesUpdatedEventSchema,
  'connection.status': connectionStatusEventSchema,
  'stars.changed': starsChangedEventSchema,
  'settings.changed': settingsChangedEventSchema,
  'share.accessed': shareAccessedEventSchema,
} as const satisfies Record<EventType, z.ZodType>;

export type EventPayloads = { [K in EventType]: z.infer<(typeof EVENT_PAYLOAD_SCHEMAS)[K]> };
export type StarRef = z.infer<typeof starRefSchema>;

/** Un message SSE : `id` rejouable par `Last-Event-ID`, `event` = type, `data` = charge JSON. */
export type ServerEvent = { [K in EventType]: { id: string; type: K; data: EventPayloads[K] } }[EventType];

/** Valide la charge d'un événement reçu ; `null` pour un type inconnu ou une charge invalide. */
export function parseServerEvent(id: string, type: string, data: unknown): ServerEvent | null {
  const parsedType = eventTypeSchema.safeParse(type);
  if (!parsedType.success) return null;
  const parsed = EVENT_PAYLOAD_SCHEMAS[parsedType.data].safeParse(data);
  if (!parsed.success) return null;
  return { id, type: parsedType.data, data: parsed.data } as ServerEvent;
}

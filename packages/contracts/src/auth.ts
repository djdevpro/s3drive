import { z } from 'zod';

/** Permissions des jetons, indépendantes et sans hiérarchie (A3). */
export const SCOPES = ['read', 'write', 'delete', 'share', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];
export const scopeSchema = z.enum(SCOPES);

export const SHARE_ROLES = ['viewer', 'viewer_no_download', 'uploader', 'editor'] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];
export const shareRoleSchema = z.enum(SHARE_ROLES);

export const CONNECTION_STATUSES = ['ok', 'expiring', 'reauth'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

export const DELEGATION_STATES = ['none', 'active', 'broken'] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];
export const delegationStateSchema = z.enum(DELEGATION_STATES);

// Formats d'identifiants.
export const CONNECTION_ID_PATTERN = /^[0-9A-Za-z]{10}$/;
export const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/;
export const ACCESS_TOKEN_ID_PATTERN = /^[0-9A-Za-z]{16}$/;
/** 32 octets aléatoires en base64url sans remplissage. */
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ACCESS_TOKEN_PREFIX = 'ud_at_';
export const ACCESS_TOKEN_PATTERN = /^ud_at_([0-9A-Za-z]{16})\.([A-Za-z0-9_-]{43})$/;
/** Valeur de `:conn` qui désigne la connexion du jeton. */
export const CONNECTION_REF_ME = 'me';

export const connectionIdSchema = z.string().regex(CONNECTION_ID_PATTERN);
export const sessionIdSchema = z.string().regex(SESSION_ID_PATTERN);
export const accessTokenIdSchema = z.string().regex(ACCESS_TOKEN_ID_PATTERN);
export const accessTokenSchema = z.string().regex(ACCESS_TOKEN_PATTERN);
/** Paramètre `:conn` des routes `/api/v1/c/:conn/…`. */
export const connectionRefSchema = z.union([z.literal(CONNECTION_REF_ME), connectionIdSchema]);

export function isConnectionId(value: string): boolean {
  return CONNECTION_ID_PATTERN.test(value);
}

export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

export interface ParsedAccessToken {
  id: string;
  secret: string;
}

/** Lit un jeton `ud_at_<id>.<secret>` ; `null` si la forme est invalide. Aucune vérification cryptographique. */
export function parseAccessToken(value: string): ParsedAccessToken | null {
  const match = ACCESS_TOKEN_PATTERN.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { id: match[1], secret: match[2] };
}

/** Vrai si la valeur a l'allure d'un jeton (préfixe seul) : sert à masquer ou retirer, pas à authentifier. */
export function looksLikeAccessToken(value: string): boolean {
  return value.startsWith(ACCESS_TOKEN_PREFIX);
}

/** Extrait la valeur d'un en-tête `Authorization: Bearer <valeur>` (schéma insensible à la casse). */
export function readBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer +(\S+) *$/i.exec(authorization);
  return match?.[1] ?? null;
}

export interface ParsedSessionCookie {
  sessionId: string;
  secret: string;
}

/** Lit la valeur du cookie de session `<sessionId>.<secret>`. */
export function parseSessionCookie(value: string): ParsedSessionCookie | null {
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const sessionId = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  if (!SESSION_ID_PATTERN.test(sessionId) || !SECRET_PATTERN.test(secret)) return null;
  return { sessionId, secret };
}

export const tokenRestrictionsSchema = z.object({
  buckets: z.array(z.string().min(1)).nullable(),
  prefix: z.string().nullable(),
});
export type TokenRestrictions = z.infer<typeof tokenRestrictionsSchema>;

/** Principal résolu par le serveur pour chaque requête. */
export const principalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: z.string().min(1), connectionId: z.string().min(1) }),
  z.object({
    kind: z.literal('token'),
    tokenId: z.string().min(1),
    connectionId: z.string().min(1),
    scopes: z.array(scopeSchema),
    restrictions: tokenRestrictionsSchema,
  }),
  z.object({
    kind: z.literal('share'),
    shareId: z.string().min(1),
    connectionId: z.string().min(1),
    role: shareRoleSchema,
    root: z.object({ bucket: z.string().min(1), prefix: z.string() }),
  }),
]);
export type Principal = z.infer<typeof principalSchema>;
export type PrincipalKind = Principal['kind'];

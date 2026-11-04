import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Grants, InstanceMode, UserPrincipal } from '@ud/contracts';
import { AuditLog } from '../audit.js';
import type { Config } from '../config.js';
import type { SecretKey } from '../crypto.js';
import type { RequestEnv } from '../request.js';
import type { InstanceConfig } from './config.js';
import { computeGrants } from './grants.js';
import { OidcClient } from './oidc.js';
import { type ActiveSession, SessionStore } from './session.js';
import { InstanceStorages, type S3Factory, defaultS3Factory } from './storage.js';
import { UsageStore } from './usage.js';
import { type UserRow, UserStore } from './users.js';

// État partagé du mode instance : configuration, magasins, moteur S3, client OIDC.

export interface InstanceRuntime {
  mode: InstanceMode;
  config: InstanceConfig;
  env: Config;
  requestEnv: RequestEnv;
  key: SecretKey;
  db: DatabaseSync;
  storages: InstanceStorages;
  oidc: OidcClient;
  audit: AuditLog;
  sessions: SessionStore;
  users: UserStore;
  usage: UsageStore;
  clock: () => number;
  /** Texte Markdown des conditions (`UD_TERMS_FILE`), ou `null`. */
  termsMarkdown: string | null;
  refreshMs: number;
  /** Rafraîchissements OIDC en cours : un seul à la fois par session. */
  refreshing: Map<string, Promise<RefreshOutcome>>;
}

export type RefreshOutcome = { kind: 'ok'; roles: string[] } | { kind: 'ended' } | { kind: 'unavailable' };

/** Variables Hono des routes authentifiées du mode instance. */
export interface InstanceVariables {
  principal: UserPrincipal;
  session: ActiveSession;
  user: UserRow;
}
export type InstanceEnv = { Variables: InstanceVariables };

export interface RuntimeOptions {
  mode: InstanceMode;
  config: InstanceConfig;
  env: Config;
  key: SecretKey;
  db: DatabaseSync;
  s3Factory?: S3Factory;
  clock?: () => number;
  /** Autorise un fournisseur OIDC en HTTP (développement, tests). */
  allowInsecureOidc?: boolean;
}

export function createInstanceRuntime(options: RuntimeOptions): InstanceRuntime {
  const { config, env, db, key } = options;
  const clock = options.clock ?? Date.now;
  let termsMarkdown: string | null = null;
  if (env.UD_TERMS_FILE) {
    try {
      termsMarkdown = readFileSync(env.UD_TERMS_FILE, 'utf8');
    } catch {
      throw new Error(`Cannot read UD_TERMS_FILE ${env.UD_TERMS_FILE}`);
    }
  }
  const allowInsecure = options.allowInsecureOidc ?? (env.NODE_ENV !== 'production' || isLoopbackIssuer(config.oidc!.issuer));
  const runtime: InstanceRuntime = {
    mode: options.mode,
    config,
    env,
    requestEnv: { publicUrl: env.UD_PUBLIC_URL, trustProxy: env.UD_TRUST_PROXY },
    key,
    db,
    storages: new InstanceStorages(config, options.s3Factory ?? defaultS3Factory, {
      timeoutMs: env.UD_S3_TIMEOUT_MS,
      maxSockets: env.UD_S3_CONCURRENCY,
      allowPrivate: env.UD_ALLOW_PRIVATE_ENDPOINTS,
      allowedEndpoints: env.UD_ALLOWED_ENDPOINTS,
    }),
    oidc: new OidcClient(config.oidc!, { allowInsecure }),
    audit: new AuditLog(db, env.UD_IP_MODE, key, clock),
    sessions: new SessionStore(db, key, clock),
    users: new UserStore(db, clock),
    usage: new UsageStore(db, clock),
    clock,
    termsMarkdown,
    refreshMs: env.UD_OIDC_REFRESH_SECONDS * 1000,
    refreshing: new Map(),
  };
  return runtime;
}

function isLoopbackIssuer(issuer: string): boolean {
  const host = new URL(issuer).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Conditions actives : une version et un texte (fichier ou URL) sont configurés. */
export function termsActive(rt: InstanceRuntime): boolean {
  return rt.config.legal.termsVersion !== null && (rt.termsMarkdown !== null || rt.config.legal.termsUrl !== null);
}

export function termsRequired(rt: InstanceRuntime, user: UserRow): boolean {
  return termsActive(rt) && user.terms_version !== rt.config.legal.termsVersion;
}

export function grantsFor(rt: InstanceRuntime, roles: string[], user: UserRow): Grants {
  return computeGrants(rt.config, roles, user.quota_override);
}

export function actorOf(userId: string): string {
  return `user:${userId}`;
}

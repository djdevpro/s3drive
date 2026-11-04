import { CSRF_HEADER_VALUE, INSTANCE_REASONS, requiresCsrfHeader } from '@ud/contracts';
import type { Context, MiddlewareHandler } from 'hono';
import { apiError } from '../errors.js';
import { isSecureOrigin, publicOrigin } from '../request.js';
import { extractProviderRoles, mapDriveRoles } from './grants.js';
import { OidcGrantError } from './oidc.js';
import { type InstanceEnv, type InstanceRuntime, type RefreshOutcome, grantsFor, termsRequired } from './runtime.js';
import { type ActiveSession, openToken, readSessionCookie, sessionCookie, sessionRoles } from './session.js';
import type { UserRow } from './users.js';

// Résolution du principal `user`, CSRF, conditions.

/** Au-delà de l'échéance de rafraîchissement, l'instantané des rôles reste valable 15 min si le fournisseur est injoignable. */
const IDP_GRACE_MS = 15 * 60 * 1000;

export function isSecureRequest(c: Context, rt: InstanceRuntime): boolean {
  return isSecureOrigin(publicOrigin(c, rt.requestEnv));
}

/** Contrôles anti-CSRF des requêtes authentifiées par cookie. */
export function checkCsrf(c: Context, rt: InstanceRuntime): void {
  const method = c.req.method.toUpperCase();
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    const navigate = method === 'GET' && c.req.header('sec-fetch-mode') === 'navigate' && !['object', 'embed'].includes(c.req.header('sec-fetch-dest') ?? '');
    if (!navigate) throw apiError('csrf', 'Cross-site request refused', { reason: 'cross_site' });
  }
  if (!requiresCsrfHeader(method)) return;
  if (c.req.header('x-ud') !== CSRF_HEADER_VALUE) throw apiError('csrf', 'Missing X-UD header', { reason: 'missing_header' });
  const origin = c.req.header('origin');
  if (origin && origin !== 'null') {
    if (origin !== publicOrigin(c, rt.requestEnv)) throw apiError('csrf', 'Origin mismatch', { reason: 'origin_mismatch' });
  } else if (site !== 'same-origin') {
    throw apiError('csrf', 'Origin mismatch', { reason: 'origin_mismatch' });
  }
  const length = Number(c.req.header('content-length') ?? '0');
  const hasBody = length > 0 || c.req.header('transfer-encoding') !== undefined;
  if (hasBody) {
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json' && type !== 'application/merge-patch+json') {
      throw apiError('csrf', 'Unsupported content type', { reason: 'content_type' });
    }
  }
}

/** Session et personne de la requête, sans rafraîchissement (déconnexion). */
export function currentSession(c: Context, rt: InstanceRuntime): { session: ActiveSession; user: UserRow } | null {
  const cookie = readSessionCookie(c.req.header('cookie'), isSecureRequest(c, rt));
  if (!cookie) return null;
  const session = rt.sessions.find(cookie);
  if (!session || !session.row.user_id) return null;
  const user = rt.users.get(session.row.user_id);
  if (!user) return null;
  return { session, user };
}

async function refreshRoles(rt: InstanceRuntime, session: ActiveSession, user: UserRow): Promise<RefreshOutcome> {
  const refreshToken = openToken(rt.key, session, 'refresh', session.row.refresh_enc);
  if (!refreshToken) return { kind: 'ended' };
  try {
    const identity = await rt.oidc.refresh(refreshToken, user.subject);
    const providerRoles = extractProviderRoles([identity.claims, identity.userinfo], rt.config.oidc!.roleClaims);
    const roles = mapDriveRoles(rt.config, providerRoles);
    if (roles.length === 0) return { kind: 'ended' };
    rt.sessions.updateRoles(session, roles, identity.refreshToken, identity.idToken);
    rt.users.updateRolesCache(user.id, roles);
    return { kind: 'ok', roles };
  } catch (err) {
    if (err instanceof OidcGrantError) return { kind: 'ended' };
    return { kind: 'unavailable' };
  }
}

/** Rôles Drive à jour ; lève 401 `session_ended` ou `idp_unreachable`. */
async function freshRoles(c: Context, rt: InstanceRuntime, session: ActiveSession, user: UserRow): Promise<string[]> {
  const now = rt.clock();
  const age = now - (session.row.roles_at ?? 0);
  if (age < rt.refreshMs) return sessionRoles(session.row);
  let pending = rt.refreshing.get(session.row.id);
  if (!pending) {
    pending = refreshRoles(rt, session, user).finally(() => rt.refreshing.delete(session.row.id));
    rt.refreshing.set(session.row.id, pending);
  }
  const outcome = await pending;
  if (outcome.kind === 'ok') return outcome.roles;
  if (outcome.kind === 'ended') {
    rt.sessions.delete(session.row.id);
    rt.audit.write({
      connectionId: rt.config.connection,
      source: 'system',
      actor: 'system',
      action: 'auth.session_end',
      details: { userId: user.id, reason: INSTANCE_REASONS.sessionEnded },
    });
    c.header('Set-Cookie', sessionCookie(isSecureRequest(c, rt), '', 0));
    throw apiError('unauthorized', 'Session ended by the identity provider', { reason: INSTANCE_REASONS.sessionEnded });
  }
  if (age > rt.refreshMs + IDP_GRACE_MS) {
    throw apiError('unauthorized', 'Identity provider unreachable', { reason: INSTANCE_REASONS.idpUnreachable, retryable: true });
  }
  return sessionRoles(session.row);
}

export interface RequireUserOptions {
  /** Route accessible avant l'acceptation des conditions. */
  beforeTerms?: boolean;
}

export function requireUser(rt: InstanceRuntime, options: RequireUserOptions = {}): MiddlewareHandler<InstanceEnv> {
  return async (c, next) => {
    const secure = isSecureRequest(c, rt);
    const cookie = readSessionCookie(c.req.header('cookie'), secure);
    if (!cookie) throw apiError('unauthorized', 'Authentication required');
    const session = rt.sessions.find(cookie);
    if (!session || !session.row.user_id) throw apiError('unauthorized', 'Authentication required');
    checkCsrf(c, rt);
    const user = rt.users.get(session.row.user_id);
    if (!user) {
      rt.sessions.delete(session.row.id);
      throw apiError('unauthorized', 'Authentication required');
    }
    if (user.status !== 'active') {
      rt.sessions.deleteForUser(user.id);
      throw apiError('unauthorized', 'Account suspended', { reason: INSTANCE_REASONS.suspended });
    }
    const roles = await freshRoles(c, rt, session, user);
    const extended = rt.sessions.touch(session);
    if (extended !== null) {
      c.header('Set-Cookie', sessionCookie(secure, `${session.row.id}.${session.secret}`, (extended - rt.clock()) / 1000));
    }
    if (!options.beforeTerms && termsRequired(rt, user)) {
      throw apiError('forbidden', 'Terms of use must be accepted', { reason: INSTANCE_REASONS.termsRequired });
    }
    c.set('session', session);
    c.set('user', user);
    c.set('principal', {
      kind: 'user',
      userId: user.id,
      sessionId: session.row.id,
      via: 'oidc',
      roles,
      grants: grantsFor(rt, roles, user),
    });
    c.header('Cache-Control', 'no-store');
    await next();
  };
}

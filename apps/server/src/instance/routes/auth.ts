import { INSTANCE_REASONS, type InstanceInfo, type LoginError } from '@ud/contracts';
import type { Context, Hono } from 'hono';
import { deriveKey, open, seal } from '../../crypto.js';
import { clientIp, publicBase, userAgent } from '../../request.js';
import { checkCsrf, currentSession, isSecureRequest } from '../auth.js';
import { extractProviderRoles, mapDriveRoles } from '../grants.js';
import { OidcLoginError, OidcUnavailableError, type LoginTransaction } from '../oidc.js';
import { type InstanceRuntime, actorOf } from '../runtime.js';
import { clearSessionCookie, openToken, sessionCookie } from '../session.js';

// Connexion OIDC et déconnexion, description publique de l'instance.

const TX_TTL_MS = 10 * 60 * 1000;
const TX_COOKIE = { secure: '__Host-ud_oidc', dev: 'ud_oidc' } as const;
const CALLBACK_PATH = '/api/v1/auth/oidc/callback';

interface StoredTransaction extends LoginTransaction {
  next: string;
  exp: number;
}

/** `next` : chemin de l'appli commençant par `/` et pas par `//`. */
export function safeNext(value: string | undefined | null): string {
  if (!value || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return '/';
  return value;
}

function txCookieName(secure: boolean): string {
  return secure ? TX_COOKIE.secure : TX_COOKIE.dev;
}

function txKey(rt: InstanceRuntime): Buffer {
  return deriveKey(rt.key, 'ud-oidc-tx');
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const values = header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(`${name}=`))
    .map((p) => p.slice(name.length + 1));
  return values.length === 1 ? values[0]! : null;
}

function cookieHeader(name: string, value: string, maxAge: number, secure: boolean): string {
  const attrs = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function redirectUri(c: Context, rt: InstanceRuntime): string {
  return `${publicBase(c, rt.requestEnv)}${CALLBACK_PATH}`;
}

function loginRedirect(c: Context, error: LoginError): Response {
  c.header('Cache-Control', 'no-store');
  return c.redirect(`/login?error=${error}`, 302);
}

export function instanceInfo(rt: InstanceRuntime): InstanceInfo {
  return {
    mode: rt.mode,
    connection: rt.config.connection,
    name: rt.config.name,
    login: rt.config.oidc ? { label: rt.config.oidc.label } : null,
    personal: rt.mode === 'both',
  };
}

export function registerAuthRoutes(app: Hono, rt: InstanceRuntime): void {
  app.get('/api/v1/instance', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(instanceInfo(rt));
  });

  app.get('/api/v1/auth/oidc/login', async (c) => {
    const secure = isSecureRequest(c, rt);
    const next = safeNext(c.req.query('next'));
    let start: Awaited<ReturnType<typeof rt.oidc.startLogin>>;
    try {
      start = await rt.oidc.startLogin(redirectUri(c, rt));
    } catch (err) {
      return loginRedirect(c, err instanceof OidcUnavailableError ? 'idp_unreachable' : 'oidc_error');
    }
    const stored: StoredTransaction = { ...start.tx, next, exp: rt.clock() + TX_TTL_MS };
    const value = seal(txKey(rt), rt.key.kid, JSON.stringify(stored), 'v1|ud-oidc-tx');
    c.header('Set-Cookie', cookieHeader(txCookieName(secure), value, TX_TTL_MS / 1000, secure));
    c.header('Cache-Control', 'no-store');
    return c.redirect(start.url, 302);
  });

  app.get('/api/v1/auth/oidc/callback', async (c) => {
    const secure = isSecureRequest(c, rt);
    const name = txCookieName(secure);
    // La transaction ne sert qu'une fois.
    c.header('Set-Cookie', cookieHeader(name, '', 0, secure), { append: true });
    const raw = readCookie(c.req.header('cookie'), name);
    const plain = raw ? open(txKey(rt), rt.key.kid, raw, 'v1|ud-oidc-tx') : null;
    let tx: StoredTransaction | null = null;
    try {
      tx = plain ? (JSON.parse(plain) as StoredTransaction) : null;
    } catch {
      tx = null;
    }
    if (!tx || tx.exp < rt.clock()) return loginRedirect(c, 'oidc_error');
    if (c.req.query('error')) return loginRedirect(c, 'oidc_error');

    const current = new URL(redirectUri(c, rt));
    current.search = new URL(c.req.url).search;
    let identity: Awaited<ReturnType<typeof rt.oidc.finishLogin>>;
    try {
      identity = await rt.oidc.finishLogin(current, tx);
    } catch (err) {
      if (err instanceof OidcUnavailableError) return loginRedirect(c, 'idp_unreachable');
      console.warn('OIDC login failed', { kind: err instanceof OidcLoginError ? err.kind : 'unknown' });
      return loginRedirect(c, 'oidc_error');
    }

    const oidc = rt.config.oidc!;
    const claims = { ...identity.userinfo, ...identity.claims };
    const subject = String(identity.claims['sub']);
    const issuer = typeof identity.claims['iss'] === 'string' ? identity.claims['iss'] : oidc.issuer;
    const email = typeof claims['email'] === 'string' ? claims['email'] : null;
    const displayName =
      typeof claims['name'] === 'string' ? claims['name'] : typeof claims['preferred_username'] === 'string' ? claims['preferred_username'] : null;
    const roles = mapDriveRoles(rt.config, extractProviderRoles([identity.claims, identity.userinfo], oidc.roleClaims));
    const ip = clientIp(c, rt.requestEnv);

    if (roles.length === 0) {
      rt.audit.write({ connectionId: rt.config.connection, source: 'web', actor: 'system', action: 'auth.login_refuse', details: { reason: INSTANCE_REASONS.noRole }, ip });
      return loginRedirect(c, 'no_role');
    }
    let user = rt.users.findBySubject(issuer, subject);
    if (user?.status === 'suspended') {
      rt.audit.write({ connectionId: rt.config.connection, source: 'web', actor: actorOf(user.id), action: 'auth.login_refuse', details: { reason: INSTANCE_REASONS.suspended }, ip });
      return loginRedirect(c, 'suspended');
    }
    if (user) rt.users.recordLogin(user.id, { email, name: displayName, roles });
    else user = rt.users.create({ issuer, subject, email, name: displayName, roles });

    // Anti-fixation : une session déjà présente dans ce navigateur est remplacée.
    const previous = currentSession(c, rt);
    if (previous) rt.sessions.delete(previous.session.row.id);

    const created = rt.sessions.create({
      userId: user.id,
      roles,
      refreshToken: identity.refreshToken,
      idToken: identity.idToken,
      userAgent: userAgent(c),
      ip,
    });
    rt.audit.write({ connectionId: rt.config.connection, source: 'web', actor: actorOf(user.id), action: 'auth.login', details: { roles }, ip });
    c.header('Set-Cookie', sessionCookie(secure, created.cookieValue, (created.expiresAt - rt.clock()) / 1000), { append: true });
    c.header('Cache-Control', 'no-store');
    return c.redirect(tx.next, 302);
  });

  app.post('/api/v1/auth/logout', async (c) => {
    const secure = isSecureRequest(c, rt);
    c.header('Cache-Control', 'no-store');
    const found = currentSession(c, rt);
    if (!found) {
      c.header('Set-Cookie', clearSessionCookie(secure));
      return c.json({ endSessionUrl: null });
    }
    checkCsrf(c, rt);
    const idToken = openToken(rt.key, found.session, 'id_token', found.session.row.id_token_enc);
    rt.sessions.delete(found.session.row.id);
    rt.audit.write({
      connectionId: rt.config.connection,
      source: 'web',
      actor: actorOf(found.user.id),
      action: 'auth.logout',
      ip: clientIp(c, rt.requestEnv),
    });
    c.header('Set-Cookie', clearSessionCookie(secure));
    const endSessionUrl = await rt.oidc.endSessionUrl(idToken, `${publicBase(c, rt.requestEnv)}/login`);
    return c.json({ endSessionUrl });
  });
}


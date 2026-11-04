import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { type JWK, SignJWT, exportJWK, generateKeyPair } from 'jose';

// Faux fournisseur OpenID Connect pour les tests (Hono + jose, port aléatoire) : découverte, JWKS,
// authorize (renvoie un code), token (code + PKCE, refresh_token), userinfo, end_session.
// Les personnes et leurs rôles sont réglables par test.

export interface FakeUser {
  sub: string;
  email?: string;
  name?: string;
  /** Rôles du client (resource_access.<clientId>.roles). */
  roles: string[];
  /** Désactivée : le rafraîchissement répond invalid_grant. */
  disabled?: boolean;
}

interface CodeGrant {
  sub: string;
  clientId: string;
  redirectUri: string;
  nonce?: string;
  challenge: string;
}

export interface FakeOidcOptions {
  clientId: string;
  clientSecret: string;
}

export class FakeOidc {
  readonly users = new Map<string, FakeUser>();
  /** Personne qui « se connecte » à la prochaine autorisation. */
  currentSub: string | null = null;
  /** Fournisseur en panne (503 sur token et userinfo). */
  down = false;
  /** Le jeton d'identité porte les rôles (sinon seulement userinfo). */
  rolesInIdToken = true;
  readonly tokenRequests: Array<Record<string, string>> = [];
  issuer = '';

  private server: ServerType | null = null;
  private privateKey!: CryptoKey;
  private jwk!: JWK;
  private readonly codes = new Map<string, CodeGrant>();
  private readonly accessTokens = new Map<string, string>();
  private readonly refreshTokens = new Map<string, string>();

  constructor(readonly options: FakeOidcOptions) {}

  addUser(user: FakeUser): void {
    this.users.set(user.sub, user);
  }

  setRoles(sub: string, roles: string[]): void {
    this.users.get(sub)!.roles = roles;
  }

  async start(): Promise<string> {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    this.privateKey = privateKey;
    this.jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const app = this.routes();
    await new Promise<void>((resolve) => {
      this.server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve());
    });
    const port = (this.server!.address() as AddressInfo).port;
    this.issuer = `http://127.0.0.1:${port}/realms/test`;
    return this.issuer;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private claimsFor(user: FakeUser): Record<string, unknown> {
    return {
      sub: user.sub,
      email: user.email,
      name: user.name,
      preferred_username: user.sub,
      resource_access: { [this.options.clientId]: { roles: user.roles } },
    };
  }

  private async idToken(user: FakeUser, nonce?: string): Promise<string> {
    const claims = this.claimsFor(user);
    if (!this.rolesInIdToken) delete claims['resource_access'];
    return new SignJWT({ ...claims, ...(nonce ? { nonce } : {}) })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(this.issuer)
      .setAudience(this.options.clientId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.privateKey);
  }

  private async issue(user: FakeUser, nonce?: string): Promise<Record<string, unknown>> {
    const accessToken = randomBytes(16).toString('hex');
    const refreshToken = randomBytes(16).toString('hex');
    this.accessTokens.set(accessToken, user.sub);
    this.refreshTokens.set(refreshToken, user.sub);
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: refreshToken,
      id_token: await this.idToken(user, nonce),
      scope: 'openid profile email',
    };
  }

  private routes(): Hono {
    const app = new Hono();
    const base = '/realms/test';
    app.get(`${base}/.well-known/openid-configuration`, (c) =>
      c.json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${this.issuer}/protocol/openid-connect/token`,
        userinfo_endpoint: `${this.issuer}/protocol/openid-connect/userinfo`,
        end_session_endpoint: `${this.issuer}/protocol/openid-connect/logout`,
        jwks_uri: `${this.issuer}/protocol/openid-connect/certs`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      }),
    );
    app.get(`${base}/protocol/openid-connect/certs`, (c) => c.json({ keys: [this.jwk] }));

    app.get(`${base}/protocol/openid-connect/auth`, (c) => {
      const q = c.req.query();
      if (q['client_id'] !== this.options.clientId || q['response_type'] !== 'code' || q['code_challenge_method'] !== 'S256' || !q['code_challenge'] || !q['state']) {
        return c.text('bad authorization request', 400);
      }
      if (!this.currentSub || !this.users.has(this.currentSub)) return c.text('no user', 400);
      const code = randomBytes(16).toString('hex');
      this.codes.set(code, { sub: this.currentSub, clientId: q['client_id']!, redirectUri: q['redirect_uri']!, challenge: q['code_challenge']!, ...(q['nonce'] ? { nonce: q['nonce'] } : {}) });
      const target = new URL(q['redirect_uri']!);
      target.searchParams.set('code', code);
      target.searchParams.set('state', q['state']!);
      return c.redirect(target.href, 302);
    });

    app.post(`${base}/protocol/openid-connect/token`, async (c) => {
      if (this.down) return c.text('unavailable', 503);
      const form = Object.fromEntries(new URLSearchParams(await c.req.text()));
      this.tokenRequests.push(form);
      if (form['client_id'] !== this.options.clientId || form['client_secret'] !== this.options.clientSecret) {
        return c.json({ error: 'invalid_client' }, 401);
      }
      if (form['grant_type'] === 'authorization_code') {
        const grant = this.codes.get(form['code'] ?? '');
        this.codes.delete(form['code'] ?? '');
        if (!grant || grant.redirectUri !== form['redirect_uri']) return c.json({ error: 'invalid_grant' }, 400);
        const challenge = createHash('sha256').update(form['code_verifier'] ?? '').digest('base64url');
        if (challenge !== grant.challenge) return c.json({ error: 'invalid_grant', error_description: 'PKCE' }, 400);
        return c.json(await this.issue(this.users.get(grant.sub)!, grant.nonce));
      }
      if (form['grant_type'] === 'refresh_token') {
        const sub = this.refreshTokens.get(form['refresh_token'] ?? '');
        const user = sub ? this.users.get(sub) : undefined;
        if (!user || user.disabled) return c.json({ error: 'invalid_grant' }, 400);
        this.refreshTokens.delete(form['refresh_token']!);
        return c.json(await this.issue(user));
      }
      return c.json({ error: 'unsupported_grant_type' }, 400);
    });

    app.get(`${base}/protocol/openid-connect/userinfo`, (c) => {
      if (this.down) return c.text('unavailable', 503);
      const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
      const sub = token ? this.accessTokens.get(token) : undefined;
      if (!sub) return c.json({ error: 'invalid_token' }, 401);
      return c.json(this.claimsFor(this.users.get(sub)!));
    });

    app.get(`${base}/protocol/openid-connect/logout`, (c) => c.text('logged out'));
    return app;
  }
}

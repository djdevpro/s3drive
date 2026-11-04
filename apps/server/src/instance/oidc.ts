import * as client from 'openid-client';
import type { OidcConfig } from './config.js';

// Connexion OpenID Connect avec openid-client v6 :
// code + PKCE S256, state, nonce, client confidentiel. La découverte est paresseuse et réessayée :
// le serveur démarre même si le fournisseur est injoignable.

/** Refus définitif du fournisseur (`invalid_grant` : personne désactivée, session révoquée). */
export class OidcGrantError extends Error {
  constructor() {
    super('OIDC grant rejected');
    this.name = 'OidcGrantError';
  }
}

/** Fournisseur injoignable ou réponse inexploitable (réessayable). */
export class OidcUnavailableError extends Error {
  constructor() {
    super('OIDC provider unavailable');
    this.name = 'OidcUnavailableError';
  }
}

/** Échec de la connexion elle-même (state, nonce, code refusé…). */
export class OidcLoginError extends Error {
  constructor(readonly kind: string) {
    super(`OIDC login failed: ${kind}`);
    this.name = 'OidcLoginError';
  }
}

export interface LoginTransaction {
  verifier: string;
  state: string;
  nonce: string;
}

export interface OidcIdentity {
  /** Revendications du jeton d'identité (vérifiées par openid-client). */
  claims: Record<string, unknown>;
  /** Réponse de userinfo (sujet vérifié). */
  userinfo: Record<string, unknown>;
  idToken: string | null;
  refreshToken: string | null;
}

const DISCOVERY_RETRY_MS = 10_000;

export class OidcClient {
  private configPromise: Promise<client.Configuration> | null = null;
  private lastFailureAt = 0;

  constructor(
    readonly config: OidcConfig,
    private readonly options: { allowInsecure: boolean; timeoutSeconds?: number } = { allowInsecure: false },
  ) {}

  /** Configuration découverte ; un échec est mis de côté 10 s puis retenté. */
  async configuration(): Promise<client.Configuration> {
    if (this.configPromise) return this.configPromise;
    if (Date.now() - this.lastFailureAt < DISCOVERY_RETRY_MS) throw new OidcUnavailableError();
    const promise = client
      .discovery(
        new URL(this.config.issuer),
        this.config.clientId,
        { client_secret: this.config.clientSecret },
        client.ClientSecretPost(this.config.clientSecret),
        {
          timeout: this.options.timeoutSeconds ?? 10,
          ...(this.options.allowInsecure ? { execute: [client.allowInsecureRequests] } : {}),
        },
      )
      .then((cfg) => {
        cfg.timeout = this.options.timeoutSeconds ?? 10;
        return cfg;
      })
      .catch((err: unknown) => {
        this.configPromise = null;
        this.lastFailureAt = Date.now();
        console.warn('OIDC discovery failed', { issuer: this.config.issuer, name: err instanceof Error ? err.name : 'unknown' });
        throw new OidcUnavailableError();
      });
    this.configPromise = promise;
    return promise;
  }

  async startLogin(redirectUri: string): Promise<{ url: string; tx: LoginTransaction }> {
    const cfg = await this.configuration();
    const verifier = client.randomPKCECodeVerifier();
    const challenge = await client.calculatePKCECodeChallenge(verifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      response_type: 'code',
    });
    return { url: url.href, tx: { verifier, state, nonce } };
  }

  async finishLogin(callbackUrl: URL, tx: LoginTransaction): Promise<OidcIdentity> {
    const cfg = await this.configuration();
    let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
    try {
      tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: tx.verifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      });
    } catch (err) {
      throw classifyLoginError(err);
    }
    return this.identity(cfg, tokens, null);
  }

  /** Rafraîchit les jetons et relit userinfo ; `expectedSubject` = sujet de la personne. */
  async refresh(refreshToken: string, expectedSubject: string): Promise<OidcIdentity> {
    const cfg = await this.configuration();
    let tokens: Awaited<ReturnType<typeof client.refreshTokenGrant>>;
    try {
      tokens = await client.refreshTokenGrant(cfg, refreshToken);
    } catch (err) {
      if (err instanceof client.ResponseBodyError && err.error === 'invalid_grant') throw new OidcGrantError();
      throw new OidcUnavailableError();
    }
    const identity = await this.identity(cfg, tokens, expectedSubject);
    // Sans nouveau jeton de rafraîchissement, l'ancien reste valable (rotation facultative).
    return { ...identity, refreshToken: identity.refreshToken ?? refreshToken };
  }

  private async identity(
    cfg: client.Configuration,
    tokens: Awaited<ReturnType<typeof client.refreshTokenGrant>>,
    expectedSubject: string | null,
  ): Promise<OidcIdentity> {
    const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
    const subject = typeof claims['sub'] === 'string' ? claims['sub'] : expectedSubject;
    if (!subject) throw new OidcLoginError('missing_subject');
    if (expectedSubject && subject !== expectedSubject) throw new OidcGrantError();
    let userinfo: Record<string, unknown> = {};
    try {
      userinfo = (await client.fetchUserInfo(cfg, tokens.access_token, subject)) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof client.ResponseBodyError && err.status === 401) throw new OidcGrantError();
      throw new OidcUnavailableError();
    }
    return {
      claims: { ...claims, sub: subject },
      userinfo,
      idToken: tokens.id_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
    };
  }

  /** URL de déconnexion du fournisseur (RP-Initiated Logout), ou `null` s'il n'en propose pas. */
  async endSessionUrl(idToken: string | null, postLogoutRedirectUri: string): Promise<string | null> {
    let cfg: client.Configuration;
    try {
      cfg = await this.configuration();
    } catch {
      return null;
    }
    if (!cfg.serverMetadata().end_session_endpoint) return null;
    const params: Record<string, string> = { post_logout_redirect_uri: postLogoutRedirectUri, client_id: this.config.clientId };
    if (idToken) params['id_token_hint'] = idToken;
    return client.buildEndSessionUrl(cfg, params).href;
  }
}

function classifyLoginError(err: unknown): Error {
  if (err instanceof OidcUnavailableError) return err;
  if (err instanceof client.ResponseBodyError) return new OidcLoginError(err.error);
  if (err instanceof client.AuthorizationResponseError) return new OidcLoginError(err.error);
  if (err instanceof TypeError || (err instanceof Error && /fetch|ECONN|timeout|abort/i.test(err.message))) {
    return new OidcUnavailableError();
  }
  return new OidcLoginError(err instanceof Error ? err.name : 'unknown');
}

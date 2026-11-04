import type { AnyRouter } from '@tanstack/react-router';
import { INSTANCE_REASONS, LOGIN_ERRORS, type LoginError } from '@ud/contracts';
import { createDriveClient, DriveApiError, type DriveClient } from '@ud/sdk';
import { createContext, createElement, useContext, type ReactNode } from 'react';

// Client de l'API pour le front : un seul `DriveClient` par appli, partagé par le contexte
// React et par le contexte du routeur. Les refus d'authentification renvoient vers /login ou /terms
// en gardant l'URL demandée.

export { DriveApiError, type DriveClient };

const DriveClientContext = createContext<DriveClient | null>(null);

export function DriveClientProvider({ client, children }: { client: DriveClient; children: ReactNode }) {
  return createElement(DriveClientContext.Provider, { value: client }, children);
}

export function useDriveClient(): DriveClient {
  const client = useContext(DriveClientContext);
  if (!client) throw new Error('useDriveClient() needs a <DriveClientProvider>');
  return client;
}

/** `next` admis : chemin de l'appli commençant par `/` et pas par `//` (comme le serveur). */
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value || value.length > 2048) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  return value;
}

const isAuthPage = (href: string) => /^\/(login|terms)(?:[/?#]|$)/.test(href);

function isLoginError(value: string | undefined): value is LoginError {
  return value !== undefined && (LOGIN_ERRORS as readonly string[]).includes(value);
}

/** Page de connexion avec le motif du refus et l'URL à retrouver après la connexion. */
export function loginPageHref(options: { reason?: string | undefined; next?: string | undefined } = {}): string {
  const params = new URLSearchParams();
  if (isLoginError(options.reason)) params.set('error', options.reason);
  const next = options.next && !isAuthPage(options.next) ? safeNext(options.next, '') : '';
  if (next && next !== '/') params.set('next', next);
  const qs = params.toString();
  return qs ? `/login?${qs}` : '/login';
}

/** Page des conditions d'utilisation, puis retour à `next`. */
export function termsPageHref(next?: string): string {
  const target = next && !isAuthPage(next) ? safeNext(next, '') : '';
  return target && target !== '/' ? `/terms?next=${encodeURIComponent(target)}` : '/terms';
}

/** Vrai pour un refus qui exige d'accepter les conditions (403 `forbidden` + `terms_required`). */
export function isTermsRequired(error: unknown): boolean {
  return error instanceof DriveApiError && error.code === 'forbidden' && error.reason === INSTANCE_REASONS.termsRequired;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof DriveApiError && (error.code === 'unauthorized' || error.code === 'local.gate_expired');
}

export interface AuthRedirects {
  /** URL courante (chemin et recherche, tels que dans la barre d'adresse). */
  currentHref(): string;
  /** Navigation de l'appli (remplace l'entrée d'historique). */
  navigate(href: string): void;
  /** Passerelle d'accès expirée : « Session expirée · Se reconnecter ». */
  onGateExpired?(): void;
}

export interface AppDriveClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Client de l'appli : 401 → /login?error=…&next=…, 403 `terms_required` → /terms?next=… */
export function createAppDriveClient(redirects: AuthRedirects, options: AppDriveClientOptions = {}): DriveClient {
  const base = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const wrapped: typeof fetch = async (input, init) => {
    const response = await base(input, init);
    if (response.status === 403) {
      // Le corps reste lisible par le client : on lit une copie.
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { details?: { reason?: unknown } } | null;
      const current = redirects.currentHref();
      if (body?.details?.reason === INSTANCE_REASONS.termsRequired && !isAuthPage(current)) redirects.navigate(termsPageHref(current));
    }
    return response;
  };
  return createDriveClient({
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    fetch: wrapped,
    onUnauthorized: (reason) => {
      const current = redirects.currentHref();
      if (current.startsWith('/login')) return;
      redirects.navigate(loginPageHref({ reason, next: current }));
    },
    onGateExpired: () => redirects.onGateExpired?.(),
  });
}

/** Redirections portées par le routeur ; `getRouter` est lu à chaque appel (routeur créé après le client). */
export function routerRedirects(getRouter: () => AnyRouter | undefined, onGateExpired?: () => void): AuthRedirects {
  return {
    currentHref: () => {
      const location = getRouter()?.history.location;
      return location ? `${location.pathname}${location.search}` : '/';
    },
    navigate: (href) => {
      void getRouter()?.navigate({ href, replace: true });
    },
    ...(onGateExpired ? { onGateExpired } : {}),
  };
}

/** Reconnexion après une passerelle expirée : navigation réseau vers l'URL courante avec `reauth=1`. */
export function reauthHref(current: string): string {
  const url = new URL(current, 'http://ud.invalid');
  url.searchParams.set('reauth', '1');
  return `${url.pathname}${url.search}`;
}

/** Rejeu des requêtes : jamais pour un refus (4xx) ou une passerelle expirée ; deux fois sinon. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof DriveApiError) {
    if (error.code === 'local.gate_expired' || error.code === 'local.invalid_response') return false;
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 2;
}

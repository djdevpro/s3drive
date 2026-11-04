// Outils des tests du mode instance : API du navigateur absentes de jsdom, faux serveur /api/v1,
// montage de l'appli complète (routeur, client de l'appli avec ses redirections, i18n).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { AdminUser, InstanceInfo, MeResponse, TermsResponse } from '@ud/contracts';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from '../src/i18n';
import { createAppDriveClient, routerRedirects } from '../src/lib/api/client';
import { type AppRouter, createAppRouter } from '../src/router';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

export function installDomStubs(options: { width?: number } = {}): void {
  const width = options.width ?? 1280;
  const g = globalThis as Record<string, unknown>;
  g['ResizeObserver'] ??= ResizeObserverStub;
  g['IS_REACT_ACT_ENVIRONMENT'] = true;
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto['hasPointerCapture'] ??= () => false;
  proto['setPointerCapture'] ??= () => {};
  proto['releasePointerCapture'] ??= () => {};
  proto['scrollIntoView'] ??= () => {};
  window.scrollTo = () => {};
  Element.prototype.scrollTo = () => {};
  // Largeur d'écran simulée pour les requêtes `(min-width: …)` et `(prefers-color-scheme: dark)`.
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

export interface Call {
  method: string;
  path: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = { status: number; body?: unknown };
export type Handler = (call: Call) => Reply | undefined;

export const API = 'http://ud.test';

/** Faux serveur : `routes['GET /api/v1/me']` = réponse ou fonction ; tout le reste répond 404. */
export function fakeServer(routes: Record<string, Reply | Handler>) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const call: Call = {
      method,
      path: url.pathname,
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const route = routes[`${method} ${url.pathname}`];
    const reply = (typeof route === 'function' ? route(call) : route) ?? { status: 404, body: { error: 'not_found', message: 'Not found' } };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch, calls, routes };
}

export function mountApp(url: string, server: ReturnType<typeof fakeServer>, options: { lng?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const i18n = createI18n(options.lng ?? 'fr');
  let router: AppRouter | undefined;
  const driveClient = createAppDriveClient(routerRedirects(() => router), { baseUrl: API, fetch: server.fetch });
  router = createAppRouter({ queryClient, driveClient, history: createMemoryHistory({ initialEntries: [url] }), scrollRestoration: false });
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  const location = () => `${router!.history.location.pathname}${router!.history.location.search}`;
  return { ...view, router, queryClient, i18n, location };
}

// ---------------------------------------------------------------------------
// Données de test

export const instanceInfo: InstanceInfo = { mode: 'instance', connection: 'drive', name: 'Drive de test', login: { label: 'Keycloak (dev)' }, personal: false };

export function meFixture(patch: Partial<MeResponse> = {}): MeResponse {
  return {
    user: { id: 'u1', email: 'alice@ud.test', name: 'Alice Martin', roles: ['user'] },
    connection: 'drive',
    spaces: [
      { id: 'home', label: null, scopes: ['read', 'write', 'delete', 'share'], quota: 1_000_000_000, usage: { bytes: 312_000_000, objects: 3 } },
      { id: 'commun', label: { fr: 'Commun', en: 'Shared' }, scopes: ['read'], quota: 5_000_000_000, usage: { bytes: 0, objects: 0 } },
    ],
    quota: { limit: 1_000_000_000, used: 312_000_000, reserved: 0 },
    links: { public: false, people: true, maxDays: 30 },
    admin: [],
    superAdmin: false,
    terms: { required: false, version: 'v1', url: '/api/v1/me/terms' },
    ...patch,
  };
}

export const termsFixture: TermsResponse = {
  version: 'v1',
  markdown: '# Conditions\n\nEn continuant, vous **acceptez** les règles.\n\n- Premier point\n- Second point\n\n<script>alert(1)</script>\n\n[lien](javascript:alert(1)) et [site](https://example.test)',
  url: null,
  acceptedVersion: null,
};

export function adminUserFixture(patch: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u2',
    email: 'bruno@ud.test',
    name: 'Bruno Petit',
    roles: ['user'],
    status: 'active',
    quota: { limit: 1_000_000_000, used: 2_000_000, reserved: 0, objects: 4 },
    quotaOverride: null,
    termsVersion: 'v1',
    createdAt: '2026-10-01T10:00:00.000Z',
    lastLoginAt: '2026-11-02T10:00:00.000Z',
    ...patch,
  };
}

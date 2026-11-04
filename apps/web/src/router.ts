import type { QueryClient } from '@tanstack/react-query';
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { createDriveClient, type DriveClient } from '@ud/sdk';
import { shieldExplorerPath, unshieldExplorerPath } from './lib/keys/keyCodec';
import { parseSearchStrings, stringifySearchStrings } from './lib/keys/search';
import { routeTree } from './routeTree.gen';

export interface RouterContext {
  queryClient: QueryClient;
  /** Client de l'API, le même que celui du contexte React (DriveClientProvider de la racine). */
  driveClient: DriveClient;
}

export interface CreateAppRouterOptions {
  queryClient: QueryClient;
  /** Défaut : client sans redirections (tests) ; l'appli passe celui de createAppDriveClient. */
  driveClient?: DriveClient;
  /** Historique injecté par les tests (createMemoryHistory) ; navigateur par défaut. */
  history?: RouterHistory;
  /** Les tests jsdom la désactivent (window.scrollTo absent). */
  scrollRestoration?: boolean;
}

// Options du routeur ; composants par défaut (squelette, ErrorState) à venir.
export function createAppRouter({ queryClient, driveClient, history, scrollRestoration = true }: CreateAppRouterOptions) {
  return createRouter({
    routeTree,
    context: { queryClient, driveClient: driveClient ?? createDriveClient() },
    trailingSlash: 'preserve',
    caseSensitive: true,
    defaultPreload: 'intent',
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 150,
    defaultPendingMinMs: 300,
    scrollRestoration,
    scrollRestorationBehavior: 'instant',
    scrollToTopSelectors: ['[data-scroll-restoration-id="explorer"]'],
    parseSearch: parseSearchStrings,
    stringifySearch: stringifySearchStrings,
    search: { strict: false },
    // Chemin brut des URL d'explorateur préservé : voir shieldExplorerPath.
    rewrite: {
      input: ({ url }) => {
        url.pathname = shieldExplorerPath(url.pathname);
        return url;
      },
      output: ({ url }) => {
        url.pathname = unshieldExplorerPath(url.pathname);
        return url;
      },
    },
    ...(history ? { history } : {}),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}

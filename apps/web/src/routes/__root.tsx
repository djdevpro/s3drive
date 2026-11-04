import { Outlet, createRootRouteWithContext, useRouter } from '@tanstack/react-router';
import { DirectionProvider, NavigationProvider, Toaster, TooltipProvider } from '@ud/ui';
import { useTranslation } from 'react-i18next';
import { directionOf } from '../i18n';
import { DriveClientProvider } from '../lib/api/client';
import { navigateHref } from '../lib/keys/ExplorerLink';
import type { RouterContext } from '../router';
import { NotFound } from './-lib/NotFound';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFound,
});

// Fournisseurs de la racine : client de l'API (celui du contexte du routeur), direction de la langue,
// navigation des liens de @ud/ui par le routeur, infobulles et notifications.
function Root() {
  const { driveClient } = Route.useRouteContext();
  const router = useRouter();
  const { i18n } = useTranslation();
  const dir = directionOf(i18n.resolvedLanguage ?? i18n.language ?? 'en');
  return (
    <DriveClientProvider client={driveClient}>
      <DirectionProvider dir={dir}>
        <NavigationProvider onNavigate={(href) => void navigateHref(router, href)}>
          <TooltipProvider>
            <Outlet />
            <Toaster dir={dir} />
          </TooltipProvider>
        </NavigationProvider>
      </DirectionProvider>
    </DriveClientProvider>
  );
}

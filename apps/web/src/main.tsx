import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { initAppearance, toast } from '@ud/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createI18n } from './i18n';
import { createAppDriveClient, reauthHref, routerRedirects, shouldRetry } from './lib/api/client';
import { type AppRouter, createAppRouter } from './router';
import './styles.css';

// Collection et mode mémorisés (porcelaine, mode du système par défaut), suivis en direct.
initAppearance();

const i18n = createI18n();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

// Le client et le routeur se référencent : le routeur est lu à chaque redirection.
let router: AppRouter | undefined;
const redirects = routerRedirects(
  () => router,
  () => {
    const current = window.location.pathname + window.location.search;
    toast({
      id: 'gate-expired',
      tone: 'warning',
      title: i18n.t('common:errors.local.gate_expired'),
      duration: Infinity,
      action: { label: i18n.t('common:actions.reconnect'), onClick: () => window.location.assign(reauthHref(current)) },
    });
  },
);
const driveClient = createAppDriveClient(redirects);
router = createAppRouter({ queryClient, driveClient });

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  </StrictMode>,
);

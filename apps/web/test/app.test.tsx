import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createDriveClient } from '@ud/sdk';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { createI18n, directionOf } from '../src/i18n';
import { createAppRouter } from '../src/router';

afterEach(cleanup);

// Serveur en mode personnel : `/` garde l'accueil des stockages personnels.
const personal: typeof fetch = async () =>
  new Response(JSON.stringify({ mode: 'personal', connection: null, name: 'Universal Drive', login: null, personal: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('app shell', () => {
  it('renders the index route with translated title', async () => {
    const queryClient = new QueryClient();
    const i18n = createI18n('fr');
    const driveClient = createDriveClient({ baseUrl: 'http://ud.test', fetch: personal });
    const router = createAppRouter({ queryClient, driveClient, history: createMemoryHistory({ initialEntries: ['/'] }) });
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty('textContent', 'Universal Drive');
    expect(screen.getByText(/stockage S3/)).toBeTruthy();
  });

  it('updates document lang and dir on language change', async () => {
    const i18n = createI18n('en');
    await act(() => i18n.changeLanguage('en'));
    expect(document.documentElement.lang).toBe('en');
    await act(() => i18n.changeLanguage('fr'));
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');
    await act(() => i18n.changeLanguage('ar'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(directionOf('ar')).toBe('rtl');
  });
});

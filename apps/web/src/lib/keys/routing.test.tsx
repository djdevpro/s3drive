/*
 * Une clé S3 arbitraire passe dans l'URL et revient
 * intacte avec TanStack Router. Navigation réelle (historique en mémoire et historique du
 * navigateur de jsdom), Précédent/Suivant, lien ExplorerLink et router.navigate({ href }).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterContextProvider,
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  type RouterHistory,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import type { DriveClient } from '@ud/sdk';
import { createI18n } from '../../i18n';
import { explorerSearch } from '../../routes/-lib/schemas';
import { createAppRouter } from '../../router';
import { parseSearchStrings } from './search';
import { ExplorerLink, navigateExplorer, navigateHref } from './ExplorerLink';
import { toPath } from './keyCodec';
import { PARSE_VECTORS, ROUND_TRIP_VECTORS } from './vectors';

const CONN = 'Ab3dE6gH9k';
const BASE = `/d/${CONN}/b/bk/`;

afterEach(cleanup);

// jsdom n'implémente pas scrollTo (restauration et remise en haut du défilement du routeur).
window.scrollTo = () => {};
Element.prototype.scrollTo = () => {};

// Client d'API qui ne répond jamais : l'explorateur reste en chargement, sans réseau.
const pendingClient = new Proxy({}, { get: () => () => new Promise(() => {}) }) as DriveClient;

function mount(history: RouterHistory) {
  const queryClient = new QueryClient();
  const router = createAppRouter({ queryClient, history, scrollRestoration: false, driveClient: pendingClient });
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

function mountAt(url: string) {
  return mount(createMemoryHistory({ initialEntries: [url] }));
}

const view = () => document.querySelector('[data-view]')?.getAttribute('data-view');
const param = (name: string) => document.querySelector(`[data-param="${name}"]`)?.textContent;
const href = (history: RouterHistory) => history.location.pathname + history.location.search;

const explorerAttr = (name: string) => document.querySelector(`[data-explorer-${name}]`)?.getAttribute(`data-explorer-${name}`);

async function expectExplorer(kind: string, key: string) {
  await waitFor(() => expect(view()).toBe(`explorer.${kind}`));
  expect(explorerAttr('key')).toBe(key);
}

describe('explorateur : navigation par URL encodée (annexe A)', () => {
  it.each(ROUND_TRIP_VECTORS)('$id : la vue reçoit la clé exacte, URL non réécrite', async ({ key, kind, path }) => {
    const router = mountAt(BASE + path);
    await expectExplorer(kind, key);
    expect(href(router.history)).toBe(BASE + path);
  });

  it.each(PARSE_VECTORS)('$id : entrée saisie à la main', async ({ path, expected }) => {
    const router = mountAt(BASE + path);
    if (expected === 'malformed') {
      await waitFor(() => expect(view()).toBe('malformed'));
    } else {
      await expectExplorer(expected.kind, expected.key);
    }
    // hexadécimal minuscule accepté, URL non réécrite.
    expect(href(router.history)).toBe(BASE + path);
  });

  it('/d/$conn/b/$bucket sans / final redirige vers la racine (replace)', async () => {
    const router = mountAt(`/d/${CONN}/b/bk`);
    await waitFor(() => expect(view()).toBe('explorer.root'));
    expect(router.history.location.pathname).toBe(BASE);
    expect(router.history.length).toBe(1);
  });

  it('valeurs de recherche gardées en chaînes', async () => {
    const router = mountAt(`${BASE}a.txt?version=null&focus=007`);
    await expectExplorer('file', 'a.txt');
    expect(explorerAttr('version')).toBe('null');
    expect(explorerSearch.parse(parseSearchStrings(router.history.location.search))).toMatchObject({ version: 'null', focus: '007' });
    await act(() => router.navigate({ to: '/d/$conn/search', params: { conn: CONN }, search: { q: '1e3' } }));
    await waitFor(() => expect(view()).toBe('search'));
    expect(param('q')).toBe('1e3');
    expect(router.history.location.search).toBe('?q=1e3');
    await act(() => router.navigate({ href: `/d/${CONN}/search?q=2024` }));
    await waitFor(() => expect(param('q')).toBe('2024'));
  });

  it('details=1 → info, details=access → permissions, sort inconnu ignoré', async () => {
    const router = mountAt(`${BASE}?details=1&sort=xyz`);
    await waitFor(() => expect(view()).toBe('explorer.root'));
    const first = explorerSearch.parse(parseSearchStrings(router.history.location.search));
    expect(first.details).toBe('info');
    expect(first.sort).toBeUndefined();
    await act(() => router.navigate({ href: `${BASE}?details=access` }));
    await waitFor(() => expect(explorerSearch.parse(parseSearchStrings(router.history.location.search)).details).toBe('permissions'));
  });
});

describe('explorateur : liens produits par l’appli', () => {
  it('navigateExplorer (router.navigate({ href: toPath() })) conserve le chemin et la clé, Précédent/Suivant compris', async () => {
    const history = createMemoryHistory({ initialEntries: [BASE] });
    const router = mount(history);
    await waitFor(() => expect(view()).toBe('explorer.root'));
    for (const v of ROUND_TRIP_VECTORS) {
      const target = { conn: CONN, bucket: 'bk', key: v.key, kind: v.kind };
      await act(() => navigateExplorer(router, target));
      expect(toPath(target)).toBe(BASE + v.path);
      expect(href(history), v.id).toBe(BASE + v.path);
      await expectExplorer(v.kind, v.key);
    }
    const last = ROUND_TRIP_VECTORS.at(-1)!;
    const previous = ROUND_TRIP_VECTORS.at(-2)!;
    await act(() => history.back());
    await expectExplorer(previous.kind, previous.key);
    expect(href(history)).toBe(BASE + previous.path);
    await act(() => history.forward());
    await expectExplorer(last.kind, last.key);
  });

  it('ExplorerLink : href = toPath() et le clic navigue vers la clé exacte', async () => {
    const history = createMemoryHistory({ initialEntries: [BASE] });
    const router = mount(history);
    await waitFor(() => expect(view()).toBe('explorer.root'));
    for (const v of ROUND_TRIP_VECTORS) {
      const target = { conn: CONN, bucket: 'bk', key: v.key, kind: v.kind };
      const link = render(
        <RouterContextProvider router={router}>
          <ExplorerLink target={target}>{v.id}</ExplorerLink>
        </RouterContextProvider>,
      );
      const anchor = screen.getByText(v.id);
      expect(anchor.getAttribute('href')).toBe(BASE + v.path);
      await act(async () => {
        fireEvent.click(anchor);
      });
      expect(href(history), v.id).toBe(BASE + v.path);
      await expectExplorer(v.kind, v.key);
      link.unmount();
    }
  });

  it('mode (1) écarté : l’encodage du splat par le routeur diffère de toPath()', async () => {
    const router = mountAt(BASE);
    await waitFor(() => expect(view()).toBe('explorer.root'));
    const mismatches = ROUND_TRIP_VECTORS.filter((v) => {
      const built = router.buildLocation({
        to: '/d/$conn/b/$bucket/$',
        params: { conn: CONN, bucket: 'bk', _splat: v.key },
      });
      return built.href !== BASE + v.path;
    }).map((v) => v.id);
    // Au minimum : ~ initial (A7, A8) et toute la forme ~k.
    expect(mismatches).toEqual(expect.arrayContaining(['A7', 'A8', 'A10', 'A11a', 'A12', 'A24', 'A35a']));
  });

  it('historique du navigateur : window.location et router.history.location identiques octet pour octet', async () => {
    window.history.replaceState(null, '', BASE);
    const history = createBrowserHistory();
    const router = mount(history);
    await waitFor(() => expect(view()).toBe('explorer.root'));
    for (const v of ROUND_TRIP_VECTORS) {
      await act(() => navigateHref(router, BASE + v.path));
      expect(window.location.pathname + window.location.search, v.id).toBe(BASE + v.path);
      expect(history.location.pathname).toBe(window.location.pathname);
      expect(history.location.search).toBe(window.location.search);
      await expectExplorer(v.kind, v.key);
    }
    history.destroy();
  });
});

describe('arbre des routes', () => {
  it.each([
    ['/connect?preset=aws', 'connect'],
    ['/connect/device', 'connectDevice'],
    ['/accounts?next=%2Fd%2Fx', 'accounts'],
    [`/d/${CONN}?newBucket=r2`, 'home'],
    [`/d/${CONN}/recent`, 'recent'],
    [`/d/${CONN}/starred`, 'starred'],
    [`/d/${CONN}/shared`, 'shared'],
    [`/d/${CONN}/trash`, 'trash'],
    [`/d/${CONN}/storage`, 'storage'],
    [`/d/${CONN}/search?q=x`, 'search'],
    [`/d/${CONN}/admin/bk/cors`, 'admin'],
    [`/d/${CONN}/access/clients`, 'access'],
    [`/d/${CONN}/jobs?job=j1`, 'jobs'],
    ['/oauth/consent/r1', 'oauthConsent'],
    ['/share-target', 'shareTarget'],
    ['/receive/x1', 'receive'],
    ['/receive/open', 'receiveOpen'],
    ['/nope/x', 'notFound'],
    ['/d/Short/recent', 'malformed'],
  ])('%s → %s', async (url, expected) => {
    mountAt(url);
    await waitFor(() => expect(view()).toBe(expected));
  });

  it.each([
    [`/d/${CONN}/b`, `/d/${CONN}`],
    [`/d/${CONN}/admin/bk`, `/d/${CONN}/admin/bk/overview`],
    [`/d/${CONN}/admin/bk/zzz`, `/d/${CONN}/admin/bk/overview`],
    [`/d/${CONN}/access`, `/d/${CONN}/access/tokens`],
    [`/d/${CONN}/access/zzz`, `/d/${CONN}/access/tokens`],
  ])('redirection %s → %s', async (from, to) => {
    const router = mountAt(from);
    await waitFor(() => expect(router.history.location.pathname).toBe(to));
  });
});

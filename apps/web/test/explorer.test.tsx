/*
 * Explorateur du mode instance en jsdom : route splat réelle (TanStack Router, chemin
 * brut protégé comme dans l'appli), client d'API double, file d'envoi réelle espionnée.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { ListItem, ObjectListPage, SpaceBucket } from '@ud/contracts';
import { DriveApiError, type DriveClient } from '@ud/sdk';
import { TooltipProvider } from '@ud/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerRoute } from '../src/components/explorer/ExplorerRoute';
import { createI18n } from '../src/i18n';
import { DriveClientProvider } from '../src/lib/api/client';
import { shieldExplorerPath, toPath, unshieldExplorerPath } from '../src/lib/keys/keyCodec';
import { parseSearchStrings, stringifySearchStrings } from '../src/lib/keys/search';
import { getUploadQueue, setUploadQueue } from '../src/lib/transfers';
import { DEFAULT_SORT } from '../src/components/explorer/sort';
import { useClipboardStore } from '../src/stores/clipboard';
import { useExplorerPrefs } from '../src/stores/explorerPrefs';
import { useSelectionStore } from '../src/stores/selection';

// jsdom : pas de mise en page. Le virtualiseur lit la taille du conteneur de défilement.
window.scrollTo = () => {};
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
const rect = { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 900, width: 1200, height: 900, toJSON: () => ({}) };
Element.prototype.getBoundingClientRect = () => rect as DOMRect;
for (const [prop, value] of [['offsetHeight', 900], ['offsetWidth', 1200], ['clientHeight', 900], ['clientWidth', 1200]] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
}
globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;

const CONN = 'drive';
const FULL: SpaceBucket['scopes'] = ['read', 'write', 'delete', 'share'];

const file = (key: string, size = 10): ListItem => ({
  kind: 'file',
  key,
  name: key.split('/').pop()!,
  size,
  lastModified: '2026-10-01T10:00:00Z',
  etag: '"e"',
  storageClass: 'STANDARD',
});
const folder = (key: string): ListItem => ({ kind: 'folder', key, name: key.slice(0, -1).split('/').pop()! });

interface Fixture {
  scopes?: SpaceBucket['scopes'];
  folders: Record<string, ListItem[]>;
}

function fakeClient({ scopes = FULL, folders }: Fixture) {
  const spaces: SpaceBucket[] = [
    { name: 'home', kind: 'space', label: null, scopes, quota: null, usage: { bytes: 0, objects: 0 } },
    { name: 'team', kind: 'space', label: { en: 'Team', fr: 'Équipe' }, scopes: FULL, quota: null, usage: { bytes: 0, objects: 0 } },
  ];
  const client = {
    buckets: vi.fn(async () => spaces),
    list: vi.fn(async (_conn: string, _bucket: string, { prefix }: { prefix: string }): Promise<ObjectListPage> => ({
      items: folders[prefix] ?? [],
      nextCursor: null,
      prefix,
      partial: false,
    })),
    object: vi.fn(async (_c: string, bucket: string, key: string) => ({ kind: 'file' as const, bucket, key, name: key.split('/').pop()!, size: 10, lastModified: '2026-10-01T10:00:00Z', etag: '"e"', contentType: 'application/octet-stream', metadata: {} })),
    createFolder: vi.fn(async () => {}),
    rename: vi.fn(async (_c: string, bucket: string, key: string, body: { newName: string }) => ({ bucket, key: key.replace(/[^/]+$/, body.newName), objects: 1 })),
    move: vi.fn(async (_c: string, bucket: string, _k: string, body: { destination: { bucket?: string; key: string } }) => ({ bucket: body.destination.bucket ?? bucket, key: body.destination.key, objects: 1 })),
    copy: vi.fn(async (_c: string, bucket: string, _k: string, body: { destination: { bucket?: string; key: string } }) => ({ bucket: body.destination.bucket ?? bucket, key: body.destination.key, objects: 1 })),
    remove: vi.fn(async () => ({ deleted: 1 })),
    downloadUrl: vi.fn(async () => ({ url: 'https://s3.example.test/presigned', expiresAt: '2026-11-03T12:00:00Z', transport: 'direct' as const })),
  };
  return client;
}

type FakeClient = ReturnType<typeof fakeClient>;

function mount(url: string, client: FakeClient) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const explorerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/d/$conn/b/$bucket/$', component: ExplorerRoute });
  const history = createMemoryHistory({ initialEntries: [url] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([explorerRoute]),
    history,
    trailingSlash: 'preserve',
    caseSensitive: true,
    parseSearch: parseSearchStrings,
    stringifySearch: stringifySearchStrings,
    rewrite: {
      input: ({ url: u }) => {
        u.pathname = shieldExplorerPath(u.pathname);
        return u;
      },
      output: ({ url: u }) => {
        u.pathname = unshieldExplorerPath(u.pathname);
        return u;
      },
    },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <QueryClientProvider client={queryClient}>
        <DriveClientProvider client={client as unknown as DriveClient}>
          <TooltipProvider>
            {/* Routeur de test, distinct du routeur enregistré de l'appli. */}
            <RouterProvider router={router as never} />
          </TooltipProvider>
        </DriveClientProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { router, history, queryClient };
}

const href = (history: { location: { pathname: string; search: string } }) => history.location.pathname + history.location.search;

function itemNode(key: string): HTMLElement {
  for (const node of document.querySelectorAll<HTMLElement>('[data-item-key]')) if (node.dataset['itemKey'] === key) return node;
  throw new Error(`no item ${key}`);
}
const findItem = (key: string) => waitFor(() => itemNode(key));
const isSelected = (key: string) => itemNode(key).getAttribute('aria-selected') === 'true';
const selectedKeys = () => [...document.querySelectorAll<HTMLElement>('[data-item-key][aria-selected="true"]')].map((n) => n.dataset['itemKey']).sort();
const grid = () => document.querySelector<HTMLElement>('[role="grid"]')!;

beforeEach(() => {
  useSelectionStore.setState({ context: null, selected: new Set(), anchor: null, focus: null });
  useClipboardStore.setState({ entry: null });
  useExplorerPrefs.setState({ view: 'list', sort: DEFAULT_SORT });
  try {
    localStorage.clear();
  } catch {
    /* sans stockage */
  }
});
afterEach(() => {
  cleanup();
  setUploadQueue(CONN, null);
});

const DOCS = {
  '': [folder('Docs/'), file('readme.md')],
  'Docs/': [file('Docs/b.txt', 30), folder('Docs/Sub/'), file('Docs/a.txt', 20), file('Docs/c.txt', 10)],
};

describe('liste : tri et sélection', () => {
  it('dossiers d’abord puis tri par nom, sens et colonne dans l’URL', async () => {
    const client = fakeClient({ folders: DOCS });
    const { history } = mount('/d/drive/b/home/Docs/', client);
    await findItem('Docs/a.txt');
    const keys = () => [...document.querySelectorAll<HTMLElement>('[data-item-key]')].map((n) => n.dataset['itemKey']);
    expect(keys()).toEqual(['Docs/Sub/', 'Docs/a.txt', 'Docs/b.txt', 'Docs/c.txt']);
    expect(client.list).toHaveBeenCalledWith('drive', 'home', expect.objectContaining({ prefix: 'Docs/' }));

    // Clic sur l'en-tête Taille : décroissant par défaut, écrit dans l'URL (replace).
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    await waitFor(() => expect(keys()).toEqual(['Docs/Sub/', 'Docs/b.txt', 'Docs/a.txt', 'Docs/c.txt']));
    expect(href(history)).toBe('/d/drive/b/home/Docs/?sort=size');
    expect(screen.getByRole('columnheader', { name: /Size/ }).getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    await waitFor(() => expect(href(history)).toBe('/d/drive/b/home/Docs/?sort=size&dir=asc'));
    expect(keys()).toEqual(['Docs/Sub/', 'Docs/c.txt', 'Docs/a.txt', 'Docs/b.txt']);
  });

  it('clic, Ctrl+clic, Maj+clic, Ctrl+A, Échap', async () => {
    mount('/d/drive/b/home/Docs/', fakeClient({ folders: DOCS }));
    await findItem('Docs/a.txt');
    fireEvent.click(itemNode('Docs/a.txt'));
    expect(selectedKeys()).toEqual(['Docs/a.txt']);
    fireEvent.click(itemNode('Docs/c.txt'), { ctrlKey: true });
    expect(selectedKeys()).toEqual(['Docs/a.txt', 'Docs/c.txt']);
    fireEvent.click(itemNode('Docs/a.txt'), { metaKey: true });
    expect(selectedKeys()).toEqual(['Docs/c.txt']);
    // L'ancre est le dernier élément basculé (a) : plage Sub..a.
    fireEvent.click(itemNode('Docs/Sub/'), { shiftKey: true });
    expect(selectedKeys()).toEqual(['Docs/Sub/', 'Docs/a.txt']);
    fireEvent.click(itemNode('Docs/c.txt'), { shiftKey: true });
    expect(selectedKeys()).toEqual(['Docs/a.txt', 'Docs/b.txt', 'Docs/c.txt']);
    fireEvent.click(itemNode('Docs/b.txt'));
    expect(selectedKeys()).toEqual(['Docs/b.txt']);
    expect(screen.getByRole('toolbar', { name: 'Actions on selection' })).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.keyDown(itemNode('Docs/b.txt'), { key: 'a', ctrlKey: true });
    expect(selectedKeys()).toHaveLength(4);
    fireEvent.keyDown(itemNode('Docs/b.txt'), { key: 'Escape' });
    expect(selectedKeys()).toEqual([]);
    // Flèches : focus et sélection unique.
    fireEvent.click(itemNode('Docs/a.txt'));
    fireEvent.keyDown(grid(), { key: 'ArrowDown' });
    expect(selectedKeys()).toEqual(['Docs/b.txt']);
    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true });
    expect(selectedKeys()).toEqual(['Docs/b.txt', 'Docs/c.txt']);
  });
});

describe('actions selon les permissions de l’espace', () => {
  it('lecture seule : Nouveau désactivé, Renommer et Supprimer désactivés, Copier vers actif', async () => {
    mount('/d/drive/b/home/Docs/', fakeClient({ scopes: ['read'], folders: DOCS }));
    await findItem('Docs/a.txt');
    expect(screen.getAllByText('Read only').length).toBeGreaterThan(0);
    const newButtons = screen.getAllByRole('button', { name: /New/ });
    for (const b of newButtons) expect(b.getAttribute('aria-disabled') ?? b.getAttribute('disabled')).not.toBeNull();
    fireEvent.contextMenu(itemNode('Docs/a.txt'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Rename/ }).getAttribute('data-disabled')).not.toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Delete permanently/ }).getAttribute('data-disabled')).not.toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Copy to/ }).getAttribute('data-disabled')).toBeNull();
    expect(isSelected('Docs/a.txt')).toBe(true);
    // Suppr sans le droit : rien.
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });

  it('droits complets : entrées actives, menu de la zone vide', async () => {
    mount('/d/drive/b/home/Docs/', fakeClient({ folders: DOCS }));
    await findItem('Docs/a.txt');
    fireEvent.contextMenu(itemNode('Docs/a.txt'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Rename/ }).getAttribute('data-disabled')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Delete permanently/ }).getAttribute('data-disabled')).toBeNull();
  });
});

describe('boîtes de dialogue', () => {
  it('Supprimer : alert-dialog définitif, focus sur Annuler, puis suppression', async () => {
    const client = fakeClient({ folders: DOCS });
    mount('/d/drive/b/home/Docs/', client);
    await findItem('Docs/a.txt');
    fireEvent.click(itemNode('Docs/a.txt'));
    fireEvent.keyDown(grid(), { key: 'Delete' });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete “a.txt” permanently?')).toBeTruthy();
    expect(within(dialog).getByText(/can’t be undone/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Cancel'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(client.remove).toHaveBeenCalledWith('drive', 'home', 'Docs/a.txt'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('Supprimer un dossier : « tout son contenu »', async () => {
    mount('/d/drive/b/home/Docs/', fakeClient({ folders: DOCS }));
    await findItem('Docs/Sub/');
    fireEvent.click(itemNode('Docs/Sub/'));
    fireEvent.keyDown(grid(), { key: 'Delete' });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete the folder “Sub” permanently?')).toBeTruthy();
    expect(within(dialog).getByText(/everything in it/)).toBeTruthy();
  });

  it('Renommer (F2) : conflit already_exists traduit, puis « Conserver les deux »', async () => {
    const client = fakeClient({ folders: DOCS });
    client.rename.mockRejectedValueOnce(new DriveApiError({ status: 409, code: 'already_exists', message: 'exists' } as never));
    mount('/d/drive/b/home/Docs/', client);
    await findItem('Docs/a.txt');
    fireEvent.click(itemNode('Docs/a.txt'));
    fireEvent.keyDown(grid(), { key: 'F2' });
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('a.txt');
    await waitFor(() => expect(input.selectionEnd).toBe(1));
    fireEvent.change(input, { target: { value: 'b.txt' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(await within(dialog).findByText('“b.txt” already exists in this folder.')).toBeTruthy();
    expect(client.rename).toHaveBeenCalledWith('drive', 'home', 'Docs/a.txt', { newName: 'b.txt', conflict: 'fail' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep both' }));
    await waitFor(() => expect(client.rename).toHaveBeenLastCalledWith('drive', 'home', 'Docs/a.txt', { newName: 'b.txt', conflict: 'rename' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Renommer : un « / » est refusé sans requête', async () => {
    const client = fakeClient({ folders: DOCS });
    mount('/d/drive/b/home/Docs/', client);
    await findItem('Docs/a.txt');
    fireEvent.click(itemNode('Docs/a.txt'));
    fireEvent.keyDown(grid(), { key: 'F2' });
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'x/y.txt' } });
    expect(within(dialog).getByRole('alert').textContent).toBe('Use Move to… to change folders.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(client.rename).not.toHaveBeenCalled();
  });
});

describe('glisser-déposer depuis l’ordinateur', () => {
  function dataTransfer(files: File[]) {
    return { types: ['Files'], files, items: [], dropEffect: 'none', effectAllowed: 'all', getData: () => '' } as unknown as DataTransfer;
  }

  it('dépôt sur la zone : envoi dans le dossier affiché ; sur un dossier : dans ce dossier', async () => {
    const queue = getUploadQueue(CONN);
    const add = vi.spyOn(queue, 'addDataTransfer').mockResolvedValue({ files: 0, folders: 0, errors: [] } as never);
    mount('/d/drive/b/home/Docs/', fakeClient({ folders: DOCS }));
    await findItem('Docs/a.txt');
    const zone = document.querySelector<HTMLElement>('[data-explorer]')!;
    const dt = dataTransfer([new File(['x'], 'photo.jpg')]);
    fireEvent.dragEnter(zone, { dataTransfer: dt });
    expect(await screen.findByText('Drop to upload to Docs')).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: dt });
    expect(add).toHaveBeenCalledWith(dt, { bucket: 'home', prefix: 'Docs/' }, undefined);
    expect(screen.queryByText('Drop to upload to Docs')).toBeNull();

    fireEvent.dragOver(itemNode('Docs/Sub/'), { dataTransfer: dt });
    fireEvent.drop(itemNode('Docs/Sub/'), { dataTransfer: dt });
    expect(add).toHaveBeenLastCalledWith(dt, { bucket: 'home', prefix: 'Docs/Sub/' }, undefined);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('sans droit d’écriture : dépôt refusé, la file n’est pas appelée', async () => {
    const queue = getUploadQueue(CONN);
    const add = vi.spyOn(queue, 'addDataTransfer');
    mount('/d/drive/b/home/Docs/', fakeClient({ scopes: ['read'], folders: DOCS }));
    await findItem('Docs/a.txt');
    const zone = document.querySelector<HTMLElement>('[data-explorer]')!;
    const dt = dataTransfer([new File(['x'], 'photo.jpg')]);
    fireEvent.dragEnter(zone, { dataTransfer: dt });
    expect(await screen.findByText('You can’t upload to this space')).toBeTruthy();
    fireEvent.drop(zone, { dataTransfer: dt });
    expect(add).not.toHaveBeenCalled();
  });
});

describe('aperçu', () => {
  it('double-clic ouvre l’aperçu (push), ← / → remplacent l’entrée, Précédent ferme', async () => {
    const { history } = mount('/d/drive/b/home/Docs/', fakeClient({ folders: DOCS }));
    await findItem('Docs/a.txt');
    expect(history.length).toBe(1);
    fireEvent.doubleClick(itemNode('Docs/a.txt'));
    const dialog = await screen.findByRole('dialog', { name: 'Preview of a.txt' });
    expect(href(history)).toBe('/d/drive/b/home/Docs/a.txt');
    expect(history.length).toBe(2);
    // La liste du dossier parent reste montée sous l'aperçu.
    expect(itemNode('Docs/b.txt')).toBeTruthy();
    expect(dialog.textContent).toContain('1 of 3');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByRole('dialog', { name: 'Preview of b.txt' });
    expect(href(history)).toBe('/d/drive/b/home/Docs/b.txt');
    expect(history.length).toBe(2);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByRole('dialog', { name: 'Preview of c.txt' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await screen.findByRole('dialog', { name: 'Preview of b.txt' });
    expect(history.length).toBe(2);

    await act(() => history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(href(history)).toBe('/d/drive/b/home/Docs/');
  });

  it('Fermer revient en arrière ; ouverture directe d’une URL de fichier : Fermer remplace vers le dossier', async () => {
    const { history } = mount('/d/drive/b/home/Docs/c.txt', fakeClient({ folders: DOCS }));
    const dialog = await screen.findByRole('dialog', { name: 'Preview of c.txt' });
    await findItem('Docs/a.txt');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(href(history)).toBe('/d/drive/b/home/Docs/'));
    expect(history.length).toBe(1);
  });

  it('contenu jamais interprété : HTML en iframe sandbox sans scripts, image en <img>', async () => {
    const folders = { '': [file('page.html'), file('logo.svg')] };
    const client = fakeClient({ folders });
    mount('/d/drive/b/home/page.html', client);
    await screen.findByRole('dialog', { name: 'Preview of page.html' });
    const frame = await waitFor(() => {
      const node = document.querySelector('iframe');
      if (!node) throw new Error('no iframe');
      return node;
    });
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(client.downloadUrl).toHaveBeenCalledWith('drive', 'home', 'page.html', { disposition: 'inline' });
    // logo.svg précède page.html dans l'ordre du dossier.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await screen.findByRole('dialog', { name: 'Preview of logo.svg' });
    await waitFor(() => expect(document.querySelector('[role="dialog"] img[alt="logo.svg"]')).not.toBeNull());
    expect(document.querySelector('[role="dialog"] iframe')).toBeNull();
  });
});

describe('clés délicates dans les URL', () => {
  const tricky = {
    '': [folder('dir #1 ?%/'), file('été ü.txt'), file('a+b c#?.txt'), file('100%.txt')],
    'dir #1 ?%/': [file('dir #1 ?%/inner #.txt')],
  };

  it('liens = toPath(), navigation vers le dossier et aperçu avec la clé exacte', async () => {
    const client = fakeClient({ folders: tricky });
    const { history } = mount('/d/drive/b/home/', client);
    await findItem('a+b c#?.txt');
    for (const key of ['été ü.txt', 'a+b c#?.txt', '100%.txt']) {
      const anchor = itemNode(key).querySelector('a')!;
      expect(anchor.getAttribute('href')).toBe(toPath({ conn: 'drive', bucket: 'home', key, kind: 'file' }));
    }
    expect(itemNode('a+b c#?.txt').querySelector('a')!.getAttribute('href')).toBe('/d/drive/b/home/a%2Bb%20c%23%3F.txt');

    fireEvent.doubleClick(itemNode('dir #1 ?%/'));
    await findItem('dir #1 ?%/inner #.txt');
    expect(href(history)).toBe('/d/drive/b/home/dir%20%231%20%3F%25/');
    expect(client.list).toHaveBeenLastCalledWith('drive', 'home', expect.objectContaining({ prefix: 'dir #1 ?%/' }));
    expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toContain('dir #1 ?%');

    fireEvent.doubleClick(itemNode('dir #1 ?%/inner #.txt'));
    await screen.findByRole('dialog', { name: 'Preview of inner #.txt' });
    expect(href(history)).toBe('/d/drive/b/home/dir%20%231%20%3F%25/inner%20%23.txt');
    expect(client.object).toHaveBeenCalledWith('drive', 'home', 'dir #1 ?%/inner #.txt');
  });

  it('URL saisie : unicode et %25 décodés une seule fois', async () => {
    const client = fakeClient({ folders: tricky });
    mount('/d/drive/b/home/%C3%A9t%C3%A9%20%C3%BC.txt', client);
    await screen.findByRole('dialog', { name: 'Preview of été ü.txt' });
    expect(client.object).toHaveBeenCalledWith('drive', 'home', 'été ü.txt');
    cleanup();
    const second = fakeClient({ folders: tricky });
    mount('/d/drive/b/home/100%25.txt', second);
    await screen.findByRole('dialog', { name: 'Preview of 100%.txt' });
    expect(second.object).toHaveBeenCalledWith('drive', 'home', '100%.txt');
  });
});

describe('états', () => {
  it('dossier vide : « Drop files here » ; espace inconnu : introuvable', async () => {
    mount('/d/drive/b/home/', fakeClient({ folders: {} }));
    expect(await screen.findByText('Drop files here')).toBeTruthy();
    cleanup();
    mount('/d/drive/b/nope/', fakeClient({ folders: {} }));
    expect(await screen.findByText('This space doesn’t exist or is no longer available')).toBeTruthy();
  });

  it('erreur de liste : message et Réessayer', async () => {
    const client = fakeClient({ folders: DOCS });
    client.list.mockRejectedValue(new DriveApiError({ status: 403, code: 'scope_denied', message: 'no' } as never));
    mount('/d/drive/b/home/Docs/', client);
    expect(await screen.findByText('You can’t open this folder')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('vue grille par l’URL, fil d’Ariane depuis le libellé de l’espace', async () => {
    mount('/d/drive/b/team/Docs/?view=grid', fakeClient({ folders: DOCS }));
    await findItem('Docs/a.txt');
    expect(document.querySelector('[data-view="grid"]')).not.toBeNull();
    expect(screen.getByText('Folders')).toBeTruthy();
    const crumbs = screen.getByRole('navigation', { name: 'Folder path' });
    expect(within(crumbs).getByRole('link', { name: 'Team' }).getAttribute('href')).toBe('/d/drive/b/team/?view=grid');
  });
});

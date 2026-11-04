// Paramètres en surimpression (`?settings=<onglet>`) et rail des connexions en mode `both`.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { THEME_IDS } from '@ud/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settingsTabOf } from '../src/lib/settings';
import { fakeServer, installDomStubs, instanceInfo, meFixture, mountApp } from './instance-helpers';

beforeEach(() => installDomStubs());
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
});

const routes = (info = instanceInfo) => ({ 'GET /api/v1/instance': { status: 200, body: info }, 'GET /api/v1/me': { status: 200, body: meFixture() } });

describe('?settings=<onglet>', () => {
  it('valeur : onglet connu, sinon le premier ; absent : fermé', () => {
    expect(settingsTabOf(undefined)).toBeNull();
    expect(settingsTabOf('account')).toBe('account');
    expect(settingsTabOf('inconnu')).toBe('appearance');
    expect(settingsTabOf(1)).toBe('appearance');
  });

  it('ouvrir depuis le rail ajoute une entrée, changer d’onglet la remplace, Fermer revient en arrière', async () => {
    const app = mountApp('/d/drive/b/home/', fakeServer(routes()));
    const rail = await screen.findByRole('navigation', { name: 'Stockages' });
    fireEvent.click(within(rail).getByRole('button', { name: 'Paramètres' }));
    await waitFor(() => expect(app.location()).toBe('/d/drive/b/home/?settings=appearance'));
    const dialog = await screen.findByRole('dialog', { name: /Apparence/ });
    expect(within(dialog).getAllByRole('radio', { checked: true }).length).toBe(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raccourcis' }));
    await waitFor(() => expect(app.location()).toBe('/d/drive/b/home/?settings=shortcuts'));
    expect(within(screen.getByRole('dialog')).getByText('Renommer')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fermer' }));
    await waitFor(() => expect(app.location()).toBe('/d/drive/b/home/'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lien partagé : l’onglet demandé s’ouvre ; Fermer retire le paramètre sans quitter la page', async () => {
    const app = mountApp('/d/drive/b/home/?settings=account', fakeServer(routes()));
    const dialog = await screen.findByRole('dialog', { name: /Compte/ });
    expect(within(dialog).getByText('alice@ud.test')).toBeTruthy();
    expect(within(dialog).getByRole('meter', { name: 'Mon drive' }).getAttribute('aria-valuetext')).toMatch(/312\s?Mo sur 1\s?Go/);
    expect(within(dialog).getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(app.location()).toBe('/d/drive/b/home/'));
  });

  it('Apparence : collection et mode appliqués tout de suite et mémorisés', async () => {
    mountApp('/d/drive/b/home/?settings=appearance', fakeServer(routes()));
    const dialog = await screen.findByRole('dialog', { name: /Apparence/ });
    const tiles = within(dialog).getByRole('radiogroup', { name: 'Collection de thèmes' });
    expect(within(tiles).getAllByRole('radio')).toHaveLength(10);
    fireEvent.click(within(tiles).getByRole('radio', { name: 'Nord' }));
    expect(document.documentElement.dataset.theme).toBe('nord');
    expect(localStorage.getItem('ud.theme')).toBe('nord');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sombre' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('ud.mode')).toBe('dark');
  });

  it('Langue : 7 langues, le choix passe l’interface en arabe (RTL)', async () => {
    const app = mountApp('/d/drive/b/home/?settings=language', fakeServer(routes()));
    const dialog = await screen.findByRole('dialog', { name: /Langue/ });
    const group = within(dialog).getByRole('radiogroup');
    expect(within(group).getAllByRole('radio')).toHaveLength(7);
    fireEvent.click(within(group).getByRole('radio', { name: /العربية/ }));
    await waitFor(() => expect(app.i18n.resolvedLanguage).toBe('ar'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('ud.lang')).toBe('ar');
  });

  it('menu du compte → Paramètres : onglet Compte', async () => {
    const app = mountApp('/d/drive/b/home/', fakeServer(routes()));
    const trigger = await screen.findByRole('button', { name: /Alice Martin/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Paramètres' }));
    await waitFor(() => expect(app.location()).toBe('/d/drive/b/home/?settings=account'));
  });
});

describe('rail des connexions', () => {
  it('mode both : « + » vers /connect', async () => {
    mountApp('/d/drive/b/home/', fakeServer(routes({ ...instanceInfo, mode: 'both', personal: true })));
    const rail = await screen.findByRole('navigation', { name: 'Stockages' });
    expect(within(rail).getByRole('link', { name: 'Ajouter un stockage' }).getAttribute('href')).toBe('/connect');
  });

  it('administration : aucune connexion active', async () => {
    mountApp('/admin', fakeServer({ ...routes(), 'GET /api/v1/me': { status: 200, body: meFixture({ admin: ['users.read'] }) }, 'GET /api/v1/admin/users': { status: 200, body: { items: [], nextCursor: null } } }));
    const rail = await screen.findByRole('navigation', { name: 'Stockages' });
    expect(within(rail).getByRole('link', { name: 'Drive de test' }).getAttribute('aria-current')).toBeNull();
  });

  it('script anti-flash d’index.html : mêmes collections que @ud/ui', () => {
    const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
    const list = /var ids = \[([^\]]+)\]/.exec(html)?.[1] ?? '';
    expect(list.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...THEME_IDS]);
  });
});

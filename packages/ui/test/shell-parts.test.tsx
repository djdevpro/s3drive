// Pièces reprises d'Universal Email : rail, choix de l'apparence, paramètres, jauge en ligne, compte en carte.
import { fireEvent, screen, within } from '@testing-library/react';
import { Paintbrush, UserRound } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccountMenu,
  AppRail,
  ColorModePicker,
  QuotaMeter,
  RailAddLink,
  RailBadge,
  RailButton,
  RailItem,
  Segmented,
  SettingRow,
  SettingsPanel,
  ThemePicker,
  THEME_IDS,
  udUiResources,
} from '../src';
import { renderUi } from './render';

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
});

describe('AppRail', () => {
  it('pastille active (aria-current, indicateur), « + », outils avec nom accessible', () => {
    const onSettings = vi.fn();
    renderUi(
      <AppRail label="Stockages" footer={<RailButton label="Paramètres" onClick={onSettings}>⚙</RailButton>}>
        <RailItem href="/d/drive/b/home/" label="Drive" active>
          <RailBadge label="Drive" text="D" />
        </RailItem>
        <RailItem href="/d/AbCdEfGhIj/" label="Perso" active={false} warn="Reconnexion requise">
          <RailBadge label="Perso" color="#2563eb" ink="#fff" />
        </RailItem>
        <RailAddLink href="/connect" label="Ajouter un stockage" />
      </AppRail>,
    );
    const rail = screen.getByRole('navigation', { name: 'Stockages' });
    const active = within(rail).getByRole('link', { name: 'Drive' });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.textContent).toBe('D');
    const other = within(rail).getByRole('link', { name: 'Perso, Reconnexion requise' });
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.textContent).toBe('P');
    expect(within(rail).getByRole('link', { name: 'Ajouter un stockage' }).getAttribute('href')).toBe('/connect');
    fireEvent.click(within(rail).getByRole('button', { name: 'Paramètres' }));
    expect(onSettings).toHaveBeenCalledOnce();
  });
});

describe('Apparence', () => {
  it('ThemePicker : 10 collections nommées, choix appliqué et mémorisé, flèches', () => {
    renderUi(<ThemePicker />, { lng: 'fr' });
    const group = screen.getByRole('radiogroup', { name: 'Collection de thèmes' });
    const tiles = within(group).getAllByRole('radio');
    expect(tiles.map((t) => t.getAttribute('data-theme-id'))).toEqual([...THEME_IDS]);
    expect(within(group).getByRole('radio', { name: 'Porcelaine' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: 'Océan' }));
    expect(document.documentElement.dataset.theme).toBe('ocean');
    expect(localStorage.getItem('ud.theme')).toBe('ocean');
    fireEvent.keyDown(within(group).getByRole('radio', { name: 'Océan' }), { key: 'ArrowRight' });
    expect(document.documentElement.dataset.theme).toBe('midnight');
  });

  it('ColorModePicker : clair, sombre, système', () => {
    renderUi(<ColorModePicker />, { lng: 'fr' });
    const group = screen.getByRole('radiogroup', { name: 'Mode' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Clair', 'Sombre', 'Système']);
    fireEvent.click(within(group).getByRole('radio', { name: 'Sombre' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('ud.mode')).toBe('dark');
  });

  it('Segmented : flèches inversées en RTL', () => {
    const onChange = vi.fn();
    renderUi(
      <Segmented
        aria-label="x"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
      { lng: 'ar' },
    );
    fireEvent.keyDown(screen.getByRole('radio', { name: 'A' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('noms et descriptions des collections dans les 7 langues', () => {
    for (const res of Object.values(udUiResources)) {
      for (const id of THEME_IDS) {
        expect(res.themes[id]).toBeTruthy();
        expect(res.themeDescriptions[id]).toBeTruthy();
      }
    }
  });
});

describe('SettingsPanel', () => {
  it('onglets, onglet actif, Fermer', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderUi(
      <SettingsPanel
        title="Paramètres"
        sectionsLabel="Sections"
        closeLabel="Fermer"
        tabs={[
          { id: 'appearance', label: 'Apparence', icon: Paintbrush },
          { id: 'account', label: 'Compte', icon: UserRound },
        ]}
        active="account"
        onSelect={onSelect}
        onClose={onClose}
      >
        <SettingRow title="Profil" description="Votre nom">
          <span>Alice</span>
        </SettingRow>
      </SettingsPanel>,
    );
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('button', { name: 'Compte' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: 'Compte' })).toBeTruthy();
    fireEvent.click(within(nav).getByRole('button', { name: 'Apparence' }));
    expect(onSelect).toHaveBeenCalledWith('appearance');
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('QuotaMeter en ligne et AccountMenu en carte', () => {
  it('layout="inline" : titre et texte sur une ligne, rôle meter', () => {
    renderUi(<QuotaMeter layout="inline" used={312_000_000} limit={1_000_000_000} />, { lng: 'fr' });
    const meter = screen.getByRole('meter', { name: 'Stockage' });
    expect(meter.closest('[data-slot="quota-meter"]')?.getAttribute('data-layout')).toBe('inline');
    expect((meter.getAttribute('aria-valuetext') ?? '').replace(/\s/g, ' ')).toBe('312 Mo sur 1 Go');
  });

  it('variant="card" : avatar, nom et e-mail dans le déclencheur', () => {
    renderUi(<AccountMenu variant="card" name="Alice Martin" email="alice@ud.test" onSignOut={() => {}} />, { lng: 'fr' });
    const trigger = screen.getByRole('button', { name: 'Compte : Alice Martin' });
    expect(trigger.getAttribute('data-variant')).toBe('card');
    expect(trigger.textContent).toContain('alice@ud.test');
  });
});

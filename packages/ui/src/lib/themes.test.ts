import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_IDS,
  THEMES,
  getColorMode,
  getThemeId,
  initAppearance,
  resolveMode,
  setColorMode,
  setThemeId,
  themeDescriptionKey,
  themeNameKey,
} from './themes';
import { DUR, EASE, motionConfigReducedMotion, prefersReducedMotion, setMotionPref, tReduced, tSpring, transitionFor, tBase } from './motion';

function mockMatchMedia(matches: (q: string) => boolean) {
  const listeners = new Set<() => void>();
  const mql = (query: string) => ({
    matches: matches(query),
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  });
  vi.stubGlobal('matchMedia', mql);
  return listeners;
}

beforeEach(() => {
  localStorage.clear();
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.motion;
  root.classList.remove('dark', 'ud-theme-fade');
});
afterEach(() => vi.unstubAllGlobals());

describe('registre des collections', () => {
  it('10 collections dans l’ordre de la spec, porcelain par défaut', () => {
    expect(THEME_IDS).toEqual(['porcelain', 'graphite', 'nord', 'rose-pine', 'catppuccin', 'solarized', 'sepia', 'forest', 'ocean', 'midnight']);
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
    expect(DEFAULT_THEME).toBe('porcelain');
  });

  it('clés i18n des noms', () => {
    expect(themeNameKey('rose-pine')).toBe('themes:rose-pine.name');
    expect(themeDescriptionKey('nord')).toBe('themes:nord.description');
  });
});

describe('application du thème', () => {
  it('setThemeId mémorise et pose data-theme', () => {
    setThemeId('nord');
    expect(localStorage.getItem('ud.theme')).toBe('nord');
    expect(document.documentElement.dataset.theme).toBe('nord');
    expect(getThemeId()).toBe('nord');
  });

  it('id inconnu → porcelain, sans erreur', () => {
    localStorage.setItem('ud.theme', 'inconnu');
    expect(getThemeId()).toBe('porcelain');
  });

  it('mode clair, sombre, système', () => {
    mockMatchMedia((q) => q.includes('dark'));
    setColorMode('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    setColorMode('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(getColorMode()).toBe('light');
    expect(resolveMode('system')).toBe('dark');
    localStorage.setItem('ud.mode', 'n’importe quoi');
    expect(getColorMode()).toBe('system');
  });

  it('le mode système suit prefers-color-scheme en direct', () => {
    let dark = false;
    const listeners = mockMatchMedia((q) => q.includes('reduce') || (q.includes('dark') && dark));
    const stop = initAppearance();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    dark = true;
    for (const cb of listeners) cb();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    stop();
  });
});

describe('mouvement', () => {
  it('mêmes valeurs qu’Universal Email', () => {
    expect(EASE).toEqual([0.2, 0.8, 0.2, 1]);
    expect(DUR).toMatchObject({ fast: 0.12, base: 0.16, slow: 0.22 });
    expect(tSpring).toEqual({ type: 'spring', bounce: 0, duration: 0.3 });
  });

  it('respecte prefers-reduced-motion et ud.motion', () => {
    mockMatchMedia(() => false);
    expect(prefersReducedMotion()).toBe(false);
    expect(transitionFor(tBase)).toBe(tBase);
    setMotionPref('reduce');
    expect(document.documentElement.dataset.motion).toBe('reduce');
    expect(prefersReducedMotion()).toBe(true);
    expect(transitionFor(tBase)).toBe(tReduced);
    expect(motionConfigReducedMotion()).toBe('always');
    setMotionPref('system');
    mockMatchMedia((q) => q.includes('reduce'));
    expect(prefersReducedMotion()).toBe(true);
    expect(motionConfigReducedMotion()).toBe('user');
  });
});

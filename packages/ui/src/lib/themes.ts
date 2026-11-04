/**
 * Collections de thèmes (repris d'Universal Email lib/themes.ts).
 * Une collection redéfinit les jetons de collection (`--ud-*` + variables shadcn) en clair et en sombre via
 * `[data-theme="<id>"]` et `[data-theme="<id>"].dark` (fichiers `styles/themes/<id>.css`).
 * Le mode clair / sombre / système est indépendant de la collection (classe `.dark` sur <html>).
 * Noms affichés : espace de noms i18n `themes`, clés `themes:<id>.name` et `themes:<id>.description`.
 */
import { useSyncExternalStore } from 'react';
import { prefersReducedMotion } from './motion';

export const THEME_IDS = [
  'porcelain',
  'graphite',
  'nord',
  'rose-pine',
  'catppuccin',
  'solarized',
  'sepia',
  'forest',
  'ocean',
  'midnight',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ColorMode = 'light' | 'dark' | 'system';
export type ResolvedMode = 'light' | 'dark';

/** Couleurs d'aperçu d'une variante : [fond appli, barre latérale, panneau, texte, accent]. */
export type ThemePreview = readonly [app: string, sidebar: string, panel: string, text: string, accent: string];

export interface ThemeDef {
  id: ThemeId;
  /** Accent par défaut de la collection, en clair (l'accent du stockage reste prioritaire). */
  accent: string;
  preview: { light: ThemePreview; dark: ThemePreview };
}

export const DEFAULT_THEME: ThemeId = 'porcelain';
export const DEFAULT_MODE: ColorMode = 'system';

/** Registre : accent par défaut et couleurs d'aperçu, identiques aux fichiers CSS (vérifié par les tests). */
export const THEMES: readonly ThemeDef[] = [
  {
    id: 'porcelain',
    accent: '#5b5bd6',
    preview: {
      light: ['#f6f5f3', '#f6f5f3', '#ffffff', '#1c1917', '#5b5bd6'],
      dark: ['#121110', '#121110', '#1a1918', '#edebe8', '#8b8ef5'],
    },
  },
  {
    id: 'graphite',
    accent: '#2563eb',
    preview: {
      light: ['#f4f5f7', '#f4f5f7', '#ffffff', '#15181e', '#2563eb'],
      dark: ['#111214', '#111214', '#18191c', '#e8eaee', '#6ea8fe'],
    },
  },
  {
    id: 'nord',
    accent: '#4c6f99',
    preview: {
      light: ['#e5e9f0', '#e5e9f0', '#eceff4', '#2e3440', '#4c6f99'],
      dark: ['#2e3440', '#2e3440', '#3b4252', '#eceff4', '#88c0d0'],
    },
  },
  {
    id: 'rose-pine',
    accent: '#286983',
    preview: {
      light: ['#faf4ed', '#faf4ed', '#fffaf3', '#575279', '#286983'],
      dark: ['#232136', '#232136', '#2a273f', '#e0def4', '#c4a7e7'],
    },
  },
  {
    id: 'catppuccin',
    accent: '#8839ef',
    preview: {
      light: ['#e6e9ef', '#e6e9ef', '#eff1f5', '#4c4f69', '#8839ef'],
      dark: ['#181825', '#181825', '#1e1e2e', '#cdd6f4', '#cba6f7'],
    },
  },
  {
    id: 'solarized',
    accent: '#1f6fa8',
    preview: {
      light: ['#eee8d5', '#eee8d5', '#fdf6e3', '#073642', '#1f6fa8'],
      dark: ['#00222b', '#00222b', '#002b36', '#eee8d5', '#4aa3df'],
    },
  },
  {
    id: 'sepia',
    accent: '#9a4a24',
    preview: {
      light: ['#f3ecdf', '#f3ecdf', '#fbf7ee', '#2f2418', '#9a4a24'],
      dark: ['#1b1611', '#1b1611', '#231d17', '#ede3d1', '#dc9a62'],
    },
  },
  {
    id: 'forest',
    accent: '#2d7a4c',
    preview: {
      light: ['#f1f4ef', '#f1f4ef', '#fbfcfa', '#17221a', '#2d7a4c'],
      dark: ['#0e1510', '#0e1510', '#141d17', '#e3ece5', '#62c08a'],
    },
  },
  {
    id: 'ocean',
    accent: '#0b6aa2',
    preview: {
      light: ['#eef3f8', '#eef3f8', '#fbfdff', '#0f1d2b', '#0b6aa2'],
      dark: ['#0a1520', '#0a1520', '#0f1d2a', '#e1ebf4', '#52b4ea'],
    },
  },
  {
    id: 'midnight',
    accent: '#5a4fd1',
    preview: {
      light: ['#f2f2f6', '#f2f2f6', '#fafafc', '#1a1a24', '#5a4fd1'],
      dark: ['#000000', '#050507', '#0b0b0e', '#ececf1', '#9488f7'],
    },
  },
];

/** Jetons qu'une collection doit définir dans chaque variante. */
export const THEME_COLOR_TOKENS = [
  '--ud-accent',
  '--ud-on-accent',
  '--ud-accent-soft',
  '--ud-accent-softer',
  '--ud-accent-strong',
  '--ud-accent-ring',
  '--ud-app',
  '--ud-rail',
  '--ud-sidebar',
  '--ud-panel',
  '--ud-row-hover',
  '--ud-row-selected',
  '--ud-row-unread',
  '--ud-line',
  '--ud-line-strong',
  '--ud-text-1',
  '--ud-text-2',
  '--ud-text-3',
  '--ud-shadow-float',
  '--ud-shadow-soft',
  '--ud-overlay',
  '--ud-danger',
  '--ud-success',
  '--ud-warn',
  '--ud-flag',
  '--ud-btn-primary-bg',
  '--ud-btn-primary-fg',
  '--ud-btn-primary-icon',
  '--ud-btn-primary-border',
  '--ud-btn-primary-hover',
  '--ud-btn-secondary-bg',
  '--ud-btn-secondary-fg',
  '--ud-btn-secondary-border',
  '--ud-btn-secondary-hover',
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--border',
  '--input',
  '--ring',
] as const;

export const THEME_STORAGE_KEY = 'ud.theme';
export const MODE_STORAGE_KEY = 'ud.mode';
/** Événement émis sur `window` à chaque changement de collection ou de mode. */
export const THEME_EVENT = 'ud:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

export function isColorMode(v: unknown): v is ColorMode {
  return v === 'light' || v === 'dark' || v === 'system';
}

export function getThemeDef(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? (THEMES[0] as ThemeDef);
}

/** Clés i18n du nom et de la description d'une collection. */
export function themeNameKey(id: ThemeId): `themes:${ThemeId}.name` {
  return `themes:${id}.name`;
}
export function themeDescriptionKey(id: ThemeId): `themes:${ThemeId}.description` {
  return `themes:${id}.description`;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible (navigation privée) */
  }
}

export function getThemeId(): ThemeId {
  const saved = readStorage(THEME_STORAGE_KEY);
  return isThemeId(saved) ? saved : DEFAULT_THEME;
}

export function getColorMode(): ColorMode {
  const saved = readStorage(MODE_STORAGE_KEY);
  return isColorMode(saved) ? saved : DEFAULT_MODE;
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

export function resolveMode(mode: ColorMode): ResolvedMode {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** `<meta name="theme-color">` prend la valeur calculée de --ud-app. */
export function syncThemeColorMeta(): void {
  if (typeof document === 'undefined') return;
  const app = getComputedStyle(document.documentElement).getPropertyValue('--ud-app').trim();
  if (!app) return;
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = app;
    document.head.appendChild(meta);
    return;
  }
  for (const meta of metas) meta.content = app;
}

export function applyThemeId(id: ThemeId): void {
  document.documentElement.dataset.theme = isThemeId(id) ? id : DEFAULT_THEME;
  syncThemeColorMeta();
}

export function applyColorMode(mode: ColorMode): void {
  const dark = resolveMode(mode) === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  syncThemeColorMeta();
}

let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/** Fondu croisé (View Transitions API, sinon transition des couleurs 180 ms) ; immédiat si mouvement réduit. */
export function crossFade(commit: () => void): void {
  const root = document.documentElement;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (prefersReducedMotion() || document.visibilityState === 'hidden') return commit();
  if (typeof doc.startViewTransition === 'function') {
    try {
      doc.startViewTransition(commit);
      return;
    } catch {
      /* transition refusée : repli ci-dessous */
    }
  }
  clearTimeout(fadeTimer);
  root.classList.add('ud-theme-fade');
  commit();
  fadeTimer = setTimeout(() => root.classList.remove('ud-theme-fade'), 220);
}

function emit(): void {
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Change de collection en fondu croisé et mémorise le choix. */
export function setThemeId(id: ThemeId): void {
  const next = isThemeId(id) ? id : DEFAULT_THEME;
  writeStorage(THEME_STORAGE_KEY, next);
  const commit = () => {
    applyThemeId(next);
    emit();
  };
  if (document.documentElement.dataset.theme === next) return commit();
  crossFade(commit);
}

/** Change de mode en fondu croisé et mémorise le choix. */
export function setColorMode(mode: ColorMode): void {
  const next = isColorMode(mode) ? mode : DEFAULT_MODE;
  writeStorage(MODE_STORAGE_KEY, next);
  const commit = () => {
    applyColorMode(next);
    emit();
  };
  const isDark = document.documentElement.classList.contains('dark');
  if (isDark === (resolveMode(next) === 'dark')) return commit();
  crossFade(commit);
}

/**
 * Applique collection et mode mémorisés, puis suit en direct `prefers-color-scheme` (mode système)
 * et les changements des autres onglets. Retourne la fonction de nettoyage.
 */
export function initAppearance(): () => void {
  applyThemeId(getThemeId());
  applyColorMode(getColorMode());
  const onSystem = () => {
    if (getColorMode() !== 'system') return;
    crossFade(() => {
      applyColorMode('system');
      emit();
    });
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY && e.key !== MODE_STORAGE_KEY && e.key !== null) return;
    applyThemeId(getThemeId());
    applyColorMode(getColorMode());
    emit();
  };
  const mql = typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  mql?.addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  return () => {
    mql?.removeEventListener('change', onSystem);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

export function useThemeId(): [ThemeId, (id: ThemeId) => void] {
  const id = useSyncExternalStore(subscribe, getThemeId, () => DEFAULT_THEME);
  return [id, setThemeId];
}

export function useColorMode(): [ColorMode, (mode: ColorMode) => void] {
  const mode = useSyncExternalStore(subscribe, getColorMode, () => DEFAULT_MODE);
  return [mode, setColorMode];
}

function getResolvedMode(): ResolvedMode {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Mode effectivement appliqué (classe `.dark` sur <html>), suivi en direct. */
export function useResolvedMode(): ResolvedMode {
  return useSyncExternalStore(subscribe, getResolvedMode, () => 'light');
}

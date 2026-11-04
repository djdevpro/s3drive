import { addUdUiResources, directionOf as udDirectionOf, UD_LANGUAGES } from '@ud/ui';
import i18next, { type i18n as I18n, type ResourceLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';

// Traductions de l'appli : tous les fichiers `locales/<langue>/<espace>.json` sont pris
// d'office (un espace ajouté par un lot n'a rien à déclarer ici), plus l'espace `ud-ui` de @ud/ui.
// Langue de référence : en ; arabe en RTL.

export type Language = (typeof UD_LANGUAGES)[number]['code'];
export const SUPPORTED_LANGUAGES: readonly Language[] = UD_LANGUAGES.map((l) => l.code);
export const LANGUAGE_STORAGE_KEY = 'ud.lang';

const files = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', { eager: true, import: 'default' });

function collect(): { resources: Record<string, ResourceLanguage>; namespaces: string[] } {
  const out: Record<string, ResourceLanguage> = {};
  const names = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match?.[1] || !match[2]) continue;
    (out[match[1]] ??= {})[match[2]] = content;
    names.add(match[2]);
  }
  return { resources: out, namespaces: [...names].sort() };
}

const collected = collect();
/** Ressources par langue puis par espace, lues dans `locales/`. */
export const resources = collected.resources;
export const NAMESPACES = collected.namespaces;

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function directionOf(lng: string): 'rtl' | 'ltr' {
  return udDirectionOf(lng);
}

function applyDocumentLanguage(lng: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lng;
  document.documentElement.dir = directionOf(lng);
}

function readSavedLanguage(): Language | null {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** Change de langue et mémorise le choix sur cet appareil. */
export function setLanguage(i18n: I18n, lng: Language): Promise<unknown> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* stockage indisponible (navigation privée) */
  }
  return i18n.changeLanguage(lng);
}

/** Langue mémorisée, sinon la première langue du navigateur prise en charge, sinon l'anglais. */
export function detectLanguage(): Language {
  const saved = readSavedLanguage();
  if (saved) return saved;
  const nav = typeof navigator === 'undefined' ? [] : (navigator.languages ?? []);
  for (const tag of nav) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** Crée une instance i18next (une par appli, une par test) et synchronise lang et dir du document. */
export function createI18n(lng?: string): I18n {
  const instance = i18next.createInstance();
  instance.on('languageChanged', applyDocumentLanguage);
  void instance.use(initReactI18next).init({
    resources,
    lng: lng ?? detectLanguage(),
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    ns: NAMESPACES,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  addUdUiResources(instance);
  return instance;
}

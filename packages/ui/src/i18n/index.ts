/**
 * Traductions de l'espace `ud-ui` : 7 langues, `en` de référence.
 * L'hôte crée son instance i18next puis appelle `addUdUiResources(i18n)` ; les composants lisent
 * leurs textes par `useTranslation('ud-ui')` et formatent selon la langue résolue.
 */
import type { i18n as I18n } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ar } from './locales/ar';
import { de } from './locales/de';
import { en, type UdUiResource } from './locales/en';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { pt } from './locales/pt';

export type { UdUiResource };

export const UD_UI_NS = 'ud-ui';

/** Registre des langues (ordre fixe, nom natif, direction), repris d'Universal Email. */
export const UD_LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'it', name: 'Italiano', dir: 'ltr' },
  { code: 'pt', name: 'Português', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
] as const;

export type UdLanguage = (typeof UD_LANGUAGES)[number]['code'];

export const udUiResources: Record<UdLanguage, UdUiResource> = { en, fr, es, de, it, pt, ar };

/** Ajoute l'espace `ud-ui` dans les 7 langues à une instance i18next (sans écraser les surcharges de l'hôte). */
export function addUdUiResources(i18n: I18n): I18n {
  for (const [lng, res] of Object.entries(udUiResources)) {
    i18n.addResourceBundle(lng, UD_UI_NS, res, true, false);
  }
  return i18n;
}

/** Direction d'écriture d'une langue (`ar`, `ar-MA` → rtl). */
export function directionOf(lng: string): 'ltr' | 'rtl' {
  const base = (lng.split('-')[0] ?? lng).toLowerCase();
  return UD_LANGUAGES.find((l) => l.code === base)?.dir ?? 'ltr';
}

/** `t` de l'espace ud-ui et locale de formatage (langue résolue, `en` à défaut). */
export function useUdTranslation(): { t: ReturnType<typeof useTranslation>['t']; locale: string } {
  const { t, i18n } = useTranslation(UD_UI_NS);
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  return { t, locale };
}

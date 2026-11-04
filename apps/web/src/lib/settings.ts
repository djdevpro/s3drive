import { useLocation, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';

/*
 * Paramètres en surimpression : `?settings=<onglet>` sur n'importe quelle vue, lien
 * partageable. Ouvrir ajoute une entrée d'historique (Précédent ferme) ; changer d'onglet la
 * remplace ; Fermer revient en arrière si l'appli a ouvert la surimpression, sinon retire le
 * paramètre sans nouvelle entrée (lien ouvert directement). Onglet inconnu : le premier.
 */

export const SETTINGS_TABS = ['appearance', 'language', 'account', 'shortcuts'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const DEFAULT_SETTINGS_TAB: SettingsTab = 'appearance';
const PARAM = 'settings';

/** Onglet demandé par la valeur de `?settings=` ; `null` sans paramètre. */
export function settingsTabOf(value: unknown): SettingsTab | null {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return (SETTINGS_TABS as readonly string[]).includes(text) ? (text as SettingsTab) : DEFAULT_SETTINGS_TAB;
}

// Vrai quand l'entrée d'historique courante a été ajoutée par `open` (Fermer = Précédent).
let pushedByApp = false;

export interface SettingsNav {
  tab: SettingsTab | null;
  open: (tab?: SettingsTab) => void;
  select: (tab: SettingsTab) => void;
  close: () => void;
}

export function useSettingsNav(): SettingsNav {
  const router = useRouter();
  const search = useLocation({ select: (l) => l.search as Record<string, unknown> });
  const pathname = useLocation({ select: (l) => l.pathname });
  const tab = settingsTabOf(search[PARAM]);

  useEffect(() => {
    if (tab === null) pushedByApp = false;
  }, [tab]);

  const hrefWith = useCallback(
    (next: SettingsTab | null) => {
      const rest: Record<string, unknown> = { ...search };
      delete rest[PARAM];
      if (next) rest[PARAM] = next;
      return `${pathname}${router.options.stringifySearch(rest)}`;
    },
    [pathname, router, search],
  );

  const open = useCallback(
    (next: SettingsTab = DEFAULT_SETTINGS_TAB) => {
      if (tab !== null) {
        void router.navigate({ href: hrefWith(next), replace: true });
        return;
      }
      pushedByApp = true;
      void router.navigate({ href: hrefWith(next) });
    },
    [hrefWith, router, tab],
  );

  const select = useCallback((next: SettingsTab) => void router.navigate({ href: hrefWith(next), replace: true }), [hrefWith, router]);

  const close = useCallback(() => {
    if (tab === null) return;
    if (pushedByApp) {
      pushedByApp = false;
      router.history.back();
      return;
    }
    void router.navigate({ href: hrefWith(null), replace: true });
  }, [hrefWith, router, tab]);

  return { tab, open, select, close };
}

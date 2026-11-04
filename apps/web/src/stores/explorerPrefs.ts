import { create } from 'zustand';
import { DEFAULT_SORT, SORT_FIELDS, type SortSpec } from '../components/explorer/sort';

/*
 * Préférences d'appareil de l'explorateur : vue et tri des dossiers. L'URL
 * (`?view=`, `?sort=`, `?dir=`) les remplace ; les changer met à jour l'URL et ce défaut.
 * Stockage local facultatif : l'explorateur fonctionne sans.
 */

export type ExplorerView = 'list' | 'grid';

interface PrefsState {
  view: ExplorerView;
  sort: SortSpec;
  setView: (view: ExplorerView) => void;
  setSort: (sort: SortSpec) => void;
}

const STORAGE_KEY = 'ud.explorer.prefs.v1';

function load(): Pick<PrefsState, 'view' | 'sort'> {
  const fallback = { view: 'list' as ExplorerView, sort: DEFAULT_SORT };
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as { view?: unknown; sort?: { field?: unknown; dir?: unknown } };
    const view = value.view === 'grid' || value.view === 'list' ? value.view : fallback.view;
    const field = SORT_FIELDS.find((f) => f === value.sort?.field);
    const dir = value.sort?.dir === 'asc' || value.sort?.dir === 'desc' ? value.sort.dir : undefined;
    return { view, sort: field && dir ? { field, dir } : fallback.sort };
  } catch {
    return fallback;
  }
}

function save(state: Pick<PrefsState, 'view' | 'sort'>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ view: state.view, sort: state.sort }));
  } catch {
    // Stockage indisponible (navigation privée) : préférence de la session seulement.
  }
}

export const useExplorerPrefs = create<PrefsState>()((set, get) => ({
  ...load(),
  setView: (view) => {
    set({ view });
    save(get());
  },
  setSort: (sort) => {
    set({ sort });
    save(get());
  },
}));

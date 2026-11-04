import { create } from 'zustand';

/*
 * Sélection de l'explorateur : propre au contexte de liste (dossier affiché),
 * vidée au changement de dossier, conservée à l'ouverture d'un aperçu, au changement de tri ou
 * de vue et aux nouvelles pages. Chaque ligne s'abonne à son seul état (`useIsSelected`).
 * Les éléments sont identifiés par leur clé (préfixe `/` final pour un dossier).
 */

export interface SelectionState {
  /** Identité du contexte (folderIdentity) ; un autre contexte vide la sélection. */
  context: string | null;
  selected: ReadonlySet<string>;
  /** Ancre des plages Maj+clic. */
  anchor: string | null;
  /** Élément focalisé (tabulation itinérante). */
  focus: string | null;
  setContext: (context: string) => void;
  /** Clic simple : sélection unique. */
  selectOnly: (key: string) => void;
  /** Ctrl/⌘+clic : bascule. */
  toggle: (key: string) => void;
  /** Maj+clic : plage depuis l'ancre dans l'ordre affiché ; `additive` (Ctrl+Maj) l'ajoute. */
  selectRange: (order: readonly string[], key: string, additive?: boolean) => void;
  selectAll: (order: readonly string[]) => void;
  clear: () => void;
  setFocus: (key: string | null) => void;
  /** Retire les éléments disparus. */
  prune: (existing: ReadonlySet<string>) => void;
}

const EMPTY: ReadonlySet<string> = new Set();

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  context: null,
  selected: EMPTY,
  anchor: null,
  focus: null,
  setContext: (context) => {
    if (get().context === context) return;
    set({ context, selected: EMPTY, anchor: null, focus: null });
  },
  selectOnly: (key) => set({ selected: new Set([key]), anchor: key, focus: key }),
  toggle: (key) => {
    const next = new Set(get().selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set({ selected: next, anchor: key, focus: key });
  },
  selectRange: (order, key, additive = false) => {
    const { anchor, selected } = get();
    const from = anchor === null ? -1 : order.indexOf(anchor);
    const to = order.indexOf(key);
    if (to < 0) return;
    if (from < 0) {
      set({ selected: new Set([key]), anchor: key, focus: key });
      return;
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const next = additive ? new Set(selected) : new Set<string>();
    for (let i = lo; i <= hi; i++) next.add(order[i]!);
    // L'ancre reste en place pour les plages suivantes.
    set({ selected: next, focus: key });
  },
  selectAll: (order) => set({ selected: new Set(order), anchor: order[0] ?? null }),
  clear: () => set({ selected: EMPTY, anchor: null }),
  setFocus: (focus) => set({ focus }),
  prune: (existing) => {
    const { selected, focus, anchor } = get();
    let changed = false;
    const next = new Set<string>();
    for (const key of selected) {
      if (existing.has(key)) next.add(key);
      else changed = true;
    }
    const patch: Partial<SelectionState> = {};
    if (changed) patch.selected = next;
    if (focus !== null && !existing.has(focus)) patch.focus = null;
    if (anchor !== null && !existing.has(anchor)) patch.anchor = null;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

/** Abonnement d'une ligne à son seul état de sélection. */
export function useIsSelected(key: string): boolean {
  return useSelectionStore((s) => s.selected.has(key));
}

export function useIsFocused(key: string): boolean {
  return useSelectionStore((s) => s.focus === key);
}

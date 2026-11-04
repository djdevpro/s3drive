import { create } from 'zustand';

/*
 * Presse-papiers de l'appli : Ctrl/⌘+C et Ctrl/⌘+X retiennent des éléments, Ctrl/⌘+V
 * les copie ou les déplace dans le dossier affiché. Mémoire de l'onglet seulement.
 */

export interface ClipboardItem {
  key: string;
  kind: 'folder' | 'file';
  name: string;
}

export interface ClipboardEntry {
  op: 'copy' | 'cut';
  conn: string;
  bucket: string;
  items: ClipboardItem[];
}

interface ClipboardState {
  entry: ClipboardEntry | null;
  set: (entry: ClipboardEntry) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>()((set) => ({
  entry: null,
  set: (entry) => set({ entry }),
  clear: () => set({ entry: null }),
}));

/** Vrai si l'élément est coupé (rendu atténué). */
export function useIsCut(conn: string, bucket: string, key: string): boolean {
  return useClipboardStore((s) => s.entry?.op === 'cut' && s.entry.conn === conn && s.entry.bucket === bucket && s.entry.items.some((i) => i.key === key));
}

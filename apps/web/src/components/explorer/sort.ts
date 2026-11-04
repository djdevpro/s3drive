import type { ListItem } from '@ud/contracts';
import { fileCategory, fileExtension } from '@ud/ui';

/*
 * Tri de l'explorateur : le moteur rend dossiers puis fichiers
 * page par page, le front trie tout ce qui est chargé. Dossiers d'abord ; comparateur
 * Intl.Collator numérique mis en cache ; à égalité, ordre des points de code (= ordre binaire
 * UTF-8) de la clé : ordre total et stable.
 */

export const SORT_FIELDS = ['name', 'modified', 'size', 'type'] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDir = 'asc' | 'desc';

/** Sens par défaut quand on choisit une colonne. */
export const DEFAULT_SORT_DIR: Record<SortField, SortDir> = { name: 'asc', type: 'asc', modified: 'desc', size: 'desc' };

export interface SortSpec {
  field: SortField;
  dir: SortDir;
}

export const DEFAULT_SORT: SortSpec = { field: 'name', dir: 'asc' };

const collators = new Map<string, Intl.Collator>();

export function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    collators.set(locale, collator);
  }
  return collator;
}

/** Ordre des points de code, identique à l'ordre binaire UTF-8. */
export function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  const ia = a[Symbol.iterator]();
  const ib = b[Symbol.iterator]();
  for (;;) {
    const ca = ia.next();
    const cb = ib.next();
    if (ca.done) return cb.done ? 0 : -1;
    if (cb.done) return 1;
    const diff = (ca.value.codePointAt(0) ?? 0) - (cb.value.codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
}

export interface SortOptions extends SortSpec {
  locale: string;
  foldersFirst?: boolean;
  /** Libellé traduit de la catégorie (tri par type) ; défaut : identifiant de catégorie. */
  typeLabel?: (item: ListItem) => string;
}

function valueOf(item: ListItem, field: SortField, typeLabel: (item: ListItem) => string): number | string | null {
  if (item.kind === 'folder') return field === 'name' ? item.name : null;
  switch (field) {
    case 'name':
      return item.name;
    case 'modified': {
      const time = Date.parse(item.lastModified);
      return Number.isNaN(time) ? null : time;
    }
    case 'size':
      return item.size;
    case 'type':
      return typeLabel(item);
  }
}

/** Trie une copie de `items` : dossiers d'abord, valeurs absentes après les autres dans les deux sens. */
export function sortItems(items: readonly ListItem[], options: SortOptions): ListItem[] {
  const { field, dir, locale, foldersFirst = true } = options;
  const collator = collatorFor(locale);
  const typeLabel = options.typeLabel ?? ((item: ListItem) => fileCategory(item.name, null, { isFolder: item.kind === 'folder' }));
  const sign = dir === 'asc' ? 1 : -1;

  const byName = (a: ListItem, b: ListItem) => collator.compare(a.name, b.name) || compareCodePoints(a.key, b.key);

  const decorated = items.map((item) => ({ item, value: valueOf(item, field, typeLabel) }));
  decorated.sort((x, y) => {
    if (foldersFirst && x.item.kind !== y.item.kind) return x.item.kind === 'folder' ? -1 : 1;
    const a = x.value;
    const b = y.value;
    // Sans valeur pour la colonne : par nom croissant, après les autres.
    if (a === null || b === null) {
      if (a === null && b === null) return byName(x.item, y.item);
      return a === null ? 1 : -1;
    }
    let diff: number;
    if (typeof a === 'number' && typeof b === 'number') diff = a - b;
    else diff = collator.compare(String(a), String(b));
    if (diff === 0 && field === 'type') {
      diff = collator.compare(fileExtension(x.item.name), fileExtension(y.item.name)) || collator.compare(x.item.name, y.item.name);
    }
    if (diff === 0 && field !== 'name') diff = collator.compare(x.item.name, y.item.name);
    if (diff !== 0) return diff * sign;
    return compareCodePoints(x.item.key, y.item.key) * sign;
  });
  return decorated.map((d) => d.item);
}

/** Tri effectif à partir de l'URL : `?sort=` sans `?dir=` prend le sens par défaut de la colonne. */
export function sortFromSearch(sort: SortField | undefined, dir: SortDir | undefined, fallback: SortSpec = DEFAULT_SORT): SortSpec {
  const field = sort ?? fallback.field;
  return { field, dir: dir ?? (sort ? DEFAULT_SORT_DIR[field] : fallback.dir) };
}

/** Prochain tri au clic sur une colonne : sens par défaut, puis inverse. */
export function nextSort(current: SortSpec, field: SortField): SortSpec {
  if (current.field !== field) return { field, dir: DEFAULT_SORT_DIR[field] };
  return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

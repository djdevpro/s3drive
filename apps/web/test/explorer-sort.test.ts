import type { ListItem } from '@ud/contracts';
import { describe, expect, it } from 'vitest';
import { checkName, baseNameEnd } from '../src/components/explorer/names';
import { compareCodePoints, nextSort, sortFromSearch, sortItems } from '../src/components/explorer/sort';
import { explorerHref, withSearch } from '../src/components/explorer/urls';
import { useSelectionStore } from '../src/stores/selection';

const file = (key: string, size = 1, lastModified = '2026-01-01T00:00:00Z'): ListItem => ({
  kind: 'file',
  key,
  name: key.split('/').pop()!,
  size,
  lastModified,
  etag: '"e"',
  storageClass: 'STANDARD',
});
const folder = (key: string): ListItem => ({ kind: 'folder', key, name: key.slice(0, -1).split('/').pop()! });
const names = (items: ListItem[]) => items.map((i) => i.name);

describe('tri de l’explorateur', () => {
  const items = [file('b.txt', 30, '2026-03-01T00:00:00Z'), folder('Zeta/'), file('a10.txt', 5), file('a2.txt', 100, '2026-02-01T00:00:00Z'), folder('alpha/')];

  it('dossiers d’abord, ordre naturel (a2 avant a10), insensible à la casse', () => {
    expect(names(sortItems(items, { field: 'name', dir: 'asc', locale: 'en' }))).toEqual(['alpha', 'Zeta', 'a2.txt', 'a10.txt', 'b.txt']);
  });

  it('sens décroissant : les dossiers restent en tête', () => {
    expect(names(sortItems(items, { field: 'name', dir: 'desc', locale: 'en' }))).toEqual(['Zeta', 'alpha', 'b.txt', 'a10.txt', 'a2.txt']);
  });

  it('taille et date : dossiers (sans valeur) en tête et triés par nom dans les deux sens', () => {
    expect(names(sortItems(items, { field: 'size', dir: 'desc', locale: 'en' }))).toEqual(['alpha', 'Zeta', 'a2.txt', 'b.txt', 'a10.txt']);
    expect(names(sortItems(items, { field: 'size', dir: 'asc', locale: 'en' }))).toEqual(['alpha', 'Zeta', 'a10.txt', 'b.txt', 'a2.txt']);
    expect(names(sortItems(items, { field: 'modified', dir: 'desc', locale: 'en' }))).toEqual(['alpha', 'Zeta', 'b.txt', 'a2.txt', 'a10.txt']);
  });

  it('sans « dossiers d’abord » : les dossiers sans valeur passent après les fichiers', () => {
    expect(names(sortItems(items, { field: 'size', dir: 'asc', locale: 'en', foldersFirst: false }))).toEqual(['a10.txt', 'b.txt', 'a2.txt', 'alpha', 'Zeta']);
  });

  it('égalité de collation départagée par l’ordre binaire de la clé (ordre total et stable)', () => {
    const twins = [file('a.txt'), file('A.txt'), file('é.txt'), file('é.txt')];
    const once = sortItems(twins, { field: 'name', dir: 'asc', locale: 'fr' });
    const twice = sortItems([...twins].reverse(), { field: 'name', dir: 'asc', locale: 'fr' });
    expect(once.map((i) => i.key)).toEqual(twice.map((i) => i.key));
    expect(once.map((i) => i.key).slice(0, 2)).toEqual(['A.txt', 'a.txt']);
    expect(compareCodePoints('\u{1F600}', '￿')).toBeGreaterThan(0);
  });

  it('URL : ?sort= sans ?dir= prend le sens par défaut de la colonne ; clic = défaut puis inverse', () => {
    expect(sortFromSearch('size', undefined)).toEqual({ field: 'size', dir: 'desc' });
    expect(sortFromSearch(undefined, undefined)).toEqual({ field: 'name', dir: 'asc' });
    expect(nextSort({ field: 'name', dir: 'asc' }, 'modified')).toEqual({ field: 'modified', dir: 'desc' });
    expect(nextSort({ field: 'modified', dir: 'desc' }, 'modified')).toEqual({ field: 'modified', dir: 'asc' });
  });
});

describe('sélection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const selected = () => [...useSelectionStore.getState().selected].sort();

  it('clic, Ctrl+clic, Maj+clic, Ctrl+Maj+clic, tout, vider, éléments disparus', () => {
    const s = useSelectionStore.getState();
    s.setContext('ctx-1');
    s.selectOnly('b');
    expect(selected()).toEqual(['b']);
    s.toggle('d');
    expect(selected()).toEqual(['b', 'd']);
    s.toggle('b');
    expect(selected()).toEqual(['d']);
    // L'ancre est le dernier élément basculé (b).
    s.selectRange(order, 'd');
    expect(selected()).toEqual(['b', 'c', 'd']);
    s.selectOnly('e');
    s.selectRange(order, 'd', true);
    expect(selected()).toEqual(['d', 'e']);
    s.selectAll(order);
    expect(selected()).toEqual(order);
    s.prune(new Set(['a', 'c']));
    expect(selected()).toEqual(['a', 'c']);
    s.setContext('ctx-2');
    expect(selected()).toEqual([]);
  });
});

describe('noms', () => {
  it('refus et avertissements', () => {
    expect(checkName('  ', { prefix: '', isFolder: false }).error).toBe('empty');
    expect(checkName('a/b', { prefix: '', isFolder: false }).error).toBe('slash');
    expect(checkName('a/b', { prefix: '', isFolder: true, allowSlash: true })).toMatchObject({ levels: 2 });
    expect(checkName('..', { prefix: '', isFolder: false }).error).toBe('dots');
    expect(checkName('a\u0007', { prefix: '', isFolder: false }).error).toBe('control');
    expect(checkName('x'.repeat(1030), { prefix: '', isFolder: false })).toMatchObject({ error: 'tooLong', excess: 6 });
    expect(checkName('note ', { prefix: '', isFolder: false }).warning).toBe('trailing');
    expect(checkName('fac‮txt.exe', { prefix: '', isFolder: false }).warning).toBe('bidi');
    expect(checkName('é', { prefix: '', isFolder: false }).value).toBe('é');
  });

  it('sélection du nom sans l’extension (composée comprise)', () => {
    expect(baseNameEnd('rapport.pdf', false)).toBe(7);
    expect(baseNameEnd('archive.tar.gz', false)).toBe(7);
    expect(baseNameEnd('.env', false)).toBe(4);
    expect(baseNameEnd('Dossier.v2', true)).toBe(10);
  });
});

describe('URL de l’explorateur', () => {
  it('paramètres ajoutés à un chemin, forme ~k comprise ; valeur vide retirée', () => {
    expect(withSearch('/d/drive/b/home/a%20b.txt', { view: 'grid', sort: undefined })).toBe('/d/drive/b/home/a%20b.txt?view=grid');
    expect(explorerHref({ conn: 'drive', bucket: 'home', key: 'a//b', kind: 'file' }, { view: 'grid' })).toBe('/d/drive/b/home/~k?key=a%2F%2Fb&view=grid');
    expect(withSearch('/d/drive/b/home/?view=grid', { view: undefined })).toBe('/d/drive/b/home/');
  });
});

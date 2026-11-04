import { describe, expect, it } from 'vitest';
import { folderIdentity, isRepresentable, parse, toPath } from './keyCodec';
import { parseSearchStrings, stringifySearchStrings } from './search';
import { PARSE_VECTORS, ROUND_TRIP_VECTORS } from './vectors';

const BASE = '/d/c/b/bk/';

function split(href: string): [string, string] {
  const i = href.indexOf('?');
  return i < 0 ? [href, ''] : [href.slice(0, i), href.slice(i)];
}

describe('keyCodec — annexe A', () => {
  it.each(ROUND_TRIP_VECTORS)('$id : toPath et parse', ({ key, kind, path }) => {
    const href = toPath({ conn: 'c', bucket: 'bk', key, kind });
    expect(href).toBe(BASE + path);
    const [pathname, search] = split(href);
    expect(parse(pathname, search)).toEqual({ conn: 'c', bucket: 'bk', key, kind });
  });

  it.each(PARSE_VECTORS)('$id : lecture d’une entrée saisie', ({ path, expected }) => {
    const [pathname, search] = split(BASE + path);
    const result = parse(pathname, search);
    if (expected === 'malformed') expect(result).toEqual({ error: 'malformed' });
    else expect(result).toEqual({ conn: 'c', bucket: 'bk', ...expected });
  });

  it('1 024 octets UTF-8 tiennent en 3 072 caractères et reviennent intacts', () => {
    const key = `${'é'.repeat(201)}/${'€'.repeat(207)}`;
    expect(new TextEncoder().encode(key).length).toBe(1024);
    const href = toPath({ conn: 'c', bucket: 'bk', key, kind: 'file' });
    expect(href.length - BASE.length).toBeLessThanOrEqual(3072);
    expect(parse(href)).toMatchObject({ key, kind: 'file' });
  });

  it('bucket encodé comme un segment', () => {
    expect(toPath({ conn: 'c', bucket: 'Legacy_Bucket', key: '', kind: 'root' })).toBe('/d/c/b/Legacy_Bucket/');
    expect(toPath({ conn: 'c', bucket: 'my.bucket', key: '', kind: 'root' })).toBe('/d/c/b/my.bucket/');
    expect(parse('/d/c/b/my.bucket/')).toEqual({ conn: 'c', bucket: 'my.bucket', key: '', kind: 'root' });
  });

  it('racine sans / final lue comme racine (la route redirige)', () => {
    expect(parse('/d/c/b/bk')).toEqual({ conn: 'c', bucket: 'bk', key: '', kind: 'root' });
  });

  it('version : ajoutée aux fichiers seulement, "null" gardé en chaîne', () => {
    const href = toPath({ conn: 'c', bucket: 'bk', key: 'a b', kind: 'file', version: 'null' });
    expect(href).toBe('/d/c/b/bk/a%20b?version=null');
    expect(parse(...split(href))).toEqual({ conn: 'c', bucket: 'bk', key: 'a b', kind: 'file', version: 'null' });
    const fallback = toPath({ conn: 'c', bucket: 'bk', key: 'a/', kind: 'file', version: 'v1' });
    expect(fallback).toBe('/d/c/b/bk/~k?key=a%2F&object=1&version=v1');
  });

  it('cas limites', () => {
    expect(parse('/x/c/b/bk/a')).toEqual({ error: 'malformed' });
    expect(parse('/d/c/b/bk/~k')).toEqual({ error: 'malformed' });
    expect(isRepresentable('a/./', 'folder')).toBe(false);
    expect(isRepresentable('a/b/', 'folder')).toBe(true);
    expect(() => toPath({ conn: 'c', bucket: 'bk', key: 'a', kind: 'folder' })).toThrow();
    expect(folderIdentity('c', 'bk', 'a/')).not.toBe(folderIdentity('c', 'bk/a', ''));
  });
});

describe('parseSearchStrings / stringifySearchStrings', () => {
  it('garde chaque valeur en chaîne, première valeur répétée', () => {
    expect(parseSearchStrings('?q=2024&q=x&n=1e3&version=null&focus=007&b=true')).toEqual({
      q: '2024',
      n: '1e3',
      version: 'null',
      focus: '007',
      b: 'true',
    });
  });

  it('omet undefined et null, convertit le reste par String()', () => {
    expect(stringifySearchStrings({ a: undefined, b: null, c: 1, d: 'x y' })).toBe('?c=1&d=x+y');
    expect(stringifySearchStrings({})).toBe('');
  });
});

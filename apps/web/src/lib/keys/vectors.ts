import type { ExplorerKind } from './keyCodec';

/*
 * Vecteurs de référence de l'encodage des clés (chemins après /d/c/b/bk/).
 * À exporter en JSON par @ud/contracts quand keyCodec y migrera.
 */

export interface KeyVector {
  id: string;
  key: string;
  kind: ExplorerKind;
  /** Chemin attendu après la base du bucket. */
  path: string;
}

/** Aller-retour exact : toPath(key) === path et parse(path) === key. */
export const ROUND_TRIP_VECTORS: KeyVector[] = [
  { id: 'A1', key: 'photos/été 2024/a b.jpg', kind: 'file', path: 'photos/%C3%A9t%C3%A9%202024/a%20b.jpg' },
  { id: 'A2', key: 'rapports/', kind: 'folder', path: 'rapports/' },
  { id: 'A3', key: 'a#b?c.txt', kind: 'file', path: 'a%23b%3Fc.txt' },
  { id: 'A4', key: '100%.txt', kind: 'file', path: '100%25.txt' },
  { id: 'A5', key: 'a%2Fb', kind: 'file', path: 'a%252Fb' },
  { id: 'A6', key: 'c++/x+y.md', kind: 'file', path: 'c%2B%2B/x%2By.md' },
  { id: 'A7', key: '~k', kind: 'file', path: '%7Ek' },
  { id: 'A8', key: '~notes/a', kind: 'file', path: '%7Enotes/a' },
  { id: 'A9', key: 'a/~b', kind: 'file', path: 'a/~b' },
  { id: 'A10', key: 'a//b', kind: 'file', path: '~k?key=a%2F%2Fb' },
  { id: 'A11a', key: './x', kind: 'file', path: '~k?key=.%2Fx' },
  { id: 'A11b', key: 'a/../b', kind: 'file', path: '~k?key=a%2F..%2Fb' },
  { id: 'A11c', key: 'a/.', kind: 'file', path: '~k?key=a%2F.' },
  { id: 'A12', key: '/abs', kind: 'file', path: '~k?key=%2Fabs' },
  { id: 'A13', key: 'a\\b.txt', kind: 'file', path: 'a%5Cb.txt' },
  { id: 'A15', key: 'ctl\u0001.txt', kind: 'file', path: 'ctl%01.txt' },
  {
    id: 'A16',
    key: 'ملف/تقرير.pdf',
    kind: 'file',
    path: '%D9%85%D9%84%D9%81/%D8%AA%D9%82%D8%B1%D9%8A%D8%B1.pdf',
  },
  { id: 'A17', key: '👍/😀.png', kind: 'file', path: '%F0%9F%91%8D/%F0%9F%98%80.png' },
  { id: 'A18a', key: '.env', kind: 'file', path: '.env' },
  { id: 'A18b', key: '..hidden', kind: 'file', path: '..hidden' },
  { id: 'A19', key: 'a/', kind: 'folder', path: 'a/' },
  { id: 'A20a', key: 'dossier.', kind: 'file', path: 'dossier.' },
  { id: 'A20b', key: 'dossier ', kind: 'file', path: 'dossier%20' },
  { id: 'A21a', key: 'été.txt'.normalize('NFC'), kind: 'file', path: '%C3%A9t%C3%A9.txt' },
  { id: 'A21b', key: 'été.txt'.normalize('NFD'), kind: 'file', path: 'e%CC%81te%CC%81.txt' },
  { id: 'A22a', key: 'a', kind: 'file', path: 'a' },
  { id: 'A22b', key: 'a/', kind: 'folder', path: 'a/' },
  { id: 'A23', key: 'facture‮fdp.exe', kind: 'file', path: 'facture%E2%80%AEfdp.exe' },
  { id: 'A24', key: 'a/', kind: 'file', path: '~k?key=a%2F&object=1' },
  { id: 'A26', key: 'a+b', kind: 'file', path: 'a%2Bb' },
  { id: 'A33', key: 'a:b;c@d=e&f$g,h.txt', kind: 'file', path: 'a%3Ab%3Bc%40d%3De%26f%24g%2Ch.txt' },
  { id: 'A34', key: "l'été (1)!*.txt", kind: 'file', path: "l'%C3%A9t%C3%A9%20(1)!*.txt" },
  { id: 'A35a', key: '/', kind: 'folder', path: '~k?key=%2F' },
  { id: 'A35b', key: '/', kind: 'file', path: '~k?key=%2F&object=1' },
];

/** Entrées lues seulement (saisies à la main) : chemin brut → clé ou `malformed`. */
export interface ParseVector {
  id: string;
  path: string;
  expected: { key: string; kind: ExplorerKind } | 'malformed';
}

export const PARSE_VECTORS: ParseVector[] = [
  { id: 'A26', path: '~k?key=a+b', expected: { key: 'a b', kind: 'file' } },
  { id: 'A27', path: '%E9t%E9.txt', expected: 'malformed' },
  { id: 'A28a', path: '100%.txt', expected: 'malformed' },
  { id: 'A28b', path: '%ZZ', expected: 'malformed' },
  { id: 'A29', path: '%c3%a9.txt', expected: { key: 'é.txt', kind: 'file' } },
];

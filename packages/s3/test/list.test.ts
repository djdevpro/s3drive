import { describe, expect, it } from 'vitest';
import { contentDisposition, copySource, decodeCursor, encodeCursor, nameOf, S3Error, transformListPage } from '../src/index.js';
import { decodeS3Value, protectDotSegments, quoteEtag, stripEtag, toListPage } from '../src/list.js';

describe('transformListPage', () => {
  const date = new Date('2026-11-03T10:00:00Z');

  it('dossiers d’abord, fichiers ensuite ; marqueur du dossier listé masqué', () => {
    const result = transformListPage(
      {
        EncodingType: 'url',
        CommonPrefixes: [{ Prefix: 'docs/b%20b/' }, { Prefix: 'docs/a/' }],
        Contents: [
          { Key: 'docs/', Size: 0, LastModified: date, ETag: '"d41d8cd98f00b204e9800998ecf8427e"' },
          { Key: 'docs/r%C3%A9sum%C3%A9+final.pdf', Size: 12, LastModified: date, ETag: '"abc"', StorageClass: 'STANDARD' },
          { Key: 'docs/plus%2Bsign.txt', Size: 3, LastModified: date, ETag: '"def-2"' },
        ],
      },
      { prefix: 'docs/', delimited: true },
    );
    expect(result.folderMarker).toBe(true);
    const page = toListPage(result, 'TOKEN');
    expect(page.items.map((item) => item.type)).toEqual(['folder', 'folder', 'file', 'file']);
    expect(page.items[0]).toEqual({ type: 'folder', key: 'docs/b b/', name: 'b b' });
    expect(page.items[2]).toEqual({
      type: 'file',
      key: 'docs/résumé final.pdf',
      name: 'résumé final.pdf',
      size: 12,
      lastModified: '2026-11-03T10:00:00.000Z',
      etag: 'abc',
      storageClass: 'STANDARD',
    });
    expect(page.items[3]).toMatchObject({ key: 'docs/plus+sign.txt', etag: 'def-2' });
    expect(page.folderMarker).toBe(true);
    expect(decodeCursor(page.nextCursor!)).toBe('TOKEN');
  });

  it('ne masque pas .universal-drive/ (le serveur s’en charge)', () => {
    const result = transformListPage({ CommonPrefixes: [{ Prefix: '.universal-drive/' }] }, { prefix: '', delimited: true });
    expect(result.folders).toEqual([{ type: 'folder', key: '.universal-drive/', name: '.universal-drive' }]);
  });

  it('liste récursive : un marqueur vide devient un dossier, un marqueur non vide reste un fichier', () => {
    const result = transformListPage(
      {
        Contents: [
          { Key: 'a/', Size: 0 },
          { Key: 'a/b/', Size: 0 },
          { Key: 'a/odd/', Size: 4 },
          { Key: 'a/b/c.txt', Size: 1 },
        ],
      },
      { prefix: 'a/', delimited: false },
    );
    expect(result.folderMarker).toBe(true);
    expect(result.folders.map((f) => f.key)).toEqual(['a/b/']);
    expect(result.files.map((f) => f.key)).toEqual(['a/odd/', 'a/b/c.txt']);
  });

  it('fin de liste : nextCursor null', () => {
    expect(toListPage({ folders: [], files: [], folderMarker: false }, undefined)).toEqual({ items: [], nextCursor: null });
  });

  it('nameOf, ETag', () => {
    expect(nameOf('a/b/c.txt')).toBe('c.txt');
    expect(nameOf('a/b/')).toBe('b');
    expect(nameOf('top')).toBe('top');
    expect(stripEtag('"abc"')).toBe('abc');
    expect(stripEtag('W/"abc"')).toBe('abc');
    expect(quoteEtag('abc')).toBe('"abc"');
    expect(quoteEtag('"abc"')).toBe('"abc"');
    expect(decodeS3Value('a+b%2Bc', true)).toBe('a b+c');
    expect(decodeS3Value('a+b', false)).toBe('a+b');
  });
});

describe('curseur opaque', () => {
  it('aller-retour, et refus d’un curseur altéré', () => {
    const cursor = encodeCursor('1/abc+def==');
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toBe('1/abc+def==');
    for (const bad of ['', 'not a cursor!', Buffer.from('x1:abc').toString('base64url'), encodeCursor('').slice(0, 3)]) {
      expect(() => decodeCursor(bad)).toThrow(S3Error);
    }
    try {
      decodeCursor('###');
    } catch (error) {
      expect((error as S3Error).code).toBe('validation');
      expect((error as S3Error).reason).toBe('invalid_cursor');
    }
  });
});

describe('encodages', () => {
  it('copySource encode segment par segment', () => {
    expect(copySource('b', 'a b/c+d%e#f.txt')).toBe('b/a%20b/c%2Bd%25e%23f.txt');
    expect(copySource('b', 'k', 'v 1')).toBe('b/k?versionId=v%201');
  });

  it('protectDotSegments encode . et ..', () => {
    expect(protectDotSegments('https://h/b/x/../y.txt?X-Amz-Expires=60')).toBe('https://h/b/x/%2E%2E/y.txt?X-Amz-Expires=60');
    expect(protectDotSegments('https://h/b/./y')).toBe('https://h/b/%2E/y');
    expect(protectDotSegments('https://h/b/a.b/y')).toBe('https://h/b/a.b/y');
  });

  it('contentDisposition selon RFC 6266 / 5987', () => {
    expect(contentDisposition('inline')).toBe('inline');
    expect(contentDisposition('attachment', 'report.pdf')).toBe('attachment; filename="report.pdf"');
    expect(contentDisposition('attachment', 'résumé été.pdf')).toBe(
      `attachment; filename="resume ete.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%C3%A9t%C3%A9.pdf`,
    );
    expect(contentDisposition('inline', 'تقرير.pdf')).toMatch(/^inline; filename="_____\.pdf"; filename\*=UTF-8''%D8/);
    expect(contentDisposition('attachment', 'a"b\\c\r\n.txt')).not.toMatch(/[\r\n]/);
    expect(contentDisposition('attachment', 'a"b.txt')).toContain('filename="a_b.txt"');
  });
});

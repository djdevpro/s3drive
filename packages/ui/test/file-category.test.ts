import { describe, expect, it } from 'vitest';
import { baseName, fileCategory, fileExtension, folderColorOf } from '../src/lib/file-category';

describe('fileCategory', () => {
  it.each([
    ['photo.png', 'image'],
    ['PHOTO.JPG', 'image'],
    ['clip.mov', 'video'],
    ['son.flac', 'audio'],
    ['rapport.pdf', 'pdf'],
    ['notes.md', 'text'],
    ['app.tsx', 'code'],
    ['script.bat', 'code'],
    ['budget.xlsx', 'sheet'],
    ['deck.pptx', 'slides'],
    ['lettre.docx', 'doc'],
    ['backup.zip', 'archive'],
    ['archive.tar.gz', 'archive'],
    ['police.woff2', 'font'],
    ['piece.stl', '3d'],
    ['setup.exe', 'exec'],
    ['a/b/c/data.json', 'code'],
    ['fichier.inconnu', 'unknown'],
    ['sans-extension', 'unknown'],
  ] as const)('%s → %s', (name, expected) => {
    expect(fileCategory(name)).toBe(expected);
  });

  it('noms complets connus, sans tenir compte de la casse', () => {
    expect(fileCategory('.env')).toBe('text');
    expect(fileCategory('projet/Dockerfile')).toBe('code');
    expect(fileCategory('README')).toBe('text');
    expect(fileCategory('makefile')).toBe('code');
  });

  it('extension d’abord, puis type MIME spécifique', () => {
    expect(fileCategory('notes.txt', 'image/png')).toBe('text');
    expect(fileCategory('photo', 'image/jpeg')).toBe('image');
    expect(fileCategory('doc.pdf', 'application/octet-stream')).toBe('pdf');
    expect(fileCategory('blob', 'application/octet-stream')).toBe('unknown');
    expect(fileCategory('lisez-moi', 'text/plain; charset=utf-8')).toBe('text');
    expect(fileCategory('tableau', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('sheet');
    expect(fileCategory('modele', 'model/gltf+json')).toBe('3d');
  });

  it('.ts : code, sauf flux MPEG (video/mp2t)', () => {
    expect(fileCategory('index.ts')).toBe('code');
    expect(fileCategory('segment.ts', 'video/mp2t')).toBe('video');
  });

  it('dossiers et buckets', () => {
    expect(fileCategory('Documents/')).toBe('folder');
    expect(fileCategory('Documents', null, { isFolder: true })).toBe('folder');
    expect(fileCategory('mon-bucket', null, { isBucket: true })).toBe('bucket');
  });

  it('cas limites : clé finissant par un point, nom commençant par un point', () => {
    expect(fileCategory('bizarre.')).toBe('unknown');
    expect(fileExtension('bizarre.')).toBe('');
    expect(fileExtension('.bashrc')).toBe('');
    expect(fileExtension('a.TAR.GZ')).toBe('tar.gz');
    expect(fileExtension('.tar.gz')).toBe('gz');
    expect(baseName('a/b/c.txt')).toBe('c.txt');
    expect(baseName('a/b/')).toBe('b');
  });

  it('couleurs de dossiers : id inconnu → neutral', () => {
    expect(folderColorOf('red')).toBe('red');
    expect(folderColorOf('fuchsia')).toBe('neutral');
    expect(folderColorOf(null)).toBe('neutral');
  });
});

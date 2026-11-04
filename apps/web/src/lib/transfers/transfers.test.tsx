// File d'envoi de l'appli : clés et dossiers, persistance et reprise, hooks, téléchargement.
import { act, renderHook, waitFor } from '@testing-library/react';
import { FakeNetwork, FakeUploadServer, MemoryUploadStore, deferred, sameBytes, testBytes } from '@ud/sdk/upload';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile, fromEntries, hasIndexedDb, useUploadPanel, useUploadQueue, UploadQueue } from '.';

const MIB = 1024 * 1024;
const queues: UploadQueue[] = [];

function makeQueue(server = new FakeUploadServer(), store = new MemoryUploadStore(), folders: string[] = []) {
  const transport = Object.assign(server, {
    createFolder: async (bucket: string, key: string) => {
      folders.push(`${bucket}:${key}`);
    },
  });
  const queue = new UploadQueue({
    connection: 'drive',
    transport,
    store,
    guardUnload: false,
    engine: { sender: server.sender, confirmDelayMs: 0, progressIntervalMs: 0, multipartThreshold: 8 * MIB, sleep: async () => {}, network: new FakeNetwork(), concurrency: 1 },
  });
  queues.push(queue);
  return { queue, server, store, folders };
}

afterEach(() => {
  for (const q of queues.splice(0)) q.dispose();
});

function file(data: Uint8Array<ArrayBuffer>, name: string, relPath?: string, lastModified = 1_700_000_000_000): File {
  const f = new File([data], name, { lastModified });
  if (relPath) Object.defineProperty(f, 'webkitRelativePath', { value: relPath });
  return f;
}

/** Arborescence factice de `webkitGetAsEntry` ; `readEntries` rend les enfants par lots de 2. */
function dirEntry(name: string, children: FileSystemEntry[]): FileSystemEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
          const batch = children.slice(offset, offset + 2);
          offset += 2;
          setTimeout(() => ok(batch), 0);
        },
      };
    },
  } as unknown as FileSystemEntry;
}

function fileEntry(f: File): FileSystemEntry {
  return { name: f.name, isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(f) } as unknown as FileSystemEntry;
}

describe('file d’envoi', () => {
  it('jsdom sans IndexedDB : persistance mémoire', () => {
    expect(hasIndexedDb()).toBe(false);
  });

  it('fichiers isolés vers un dossier : clés relatives, NFC', async () => {
    const { queue, server } = makeQueue();
    const data = testBytes(100);
    queue.addFiles([file(data, 'été.txt')], { bucket: 'home', prefix: 'Docs/' });
    await queue.engine.whenIdle();
    expect(queue.getSnapshot().items[0]).toMatchObject({ state: 'done', key: 'Docs/été.txt', name: 'été.txt' });
    expect(sameBytes(server.object('home', 'Docs/été.txt'), data)).toBe(true);
  });

  it('sélecteur de dossier : arborescence, fichiers système ignorés, un groupe', async () => {
    const { queue, server } = makeQueue();
    const files = [file(testBytes(3), 'a.jpg', 'Photos/2024/a.jpg'), file(testBytes(4), 'b.jpg', 'Photos/b.jpg'), file(testBytes(1), '.DS_Store', 'Photos/.DS_Store')];
    const result = await queue.addFolderInput(files, { bucket: 'home', prefix: '' });
    await queue.engine.whenIdle();
    expect(result.ignored).toBe(1);
    expect(result.groups).toHaveLength(1);
    const items = queue.getSnapshot().items;
    expect(items.map((i) => i.key).sort()).toEqual(['Photos/2024/a.jpg', 'Photos/b.jpg']);
    expect(new Set(items.map((i) => i.groupId)).size).toBe(1);
    expect(server.object('home', 'Photos/2024/a.jpg')?.length).toBe(3);
  });

  it('glisser-déposer : parcours récursif par lots, dossier vide marqué, fichiers à plat', async () => {
    const folders: string[] = [];
    const { queue } = makeQueue(new FakeUploadServer(), new MemoryUploadStore(), folders);
    const tree = dirEntry('Projet', [
      fileEntry(file(testBytes(1), 'un.txt')),
      fileEntry(file(testBytes(2), 'deux.txt')),
      fileEntry(file(testBytes(3), 'trois.txt')),
      dirEntry('vide', []),
      dirEntry('src', [fileEntry(file(testBytes(4), 'main.ts'))]),
    ]);
    const enumeration = await fromEntries([tree]);
    expect(enumeration.files.map((f) => f.relPath).sort()).toEqual(['Projet/deux.txt', 'Projet/src/main.ts', 'Projet/trois.txt', 'Projet/un.txt']);
    const result = await queue.addEntries([tree], { bucket: 'home', prefix: 'Travail/' }, {}, [file(testBytes(5), 'seul.txt')]);
    await queue.engine.whenIdle();
    expect(result.emptyFolders).toEqual(['Projet/vide/']);
    expect(folders).toEqual(['home:Travail/Projet/vide/']);
    expect(queue.getSnapshot().items.map((i) => i.key).sort()).toEqual(['Travail/Projet/deux.txt', 'Travail/Projet/src/main.ts', 'Travail/Projet/trois.txt', 'Travail/Projet/un.txt', 'Travail/seul.txt']);
    expect(queue.getSnapshot().items.every((i) => i.state === 'done')).toBe(true);
  });

  it('persistance et reprise au rechargement : needs_file, resélection appariée, parties manquantes seules', async () => {
    const server = new FakeUploadServer();
    const store = new MemoryUploadStore();
    const data = testBytes(11 * MIB, 7);
    const big = file(data, 'video.mp4', 'Films/video.mp4');
    const started = deferred();
    server.fault = async (request, target) => {
      if (target.partNumber !== 2) return undefined;
      started.resolve();
      await new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      return undefined;
    };
    const first = makeQueue(server, store).queue;
    await first.addFolderInput([big], { bucket: 'home', prefix: '' });
    await started.promise;
    await first.engine.flush();
    first.dispose(); // rechargement de l'onglet

    server.fault = null;
    server.sent.length = 0;
    const second = makeQueue(server, store).queue;
    await second.ready;
    const [restored] = second.getSnapshot().items;
    expect(restored).toMatchObject({ state: 'needs_file', key: 'Films/video.mp4', relPath: 'Films/video.mp4', sent: 5 * MIB });
    const other = file(testBytes(10), 'autre.txt');
    const result = second.reselect([other, big]);
    expect(result.matched).toEqual([restored!.id]);
    expect(result.unmatched).toEqual([other]);
    await second.engine.whenIdle();
    expect(second.item(restored!.id)!.state).toBe('done');
    expect(server.sent.map((s) => s.partNumber)).toEqual([2, 3]);
    expect(sameBytes(server.object('home', 'Films/video.mp4'), data)).toBe(true);
  });

  it('quota : erreur gardée avec le reste disponible', async () => {
    const server = new FakeUploadServer();
    server.remaining = 10;
    const { queue } = makeQueue(server);
    queue.addFiles([file(testBytes(50), 'gros.bin')], { bucket: 'home', prefix: '' });
    await queue.engine.whenIdle();
    expect(queue.getSnapshot().items[0]!.error).toMatchObject({ code: 'quota_exceeded', details: { remaining: 10 } });
  });
});

describe('hooks', () => {
  it('useUploadQueue : ajout, état, actions', async () => {
    const { queue } = makeQueue();
    const { result } = renderHook(() => useUploadQueue('drive', queue));
    expect(result.current.items).toEqual([]);
    act(() => {
      result.current.addFiles([file(testBytes(10), 'a.txt')], { bucket: 'home', prefix: '' });
    });
    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'));
    expect(result.current.totals.done).toBe(1);
    await act(() => result.current.clearFinished());
    await waitFor(() => expect(result.current.items).toEqual([]));
  });

  it('useUploadPanel : lignes du panneau et callbacks branchés', async () => {
    const server = new FakeUploadServer();
    server.objects.set('home/a.txt', new Uint8Array([1]));
    const { queue } = makeQueue(server);
    const shown = vi.fn();
    const { result } = renderHook(() => useUploadPanel('drive', { folderLabel: () => 'Mon drive', onShowInFolder: shown }, queue));
    act(() => {
      queue.addFiles([file(testBytes(10), 'a.txt')], { bucket: 'home', prefix: '' });
    });
    await waitFor(() => expect(result.current.items[0]?.state).toBe('conflict'));
    expect(result.current.items[0]).toMatchObject({ name: 'a.txt', folder: 'Mon drive', size: 10 });
    act(() => result.current.onResolveConflict!(result.current.items[0]!.id, 'rename'));
    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'));
    act(() => result.current.onShowInFolder!(result.current.items[0]!.id));
    expect(shown).toHaveBeenCalledWith(expect.objectContaining({ key: 'a (1).txt' }));
  });
});

describe('téléchargement', () => {
  it('downloadFile : route download, nom par défaut, ouverture par lien', async () => {
    const download = vi.fn(async () => ({ url: 'https://s3.test/obj?X-Amz-Signature=x', expiresAt: '2026-11-03T12:00:00Z', transport: 'direct' as const }));
    const open = vi.fn();
    await downloadFile('drive', 'home', 'Docs/rapport final.pdf', { transport: { download }, open });
    expect(download).toHaveBeenCalledWith('home', 'Docs/rapport final.pdf', { filename: 'rapport final.pdf' });
    expect(open).toHaveBeenCalledWith('https://s3.test/obj?X-Amz-Signature=x', 'rapport final.pdf');
  });
});

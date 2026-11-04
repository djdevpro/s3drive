// Moteur d'envoi contre un faux serveur.
import { describe, expect, it } from 'vitest';
import {
  FakeNetwork,
  FakeUploadServer,
  MemoryUploadStore,
  UploadEngine,
  UploadError,
  deferred,
  sameBytes,
  testBytes,
  testFile,
  type UploadEngineOptions,
  type UploadSnapshot,
} from '../src/upload.js';

const MIB = 1024 * 1024;

function setup(options: Partial<UploadEngineOptions> = {}, server = new FakeUploadServer()) {
  const store = (options.store as MemoryUploadStore | undefined) ?? new MemoryUploadStore();
  const delays: number[] = [];
  const engine = new UploadEngine({
    transport: server,
    sender: server.sender,
    store,
    confirmDelayMs: 0,
    progressIntervalMs: 0,
    multipartThreshold: 8 * MIB,
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 1,
    network: new FakeNetwork(),
    ...options,
  });
  return { engine, server, store, delays };
}

describe('envois simples et multipart', () => {
  it('petit fichier : PUT simple, longueur signée, confirmation, terminé', async () => {
    const { engine, server } = setup();
    const data = testBytes(1000);
    const [id] = engine.add([{ file: testFile(data), bucket: 'home', key: 'docs/a.txt' }]);
    await engine.whenIdle();
    const item = engine.get(id!)!;
    expect(item.state).toBe('done');
    expect(item.mode).toBe('single');
    expect(item.sent).toBe(1000);
    expect(sameBytes(server.object('home', 'docs/a.txt'), data)).toBe(true);
    expect(server.calls).toEqual(['create docs/a.txt single fail', 'confirm 1']);
  });

  it('fichier vide : PUT simple au corps vide', async () => {
    const { engine, server } = setup();
    const [id] = engine.add([{ file: testFile(new Uint8Array(0)), bucket: 'home', key: 'vide.txt' }]);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
    expect(server.object('home', 'vide.txt')?.length).toBe(0);
  });

  it('gros fichier : multipart, parties de taille fixe sauf la dernière, progression monotone', async () => {
    const { engine, server } = setup({ concurrency: 2 });
    const data = testBytes(12 * MIB + 123);
    const seen: number[] = [];
    engine.subscribe((snap: UploadSnapshot) => seen.push(snap.items[0]?.sent ?? 0));
    const [id] = engine.add([{ file: testFile(data), bucket: 'home', key: 'gros.bin', conflict: 'overwrite' }]);
    await engine.whenIdle();
    const item = engine.get(id!)!;
    expect(item.state).toBe('done');
    expect(item.mode).toBe('multipart');
    expect(item.result?.size).toBe(data.length);
    expect(server.sent.map((s) => s.size).sort((a, b) => a - b)).toEqual([2 * MIB + 123, 5 * MIB, 5 * MIB]);
    expect(sameBytes(server.object('home', 'gros.bin'), data)).toBe(true);
    // Premières URL reçues à la création (2), la troisième signée à part.
    expect(server.calls).toContain('sign 3');
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(engine.getSnapshot().totals).toMatchObject({ done: 1, active: 0, bytes: data.length, sent: data.length });
  });

  it('les en-têtes signés partent tels quels', async () => {
    const server = new FakeUploadServer();
    const headers: Array<Record<string, string>> = [];
    server.fault = (request) => {
      headers.push(request.headers);
      return undefined;
    };
    const { engine } = setup({}, server);
    engine.add([{ file: testFile(testBytes(10)), bucket: 'home', key: 'h.txt' }]);
    await engine.whenIdle();
    expect(headers).toEqual([{ 'content-length': '10' }]);
  });

  it('le mode vient de la taille et le serveur peut imposer le PUT simple', async () => {
    const server = new FakeUploadServer();
    const original = server.create.bind(server);
    server.create = (input) => original({ ...input, mode: 'single' });
    const { engine } = setup({}, server);
    const [id] = engine.add([{ file: testFile(testBytes(9 * MIB)), bucket: 'home', key: 'force-simple.bin' }]);
    await engine.whenIdle();
    expect(server.calls[0]).toBe('create force-simple.bin single fail');
    expect(engine.get(id!)!.mode).toBe('single');
    expect(engine.get(id!)!.state).toBe('done');
  });
});

describe('erreurs et nouveaux essais', () => {
  it('erreur réseau puis succès : recul exponentiel à gigue complète', async () => {
    const server = new FakeUploadServer();
    let failures = 2;
    server.fault = () => {
      if (failures-- > 0) throw new TypeError('fetch failed');
      return undefined;
    };
    const { engine, delays } = setup({}, server);
    const [id] = engine.add([{ file: testFile(testBytes(100)), bucket: 'home', key: 'r.txt' }]);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
    expect(delays).toEqual([1000, 2000]);
  });

  it('503 SlowDown avec Retry-After, puis succès', async () => {
    const server = new FakeUploadServer();
    let once = true;
    server.fault = () => {
      if (!once) return undefined;
      once = false;
      return { status: 503, etag: null, s3Code: 'SlowDown', retryAfterMs: 7000 };
    };
    const { engine, delays } = setup({}, server);
    const [id] = engine.add([{ file: testFile(testBytes(100)), bucket: 'home', key: 's.txt' }]);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
    expect(delays).toEqual([7000]);
  });

  it('5 échecs : état error réessayable, puis « Réessayer » repart des parties confirmées', async () => {
    const server = new FakeUploadServer();
    let failing = true;
    server.fault = (_r, target) => (failing && target.partNumber === 2 ? { status: 500, etag: null, s3Code: 'InternalError' } : undefined);
    const { engine, delays } = setup({ concurrency: 1 }, server);
    const [id] = engine.add([{ file: testFile(testBytes(11 * MIB)), bucket: 'home', key: 'e.bin' }]);
    await engine.whenIdle();
    const failed = engine.get(id!)!;
    expect(failed.state).toBe('error');
    expect(failed.error).toMatchObject({ code: 'upstream_error', retryable: true });
    expect(delays).toHaveLength(4);
    failing = false;
    server.sent.length = 0;
    engine.retry(id!);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
    // La partie 1, confirmée, n'est pas renvoyée.
    expect(server.sent.map((s) => s.partNumber).sort()).toEqual([2, 3]);
  });

  it('403 non expiré : erreur access_denied sans nouvel essai', async () => {
    const server = new FakeUploadServer();
    server.fault = () => ({ status: 403, etag: null, s3Code: 'AccessDenied' });
    const { engine, delays } = setup({}, server);
    const [id] = engine.add([{ file: testFile(testBytes(10)), bucket: 'home', key: 'd.txt' }]);
    await engine.whenIdle();
    expect(engine.get(id!)!.error).toMatchObject({ code: 'access_denied', retryable: false });
    expect(delays).toEqual([]);
  });

  it('URL expirée : nouvelle signature sans consommer d’essai', async () => {
    const server = new FakeUploadServer();
    let now = 1_000_000;
    server.clock = () => now;
    server.urlTtlMs = 120_000;
    let expiredOnce = true;
    server.fault = (_r, target) => {
      if (target.partNumber === 1 && expiredOnce) {
        expiredOnce = false;
        now += 100_000; // l'URL arrive à moins de 30 s de son échéance
        return { status: 403, etag: null, s3Code: 'AccessDenied' };
      }
      return undefined;
    };
    const { engine, delays } = setup({ now: () => now, concurrency: 1 }, server);
    const [id] = engine.add([{ file: testFile(testBytes(9 * MIB)), bucket: 'home', key: 'x.bin' }]);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
    expect(delays).toEqual([]);
    expect(server.calls.filter((c) => c.startsWith('sign'))[0]).toBe('sign 1,2');
  });

  it('quota dépassé : refus remonté avec details.remaining, sans aucun octet envoyé', async () => {
    const server = new FakeUploadServer();
    server.remaining = 4000;
    const { engine, delays } = setup({}, server);
    const [id] = engine.add([{ file: testFile(testBytes(5000)), bucket: 'home', key: 'q.bin' }]);
    await engine.whenIdle();
    const item = engine.get(id!)!;
    expect(item.state).toBe('error');
    expect(item.error).toEqual({ code: 'quota_exceeded', retryable: false, status: 403, details: { remaining: 4000, limit: 'user_quota' } });
    expect(server.sent).toEqual([]);
    expect(delays).toEqual([]);
  });

  it('clé invalide refusée avant tout appel', async () => {
    const { engine, server } = setup();
    const [id] = engine.add([{ file: testFile(testBytes(1)), bucket: 'home', key: 'a/../b.txt' }]);
    await engine.whenIdle();
    expect(engine.get(id!)!.error).toMatchObject({ code: 'validation', reason: 'key_dot_segment' });
    expect(server.calls).toEqual([]);
  });

  it('session expirée : waiting_auth, puis reprise', async () => {
    const server = new FakeUploadServer();
    let denied = true;
    server.createFault = () => (denied ? new UploadError({ code: 'unauthorized', status: 401 }) : undefined);
    const { engine } = setup({}, server);
    const [id] = engine.add([{ file: testFile(testBytes(10)), bucket: 'home', key: 'auth.txt' }]);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('waiting_auth');
    denied = false;
    engine.resumeAll();
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
  });

  it('hors ligne : waiting_network sans essai consommé, reprise au retour en ligne', async () => {
    const server = new FakeUploadServer();
    const network = new FakeNetwork();
    const reached = deferred();
    server.fault = () => {
      if (network.online) return undefined;
      reached.resolve();
      throw new TypeError('network down');
    };
    const { engine, delays } = setup({ network }, server);
    network.online = false;
    const [id] = engine.add([{ file: testFile(testBytes(10)), bucket: 'home', key: 'net.txt' }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.get(id!)!.state).toBe('waiting_network');
    network.set(true);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
    expect(delays).toEqual([]);
  });
});

describe('pause, annulation, reprise après rechargement', () => {
  /** Bloque la partie `blocked` jusqu'à `release`. */
  function blocking(server: FakeUploadServer, blocked: number) {
    const started = deferred();
    const release = deferred();
    server.fault = async (request, target) => {
      if (target.partNumber !== blocked) return undefined;
      started.resolve();
      await Promise.race([
        release.promise,
        new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
      ]);
      return undefined;
    };
    return { started, release };
  }

  it('reprise après « rechargement » : listParts adopte les parties déjà envoyées', async () => {
    const server = new FakeUploadServer();
    const store = new MemoryUploadStore();
    const data = testBytes(13 * MIB);
    const file = testFile(data);
    const gate = blocking(server, 2);
    const first = setup({ store, concurrency: 1 }, server).engine;
    const [id] = first.add([{ file, bucket: 'home', key: 'reprise.bin', source: { kind: 'handle', handle: 'poignée' } }]);
    await gate.started.promise;
    await first.flush();
    first.destroy(); // onglet fermé : rien n'est abandonné côté stockage
    const saved = (await store.list())[0]!;
    expect(saved.uploadId).toBeTruthy();
    expect(Object.keys(saved.parts)).toEqual(['1']);
    expect(JSON.stringify(saved)).not.toContain('fake://');

    server.fault = null;
    server.sent.length = 0;
    const second = setup({ store, concurrency: 1, resolveFile: async (r) => (r.source.kind === 'handle' ? file : null) }, server).engine;
    await second.restore();
    await second.whenIdle();
    const item = second.get(id!)!;
    expect(item.state).toBe('done');
    expect(server.calls).toContain('list');
    expect(server.sent.map((s) => s.partNumber)).toEqual([2, 3]);
    expect(sameBytes(server.object('home', 'reprise.bin'), data)).toBe(true);
  });

  it('sans fichier après rechargement : needs_file, puis nouvelle sélection appariée', async () => {
    const server = new FakeUploadServer();
    const store = new MemoryUploadStore();
    const data = testBytes(9 * MIB);
    const gate = blocking(server, 2);
    const first = setup({ store, concurrency: 1 }, server).engine;
    const [id] = first.add([{ file: testFile(data), bucket: 'home', key: 'resel.bin' }]);
    await gate.started.promise;
    await first.flush();
    first.destroy();
    server.fault = null;

    const second = setup({ store }, server).engine;
    await second.restore();
    expect(second.get(id!)!.state).toBe('needs_file');
    expect(second.attachFile(id!, testFile(testBytes(10)))).toBe(false);
    expect(second.attachFile(id!, testFile(data, 42))).toBe(false);
    expect(second.attachFile(id!, testFile(data))).toBe(true);
    await second.whenIdle();
    expect(second.get(id!)!.state).toBe('done');
  });

  it('envoi expiré côté stockage à la reprise : il recommence', async () => {
    const server = new FakeUploadServer();
    const store = new MemoryUploadStore();
    const data = testBytes(9 * MIB);
    const file = testFile(data);
    const gate = blocking(server, 2);
    const first = setup({ store, concurrency: 1 }, server).engine;
    const [id] = first.add([{ file, bucket: 'home', key: 'gone.bin' }]);
    await gate.started.promise;
    await first.flush();
    first.destroy();
    server.uploads.clear();
    server.fault = null;
    const second = setup({ store, resolveFile: async () => file }, server).engine;
    await second.restore();
    await second.whenIdle();
    expect(second.get(id!)!.state).toBe('done');
    expect(server.calls.filter((c) => c.startsWith('create'))).toHaveLength(2);
    expect(sameBytes(server.object('home', 'gone.bin'), data)).toBe(true);
  });

  it('confirmation perdue rejouée au démarrage sans le fichier', async () => {
    const server = new FakeUploadServer();
    const store = new MemoryUploadStore();
    const original = server.confirm.bind(server);
    const hold = deferred();
    server.confirm = async (bucket, items) => {
      await hold.promise;
      return original(bucket, items);
    };
    const first = setup({ store }, server).engine;
    const [id] = first.add([{ file: testFile(testBytes(10)), bucket: 'home', key: 'c.txt' }]);
    await new Promise((r) => setTimeout(r, 20));
    await first.flush();
    first.destroy();
    expect((await store.list())[0]).toMatchObject({ state: 'completing', receipt: expect.any(String) });
    server.confirm = original;
    const second = setup({ store }, server).engine;
    await second.restore();
    await second.whenIdle();
    expect(second.get(id!)!.state).toBe('done');
    hold.resolve();
  });

  it('pause puis reprise : seules les parties manquantes partent', async () => {
    const server = new FakeUploadServer();
    const gate = blocking(server, 2);
    const { engine } = setup({ concurrency: 1 }, server);
    const [id] = engine.add([{ file: testFile(testBytes(11 * MIB)), bucket: 'home', key: 'p.bin' }]);
    await gate.started.promise;
    engine.pause(id!);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('paused');
    server.fault = null;
    server.sent.length = 0;
    engine.resume(id!);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('done');
    expect(server.sent.map((s) => s.partNumber)).toEqual([2, 3]);
  });

  it('annulation : abandon côté stockage et enregistrement supprimé', async () => {
    const server = new FakeUploadServer();
    const gate = blocking(server, 2);
    const { engine, store } = setup({ concurrency: 1 }, server);
    const [id] = engine.add([{ file: testFile(testBytes(11 * MIB)), bucket: 'home', key: 'annule.bin' }]);
    await gate.started.promise;
    await engine.cancel(id!);
    await engine.whenIdle();
    expect(engine.get(id!)!.state).toBe('canceled');
    expect(server.calls).toContain('abort');
    expect(server.uploads.size).toBe(0);
    expect(store.size).toBe(0);
    expect(server.object('home', 'annule.bin')).toBeUndefined();
  });

  it('effacer les terminés', async () => {
    const { engine, store } = setup();
    engine.add([{ file: testFile(testBytes(1)), bucket: 'home', key: 'f1' }]);
    await engine.whenIdle();
    await engine.flush();
    expect(store.size).toBe(1);
    await engine.clearFinished();
    expect(engine.getSnapshot().items).toEqual([]);
    expect(store.size).toBe(0);
  });
});

describe('conflits de noms', () => {
  async function withExisting(choice: 'ask' | 'overwrite' | 'rename' | 'skip') {
    const server = new FakeUploadServer();
    server.objects.set('home/docs/rapport.pdf', new Uint8Array([1]));
    server.objects.set('home/docs/rapport (1).pdf', new Uint8Array([2]));
    const { engine } = setup({}, server);
    const [id] = engine.add([{ file: testFile(testBytes(5)), bucket: 'home', key: 'docs/rapport.pdf', conflict: choice }]);
    await engine.whenIdle();
    return { engine, server, id: id! };
  }

  it('ask : état conflict, puis « Conserver les deux »', async () => {
    const { engine, server, id } = await withExisting('ask');
    expect(engine.get(id)!).toMatchObject({ state: 'conflict', error: { code: 'already_exists', details: { existingKey: 'docs/rapport.pdf' } } });
    engine.resolveConflict(id, 'rename');
    await engine.whenIdle();
    expect(engine.get(id)!).toMatchObject({ state: 'done', key: 'docs/rapport (2).pdf', name: 'rapport (2).pdf' });
    expect(server.object('home', 'docs/rapport.pdf')).toEqual(new Uint8Array([1]));
  });

  it('ask puis « Remplacer » ; « Appliquer à tous »', async () => {
    const server = new FakeUploadServer();
    server.objects.set('home/a', new Uint8Array([1]));
    server.objects.set('home/b', new Uint8Array([1]));
    const { engine } = setup({}, server);
    const ids = engine.add([
      { file: testFile(testBytes(3)), bucket: 'home', key: 'a' },
      { file: testFile(testBytes(3)), bucket: 'home', key: 'b' },
    ]);
    await engine.whenIdle();
    expect(ids.map((i) => engine.get(i)!.state)).toEqual(['conflict', 'conflict']);
    engine.resolveConflict(ids[0]!, 'overwrite', true);
    await engine.whenIdle();
    expect(ids.map((i) => engine.get(i)!.state)).toEqual(['done', 'done']);
    expect(server.object('home', 'a')?.length).toBe(3);
  });

  it('rename direct et skip', async () => {
    const renamed = await withExisting('rename');
    expect(renamed.engine.get(renamed.id)!.key).toBe('docs/rapport (2).pdf');
    const skipped = await withExisting('skip');
    expect(skipped.engine.get(skipped.id)!.state).toBe('skipped');
    expect(skipped.server.sent).toEqual([]);
    const overwritten = await withExisting('overwrite');
    expect(overwritten.server.object('home', 'docs/rapport.pdf')?.length).toBe(5);
  });
});

describe('concurrence', () => {
  it('au plus `concurrency` requêtes de données à la fois, 3 multipart ouverts', async () => {
    const server = new FakeUploadServer();
    let inFlight = 0;
    let peak = 0;
    server.fault = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      return undefined;
    };
    const { engine } = setup({ concurrency: 3 }, server);
    const ids = engine.add(Array.from({ length: 5 }, (_, i) => ({ file: testFile(testBytes(11 * MIB, i + 1)), bucket: 'home', key: `m${i}.bin` })));
    await engine.whenIdle();
    expect(ids.every((id) => engine.get(id)!.state === 'done')).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

import { HOME_SPACE } from '@ud/contracts';
import { homeRoot } from './keys.js';
import type { InstanceRuntime } from './runtime.js';

// Opérations système du mode instance : nettoyage (envois abandonnés, sessions, journaux) et recalcul de l'usage.

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const RECOUNT_INTERVAL_MS = 24 * 3600 * 1000;

/** Recalcule l'usage du drive personnel d'une personne (somme d'une liste du préfixe réel). */
export async function recountHome(rt: InstanceRuntime, userId: string): Promise<{ bytes: number; objects: number }> {
  const space = rt.config.spaces.find((s) => s.id === HOME_SPACE)!;
  const sum = await rt.storages.get(space.storage).sumPrefix({ bucket: space.bucket, prefix: homeRoot(space, userId) });
  rt.usage.set(HOME_SPACE, userId, sum.bytes, sum.objects);
  return sum;
}

export async function recountShared(rt: InstanceRuntime, spaceId: string): Promise<{ bytes: number; objects: number }> {
  const space = rt.config.spaces.find((s) => s.id === spaceId && s.id !== HOME_SPACE);
  if (!space) throw new Error(`Unknown shared space ${spaceId}`);
  const sum = await rt.storages.get(space.storage).sumPrefix({ bucket: space.bucket, prefix: space.prefix });
  rt.usage.set(spaceId, '', sum.bytes, sum.objects);
  return sum;
}

/** Recalcul complet (quotidien) : chaque personne active et chaque espace partagé. */
export async function recountAll(rt: InstanceRuntime): Promise<void> {
  for (const user of rt.users.all()) {
    try {
      await recountHome(rt, user.id);
    } catch {
      console.warn('usage recount failed', { space: HOME_SPACE });
    }
  }
  for (const space of rt.config.spaces) {
    if (space.id === HOME_SPACE) continue;
    try {
      await recountShared(rt, space.id);
    } catch {
      console.warn('usage recount failed', { space: space.id });
    }
  }
}

/** Libère les réservations échues (annule le multipart) et purge sessions et journaux. */
export async function cleanup(rt: InstanceRuntime): Promise<void> {
  for (const reservation of rt.usage.expired()) {
    if (reservation.upload_id) {
      const space = rt.config.spaces.find((s) => s.id === reservation.space_id);
      if (space) {
        const root = space.id === HOME_SPACE ? homeRoot(space, reservation.owner_id) : space.prefix;
        await rt.storages
          .get(space.storage)
          .abortMultipart({ bucket: space.bucket, key: root + reservation.key, uploadId: reservation.upload_id })
          .catch(() => {});
      }
    }
    rt.usage.release(reservation);
  }
  rt.usage.resyncReserved();
  rt.sessions.purgeExpired();
  rt.db.prepare('DELETE FROM upload_log WHERE at < ?').run(rt.clock() - rt.config.legal.uploadLogDays * 86_400_000);
  rt.audit.purge(rt.env.UD_AUDIT_RETENTION_DAYS);
}

/** Démarre les minuteurs (non bloquants pour l'arrêt du processus) ; renvoie la fonction d'arrêt. */
export function startMaintenance(rt: InstanceRuntime): () => void {
  const run = (task: () => Promise<void>, name: string) => () => {
    task().catch(() => console.warn('maintenance task failed', { task: name }));
  };
  const cleanupTimer = setInterval(run(() => cleanup(rt), 'cleanup'), CLEANUP_INTERVAL_MS);
  const recountTimer = setInterval(run(() => recountAll(rt), 'recount'), RECOUNT_INTERVAL_MS);
  cleanupTimer.unref();
  recountTimer.unref();
  return () => {
    clearInterval(cleanupTimer);
    clearInterval(recountTimer);
  };
}

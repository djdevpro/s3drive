import { DriveApiError } from '../../lib/api/client';

// Formats et erreurs de la console d'administration.

/** Unités de la dérogation de quota (base 1000). */
export const QUOTA_UNITS = [
  { id: 'MB', bytes: 1e6 },
  { id: 'GB', bytes: 1e9 },
  { id: 'TB', bytes: 1e12 },
] as const;
export type QuotaUnit = (typeof QUOTA_UNITS)[number]['id'];

/** Plus grande unité qui exprime la valeur sans perte notable (≥ 1). */
export function splitQuota(bytes: number): { value: string; unit: QuotaUnit } {
  for (const unit of [...QUOTA_UNITS].reverse()) {
    if (bytes >= unit.bytes) return { value: String(Math.round((bytes / unit.bytes) * 1000) / 1000), unit: unit.id };
  }
  return { value: String(Math.round((bytes / 1e6) * 1000) / 1000), unit: 'MB' };
}

/** Octets d'une saisie (« 2,5 » ou « 2.5 ») ; `null` si invalide ou nulle. */
export function parseQuota(value: string, unit: QuotaUnit): number | null {
  const n = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const factor = QUOTA_UNITS.find((u) => u.id === unit)?.bytes ?? 1e9;
  const bytes = Math.round(n * factor);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** Clé i18n (`admin:errors.*`) d'un refus de l'administration. */
export function adminErrorKey(error: unknown): string {
  if (error instanceof DriveApiError) {
    if (error.reason === 'self') return 'errors.self';
    if (error.reason === 'super_admin') return 'errors.superAdmin';
    if (error.reason === 'admin_permission' || error.code === 'forbidden' || error.code === 'scope_denied') return 'errors.permission';
    if (error.code === 'not_found') return 'errors.notFound';
    if (error.code === 'validation') return 'errors.validation';
    if (error.code === 'local.network') return 'errors.network';
  }
  return 'errors.generic';
}

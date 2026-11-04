/*
 * Règles de nom : renommer et nouveau dossier. Nom normalisé en NFC.
 * Erreur = refus ; avertissement = autorisé avec un message.
 */

export interface NameCheck {
  /** Nom normalisé (NFC). */
  value: string;
  error?: 'empty' | 'slash' | 'dots' | 'tooLong' | 'control';
  warning?: 'trailing' | 'bidi';
  /** Octets en trop pour `tooLong`. */
  excess?: number;
  /** Nouveau dossier : niveaux créés par des `/`. */
  levels?: number;
}

const MAX_KEY_BYTES = 1024;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const BIDI = /[‪-‮⁦-⁩‎‏؜​-‍﻿]/;

const encoder = new TextEncoder();
export const utf8Bytes = (text: string) => encoder.encode(text).length;

export function checkName(raw: string, options: { prefix: string; isFolder: boolean; allowSlash?: boolean }): NameCheck {
  const value = raw.normalize('NFC');
  if (value.trim() === '') return { value, error: 'empty' };
  const segments = options.allowSlash ? value.replace(/\/+$/, '').split('/') : [value];
  if (!options.allowSlash && value.includes('/')) return { value, error: 'slash' };
  if (segments.some((s) => s === '.' || s === '..')) return { value, error: 'dots' };
  if (options.allowSlash && segments.some((s) => s.trim() === '')) return { value, error: 'empty' };
  if (CONTROL.test(value)) return { value, error: 'control' };
  const key = `${options.prefix}${value}${options.isFolder && !value.endsWith('/') ? '/' : ''}`;
  const bytes = utf8Bytes(key);
  if (bytes > MAX_KEY_BYTES) return { value, error: 'tooLong', excess: bytes - MAX_KEY_BYTES };
  const result: NameCheck = { value };
  if (options.allowSlash && segments.length > 1) result.levels = segments.length;
  if (BIDI.test(value)) result.warning = 'bidi';
  else if (segments.some((s) => s !== s.trim() || s.endsWith('.'))) result.warning = 'trailing';
  return result;
}

const COMPOUND = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst'];

/** Fin de la partie à sélectionner : le nom sans son extension (composée comprise ; nom à point initial entier). */
export function baseNameEnd(name: string, isFolder: boolean): number {
  if (isFolder) return name.length;
  const lower = name.toLowerCase();
  for (const ext of COMPOUND) {
    if (lower.endsWith(ext) && lower.length > ext.length) return name.length - ext.length;
  }
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

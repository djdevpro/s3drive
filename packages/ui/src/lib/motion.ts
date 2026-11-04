/**
 * Mouvement : mêmes valeurs qu'Universal Email (courbe, durées, ressort sans rebond)
 * et miroir des jetons CSS --ud-ease, --ud-dur-fast|dur|dur-slow, --ud-dur-progress.
 */
import type { Transition } from 'motion/react';

export const EASE = [0.2, 0.8, 0.2, 1] as const;
/** Durées en secondes (motion) ; `progress` est linéaire (lissage des barres). */
export const DUR = { fast: 0.12, base: 0.16, slow: 0.22, progress: 0.24 } as const;

export const tFast: Transition = { duration: DUR.fast, ease: EASE };
export const tBase: Transition = { duration: DUR.base, ease: EASE };
export const tSlow: Transition = { duration: DUR.slow, ease: EASE };
/** Ressort doux, sans rebond : grands panneaux (détails, transferts dépliés, feuilles, tiroirs). */
export const tSpring: Transition = { type: 'spring', bounce: 0, duration: 0.3 };
export const tProgress: Transition = { duration: DUR.progress, ease: 'linear' };
/** Variante réduite : opacité seule, 120 ms. */
export const tReduced: Transition = { duration: DUR.fast, ease: EASE };

export type MotionPref = 'system' | 'reduce';

export const MOTION_STORAGE_KEY = 'ud.motion';
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

export function getMotionPref(): MotionPref {
  try {
    return localStorage.getItem(MOTION_STORAGE_KEY) === 'reduce' ? 'reduce' : 'system';
  } catch {
    return 'system';
  }
}

/** Pose `data-motion="reduce"` sur <html> quand la préférence d'appli le demande. */
export function applyMotionPref(pref: MotionPref): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (pref === 'reduce') root.dataset.motion = 'reduce';
  else delete root.dataset.motion;
}

export function setMotionPref(pref: MotionPref): void {
  try {
    if (pref === 'reduce') localStorage.setItem(MOTION_STORAGE_KEY, 'reduce');
    else localStorage.removeItem(MOTION_STORAGE_KEY);
  } catch {
    /* stockage indisponible */
  }
  applyMotionPref(pref);
}

/** Mouvement réduit : préférence système ou réglage de l'appli (`ud.motion = reduce`). */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce') return true;
  return typeof matchMedia === 'function' && matchMedia(REDUCE_QUERY).matches;
}

/** Valeur de `reducedMotion` pour `<MotionConfig>` : "always" si l'appli le demande, sinon "user". */
export function motionConfigReducedMotion(): 'always' | 'user' {
  return getMotionPref() === 'reduce' ? 'always' : 'user';
}

/** Préréglage effectif : `tReduced` quand le mouvement est réduit. */
export function transitionFor(t: Transition, reduced: boolean = prefersReducedMotion()): Transition {
  return reduced ? tReduced : t;
}

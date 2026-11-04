/**
 * Direction : le fournisseur de radix-ui enveloppe l'application avec la direction de la
 * langue courante ; les contenus en portail reçoivent en plus `dir` explicitement (`usePortalDir`).
 */
import { Direction } from 'radix-ui';
import type { ReactNode } from 'react';

export type Dir = 'ltr' | 'rtl';

export function DirectionProvider({ dir, children }: { dir: Dir; children: ReactNode }) {
  return <Direction.DirectionProvider dir={dir}>{children}</Direction.DirectionProvider>;
}

/** Direction effective : celle du fournisseur, sinon `ltr`. */
export function useDirection(dir?: Dir): Dir {
  return Direction.useDirection(dir) as Dir;
}

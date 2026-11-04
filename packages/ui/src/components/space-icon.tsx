/**
 * SpaceIcon : icône d'un espace de l'instance dans la barre latérale :
 * « Mon drive » (`home`, `hard-drive`) ou espace partagé (`shared`, `users`). Couleur
 * `currentColor` (l'élément de la barre latérale la fixe). Décorative sauf si `label` est donné ;
 * `useSpaceLabel` fournit le libellé traduit par défaut.
 */
import { HardDrive, Users } from 'lucide-react';
import type { SVGProps } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';

export type SpaceKind = 'home' | 'shared';

export interface SpaceIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  kind: SpaceKind;
  size?: number;
  /** Nom accessible (sinon décorative). */
  label?: string;
}

export function SpaceIcon({ kind, size = 20, label, className, ...props }: SpaceIconProps) {
  const Icon = kind === 'home' ? HardDrive : Users;
  return (
    <Icon
      data-slot="space-icon"
      data-kind={kind}
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0', className)}
      {...props}
    />
  );
}

/** Libellé par défaut d'un espace : « Mon drive » pour `home`, sinon le nom de l'espace ou « Espace partagé ». */
export function useSpaceLabel(kind: SpaceKind, name?: string): string {
  const { t } = useUdTranslation();
  if (kind === 'home') return t('spaces.home');
  return name || t('spaces.shared');
}

/**
 * IconButton : bouton carré à icône seule. Le nom accessible est obligatoire (`aria-label`) et sert
 * aussi d'infobulle (jamais d'attribut `title`). Variantes et états de `Button`.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button, type ButtonProps } from './button';
import { SimpleTooltip } from './tooltip';

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'children' | 'aria-label'> {
  'aria-label': string;
  children: ReactNode;
  /** Infobulle reprenant le nom accessible (par défaut) ; `false` pour s'en passer. */
  tooltip?: boolean;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
}

const SQUARE = { sm: 'w-7 px-0 pointer-coarse:min-w-10', md: 'w-8 px-0 pointer-coarse:min-w-10', lg: 'w-10 px-0' } as const;

export function IconButton({ tooltip = true, tooltipSide, size, variant, className, children, loading, ...props }: IconButtonProps) {
  const button = (
    <Button variant={variant ?? 'ghost'} size={size} loading={loading} className={cn(SQUARE[size ?? 'md'], className)} {...props}>
      {loading ? null : children}
    </Button>
  );
  if (!tooltip) return button;
  return (
    <SimpleTooltip content={props['aria-label']} side={tooltipSide}>
      {button}
    </SimpleTooltip>
  );
}

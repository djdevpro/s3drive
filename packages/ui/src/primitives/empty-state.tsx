/**
 * EmptyState (base shadcn `empty`) : `page` (visuel 120 px, titre text-2xl, texte,
 * 1–2 actions), `inline` (64 px, dans un panneau), `compact` (icône 24 px + une ligne).
 * Titre de niveau adapté (h2 par défaut), visuel `aria-hidden`.
 */
import { cva } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type EmptyStateVariant = 'page' | 'inline' | 'compact';

const root = cva('flex text-text-2', {
  variants: {
    variant: {
      page: 'mx-auto max-w-md flex-col items-center gap-4 px-4 py-12 text-center',
      inline: 'flex-col items-center gap-3 px-4 py-8 text-center',
      compact: 'items-center gap-2 px-2 py-2 text-start',
    },
  },
});

const media = cva('flex shrink-0 items-center justify-center text-text-3', {
  variants: {
    variant: {
      page: 'size-30 [&>svg:not([class*=size-])]:size-12',
      inline: 'size-16 [&>svg:not([class*=size-])]:size-8',
      compact: 'size-6 [&>svg:not([class*=size-])]:size-5',
    },
  },
});

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: EmptyStateVariant;
  /** Icône lucide ou illustration (décorative). */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 1 ou 2 actions (boutons). */
  actions?: ReactNode;
  /** Niveau du titre (2 par défaut). */
  headingLevel?: 2 | 3 | 4;
}

export function EmptyState({ variant = 'page', icon, title, description, actions, headingLevel = 2, className, ...props }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <div data-slot="empty-state" data-variant={variant} className={cn(root({ variant }), className)} {...props}>
      {icon && (
        <div data-slot="empty-state-media" aria-hidden className={media({ variant })}>
          {icon}
        </div>
      )}
      <div className={cn('flex min-w-0 flex-col', variant === 'compact' ? 'gap-0' : 'gap-1.5')}>
        <Heading className={cn('text-text-1', variant === 'page' ? 'text-2xl' : variant === 'inline' ? 'text-lg' : 'text-row font-medium')}>
          {title}
        </Heading>
        {description && <p className={cn(variant === 'compact' ? 'text-2xs font-normal' : 'text-row')}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

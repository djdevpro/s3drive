/**
 * Progress, Skeleton, Separator, ScrollArea, Badge, Kbd (shadcn new-york, retouchés).
 * - Progress : piste --ud-progress-track, remplissage --ud-progress-fill (accent-strong) ou état
 *   (paused, done, error), `scaleX` depuis le bord de début, lissage 240 ms linéaire (M10).
 * - Skeleton : balayage .ud-skeleton (1,4 s), figé en mouvement réduit (base.css).
 * - Separator : --ud-line (interne) ou --ud-pane-border (colonnes).
 * - Badge : tons sémantiques, texte --ud-text-1, icône -icon du ton, bordure 1 px du ton.
 * - Kbd : text-2xs, fond --muted, bordure --ud-line-strong, toujours LTR.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { Progress as ProgressPrimitive, ScrollArea as ScrollAreaPrimitive, Separator as SeparatorPrimitive } from 'radix-ui';
import type { ComponentProps, HTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { useDirection } from './direction';

// --------------------------------------------------------------------------
// Progress
// --------------------------------------------------------------------------

export type ProgressTone = 'default' | 'paused' | 'done' | 'error';

const FILL: Record<ProgressTone, string> = {
  default: 'bg-progress-fill',
  paused: 'bg-progress-paused',
  done: 'bg-progress-done',
  error: 'bg-progress-error',
};

export interface ProgressProps extends ComponentProps<typeof ProgressPrimitive.Root> {
  tone?: ProgressTone;
}

export function Progress({ className, value, max = 100, tone = 'default', ...props }: ProgressProps) {
  const ratio = value == null ? 0 : Math.min(1, Math.max(0, value / max));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-tone={tone}
      value={value}
      max={max}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-progress-track', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        // Remplissage depuis le bord de début (origine à droite en RTL)
        className={cn(
          'h-full w-full origin-left rounded-full transition-transform duration-(--ud-dur-progress) ease-linear rtl:origin-right',
          FILL[tone],
        )}
        style={{ transform: `scaleX(${ratio})` }}
      />
    </ProgressPrimitive.Root>
  );
}

// --------------------------------------------------------------------------
// Skeleton
// --------------------------------------------------------------------------

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="skeleton" aria-hidden className={cn('ud-skeleton', className)} {...props} />;
}

// --------------------------------------------------------------------------
// Separator
// --------------------------------------------------------------------------

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  strong = false,
  ...props
}: ComponentProps<typeof SeparatorPrimitive.Root> & { strong?: boolean }) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0',
        strong ? 'bg-pane-border' : 'bg-line',
        'data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  );
}

// --------------------------------------------------------------------------
// ScrollArea
// --------------------------------------------------------------------------

export function ScrollArea({ className, children, dir, ...props }: ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  const direction = useDirection(dir);
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" dir={direction} className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({ className, orientation = 'vertical', ...props }: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px select-none ud-transition',
        orientation === 'vertical' && 'h-full w-2.5 border-s border-s-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className="relative flex-1 rounded-full bg-text-3/35" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

// --------------------------------------------------------------------------
// Badge (tons sémantiques : icône + texte, ou icône seule avec nom accessible)
// --------------------------------------------------------------------------

export const badgeVariants = cva(
  [
    'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-2xs whitespace-nowrap text-text-1',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ],
  {
    variants: {
      tone: {
        neutral: 'border-tone-neutral-border bg-tone-neutral-bg [&_svg]:text-tone-neutral-icon',
        accent: 'border-tone-accent-border bg-tone-accent-bg [&_svg]:text-tone-accent-icon',
        success: 'border-tone-success-border bg-tone-success-bg [&_svg]:text-tone-success-icon',
        warning: 'border-tone-warning-border bg-tone-warning-bg [&_svg]:text-tone-warning-icon',
        danger: 'border-tone-danger-border bg-tone-danger-bg [&_svg]:text-tone-danger-icon',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" data-tone={tone ?? 'neutral'} className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// --------------------------------------------------------------------------
// Kbd
// --------------------------------------------------------------------------

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      data-slot="kbd"
      dir="ltr"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong bg-muted px-1 font-sans text-2xs text-text-1 shadow-soft select-none',
        className,
      )}
      {...props}
    />
  );
}

/** Combinaison de touches : chaque touche dans un `Kbd`, séparées par « + » ; séquence isolée en LTR. */
export function KbdGroup({ keys, className, ...props }: HTMLAttributes<HTMLSpanElement> & { keys: string[] }) {
  return (
    <span data-slot="kbd-group" dir="ltr" className={cn('inline-flex items-center gap-0.5 text-2xs text-text-2', className)} {...props}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="inline-flex items-center gap-0.5">
          {i > 0 && <span aria-hidden>+</span>}
          <Kbd>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * Button (shadcn new-york). Retouches UD : variantes sobres (primary =
 * ud-btn-primary, tonal = ud-btn-tonal, secondary, ghost sur --ud-menu-hover, danger =
 * ud-btn-danger, link) ; focus opaque --ud-focus ; hauteurs 28 / 32 / 40 px, ≥ 40 px au
 * pointeur grossier ; désactivé par aria-disabled (reste focalisable) ; chargement :
 * spinner 14 px à la place de l'icône de tête, libellé conservé, aria-busy, clics ignorés.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none',
    'ud-transition outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    'aria-disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        primary: 'ud-btn-primary',
        tonal: 'ud-btn-tonal',
        secondary: 'ud-btn-secondary',
        ghost: [
          'border border-transparent bg-transparent text-text-1 [&_svg]:text-text-2',
          'hover:bg-menu-hover aria-disabled:text-text-3 aria-disabled:hover:bg-transparent',
        ],
        danger: 'ud-btn-danger',
        link: 'h-auto! border-0 bg-transparent px-0! text-ud-accent-strong underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-row pointer-coarse:min-h-10',
        md: 'h-8 px-3 text-row pointer-coarse:min-h-10',
        lg: 'h-10 px-4 text-md',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Rend l'enfant unique (ex. un lien) avec les styles du bouton. */
  asChild?: boolean;
  /** Icône de tête, remplacée par le spinner pendant le chargement. */
  icon?: ReactNode;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  icon,
  loading = false,
  disabled,
  onClick,
  children,
  type,
  ...props
}: ButtonProps) {
  const inert = disabled || loading;
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} aria-disabled={inert || undefined} {...props}>
        {children}
      </Slot.Root>
    );
  }
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (inert) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      data-slot="button"
      data-variant={variant ?? 'secondary'}
      type={type ?? 'button'}
      className={classes}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...props}
    >
      {loading ? <Spinner size={14} label={false} className="text-current" /> : icon}
      {children}
    </button>
  );
}

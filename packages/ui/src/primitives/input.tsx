/**
 * Input et Label (shadcn new-york). Retouches UD : bordure --ud-input-border (≥ 3:1),
 * survol --ud-text-2, focus opaque --ud-focus, erreur (aria-invalid) bordure --ud-danger,
 * désactivé --ud-line + opacité 0,55 ; texte indicatif en --ud-text-2 (jamais --ud-text-3).
 */
import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps, Ref } from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends ComponentProps<'input'> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, type = 'text', ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input-border bg-transparent px-2.5 text-row text-text-1 pointer-coarse:min-h-10',
        'ud-transition placeholder:text-text-2 hover:border-text-2',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'aria-invalid:border-danger',
        'disabled:cursor-not-allowed disabled:border-line disabled:opacity-55',
        'file:me-2 file:border-0 file:bg-transparent file:text-row file:font-medium file:text-text-1',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'inline-flex items-center gap-2 text-row font-medium text-text-1 select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-55',
        className,
      )}
      {...props}
    />
  );
}

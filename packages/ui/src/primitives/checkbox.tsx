/**
 * Checkbox et Switch (shadcn new-york). Retouches UD : non coché bordure
 * --ud-input-border ; coché ou indéterminé --ud-check-bg / -border / -fg (aplat d'accent en
 * clair, surface teintée bordée d'accent-strong en sombre, jamais d'aplat clair) ; interrupteur
 * éteint : piste transparente bordée, pouce --ud-text-2 ; focus opaque --ud-focus.
 */
import { Check, Minus } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

const focusRing = 'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-sm border border-input-border bg-transparent ud-transition',
        'data-[state=checked]:border-check-border data-[state=checked]:bg-check data-[state=checked]:text-check-fg',
        'data-[state=indeterminate]:border-check-border data-[state=indeterminate]:bg-check data-[state=indeterminate]:text-check-fg',
        'aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-55',
        focusRing,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="group flex items-center justify-center text-current">
        <Check aria-hidden className="size-3.5 group-data-[state=indeterminate]:hidden" strokeWidth={3} />
        <Minus aria-hidden className="hidden size-3.5 group-data-[state=indeterminate]:block" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-input-border bg-transparent p-px ud-transition',
        'data-[state=checked]:border-check-border data-[state=checked]:bg-check',
        'disabled:cursor-not-allowed disabled:opacity-55',
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-text-2 ud-transition',
          'data-[state=checked]:translate-x-4 data-[state=checked]:bg-check-fg rtl:data-[state=checked]:-translate-x-4',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

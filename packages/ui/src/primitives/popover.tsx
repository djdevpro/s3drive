/**
 * Popover (shadcn new-york). Retouches UD : élément flottant e3 (--popover, --ud-float-border,
 * --ud-float-shadow, rayon lg), ouverture M26, `dir` explicite, Échap ferme (Radix).
 */
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { useDirection } from './direction';

export const Popover = (props: ComponentProps<typeof PopoverPrimitive.Root>) => <PopoverPrimitive.Root data-slot="popover" {...props} />;
export const PopoverTrigger = (props: ComponentProps<typeof PopoverPrimitive.Trigger>) => (
  <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
);
export const PopoverAnchor = (props: ComponentProps<typeof PopoverPrimitive.Anchor>) => <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
export const PopoverClose = PopoverPrimitive.Close;

export function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  dir,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & { dir?: 'ltr' | 'rtl' }) {
  const direction = useDirection(dir);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        dir={direction}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-(--ud-z-popover) w-72 rounded-lg border border-float-border bg-popover p-4 text-popover-foreground shadow-float outline-none',
          'origin-(--radix-popover-content-transform-origin)',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

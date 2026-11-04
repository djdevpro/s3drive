/**
 * Tooltip (shadcn new-york). Retouches UD : en clair, infobulle inversée
 * (fond --ud-text-1, sans bordure ni ombre) ; en sombre, surface sombre élevée + bordure
 * --ud-line-strong + ombre flottante, jamais claire ; text-xs, rayon sm, 4 × 8 px, 280 px au plus,
 * sans flèche ; délai 600 ms, 300 ms entre deux infobulles ; Échap la masque ; `dir` explicite.
 * Une seule infobulle à la fois : un `TooltipProvider` d'hôte est réutilisé, sinon chacune a le sien.
 */
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useDirection } from './direction';

const ProviderPresent = createContext(false);

export function TooltipProvider({
  delayDuration = 600,
  skipDelayDuration = 300,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props}>
      <ProviderPresent.Provider value={true}>{children}</ProviderPresent.Provider>
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  return useContext(ProviderPresent) ? root : <TooltipProvider>{root}</TooltipProvider>;
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({ className, sideOffset = 6, dir, ...props }: ComponentProps<typeof TooltipPrimitive.Content> & { dir?: 'ltr' | 'rtl' }) {
  const direction = useDirection(dir);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        dir={direction}
        sideOffset={sideOffset}
        className={cn(
          'z-(--ud-z-tooltip) max-w-[280px] rounded-sm border border-tooltip-border bg-tooltip px-2 py-1 text-xs text-tooltip-fg dark:shadow-float',
          'origin-(--radix-tooltip-content-transform-origin) animate-in fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/** Raccourci : infobulle simple autour d'un déclencheur focalisable. */
export function SimpleTooltip({ content, children, side }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}

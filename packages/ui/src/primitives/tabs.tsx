/**
 * Tabs (shadcn new-york). Retouches UD : onglets soulignés (indicateur 2 px --ud-focus sous
 * l'onglet actif, bordure basse --ud-line), survol --ud-menu-hover, focus opaque ;
 * flèches du clavier dans le sens de lecture (direction du fournisseur, RTL compris).
 */
import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { useDirection } from './direction';

export function Tabs({ className, dir, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  const direction = useDirection(dir);
  return <TabsPrimitive.Root data-slot="tabs" dir={direction} className={cn('flex flex-col gap-3', className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn('inline-flex items-center gap-1 border-b border-line', className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative -mb-px inline-flex h-9 items-center gap-1.5 rounded-t-md px-3 text-row font-medium whitespace-nowrap text-text-2 ud-transition',
        'hover:bg-menu-hover hover:text-text-1 data-[state=active]:text-text-1',
        'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-focus',
        'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        'disabled:pointer-events-none disabled:opacity-55',
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus', className)}
      {...props}
    />
  );
}

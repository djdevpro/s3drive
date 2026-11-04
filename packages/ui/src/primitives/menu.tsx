/**
 * DropdownMenu et ContextMenu (shadcn new-york). Retouches UD : élément flottant e3 (fond --popover,
 * bordure --ud-float-border, ombre --ud-float-shadow, rayon lg) ; élément mis en évidence
 * --ud-menu-hover + anneau intérieur --ud-focus au clavier, à la place de outline-hidden ; élément destructif : texte --ud-text-1, icône --ud-danger ; ouverture animée
 * (échelle 0,97 → 1 + opacité depuis l'origine Radix) ; chevron de sous-menu en miroir en RTL ;
 * direction posée sur la racine, reportée par Radix sur les contenus en portail ; raccourcis en --ud-text-2 au bord de fin.
 */
import { Check, ChevronRight, Circle } from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive, DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import type { ComponentProps, HTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { useDirection } from './direction';

const contentClass = cn(
  'z-(--ud-z-popover) min-w-[10rem] overflow-x-hidden overflow-y-auto rounded-lg border border-float-border bg-popover p-1 text-popover-foreground shadow-float',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
);

const itemClass = cn(
  'relative flex min-h-(--ud-menu-item-h) cursor-default items-center gap-2 rounded-sm px-2 text-row text-text-1 select-none',
  'outline-none data-[highlighted]:bg-menu-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-55',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-text-2 [&_svg:not([class*='size-'])]:size-4",
  'data-[variant=destructive]:[&_svg]:text-danger',
);

const insetClass = 'data-[inset]:ps-8';
const indicatorItemClass = cn(itemClass, 'ps-8');
const indicatorClass = 'pointer-events-none absolute start-2 flex size-4 items-center justify-center';
const labelClass = 'px-2 py-1.5 text-2xs text-text-2 data-[inset]:ps-8';
const separatorClass = '-mx-1 my-1 h-px bg-line';

export type MenuItemVariant = 'default' | 'destructive';

/** Raccourci affiché dans un élément de menu (bord de fin, --ud-text-2, toujours LTR). */
export function MenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span data-slot="menu-shortcut" dir="ltr" className={cn('ms-auto text-2xs tracking-wide text-text-2', className)} {...props} />;
}

// --------------------------------------------------------------------------
// DropdownMenu
// --------------------------------------------------------------------------

// La racine porte la direction : Radix la reporte sur le contenu en portail (attribut dir).
export function DropdownMenu({ dir, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" dir={useDirection(dir)} {...props} />;
}
export const DropdownMenuTrigger = (props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) => (
  <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
);
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuShortcut = MenuShortcut;

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(contentClass, 'max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean; variant?: MenuItemVariant }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset || undefined}
      data-variant={variant}
      className={cn(itemClass, insetClass, className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem data-slot="dropdown-menu-checkbox-item" className={cn(indicatorItemClass, className)} {...props}>
      <span className={indicatorClass}>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" className={cn(indicatorItemClass, className)} {...props}>
      <span className={indicatorClass}>
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle aria-hidden className="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ className, inset, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return <DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" data-inset={inset || undefined} className={cn(labelClass, className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" className={cn(separatorClass, className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset || undefined}
      className={cn(itemClass, insetClass, 'data-[state=open]:bg-menu-hover', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ms-auto size-4 rtl:-scale-x-100" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        className={cn(contentClass, 'origin-(--radix-dropdown-menu-content-transform-origin)', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

// --------------------------------------------------------------------------
// ContextMenu (ouvert au clic droit, à l'appui long ou par Maj+F10 / touche Menu)
// --------------------------------------------------------------------------

export function ContextMenu({ dir, ...props }: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" dir={useDirection(dir)} {...props} />;
}
export const ContextMenuTrigger = (props: ComponentProps<typeof ContextMenuPrimitive.Trigger>) => (
  <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
);
export const ContextMenuGroup = ContextMenuPrimitive.Group;
export const ContextMenuSub = ContextMenuPrimitive.Sub;
export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;
export const ContextMenuShortcut = MenuShortcut;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(contentClass, 'max-h-(--radix-context-menu-content-available-height) origin-(--radix-context-menu-content-transform-origin)', className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export function ContextMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item> & { inset?: boolean; variant?: MenuItemVariant }) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset || undefined}
      data-variant={variant}
      className={cn(itemClass, insetClass, className)}
      {...props}
    />
  );
}

export function ContextMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem data-slot="context-menu-checkbox-item" className={cn(indicatorItemClass, className)} {...props}>
      <span className={indicatorClass}>
        <ContextMenuPrimitive.ItemIndicator>
          <Check aria-hidden className="size-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

export function ContextMenuRadioItem({ className, children, ...props }: ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem data-slot="context-menu-radio-item" className={cn(indicatorItemClass, className)} {...props}>
      <span className={indicatorClass}>
        <ContextMenuPrimitive.ItemIndicator>
          <Circle aria-hidden className="size-2 fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuLabel({ className, inset, ...props }: ComponentProps<typeof ContextMenuPrimitive.Label> & { inset?: boolean }) {
  return <ContextMenuPrimitive.Label data-slot="context-menu-label" data-inset={inset || undefined} className={cn(labelClass, className)} {...props} />;
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className={cn(separatorClass, className)} {...props} />;
}

export function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset || undefined}
      className={cn(itemClass, insetClass, 'data-[state=open]:bg-menu-hover', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ms-auto size-4 rtl:-scale-x-100" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSubContent({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        data-slot="context-menu-sub-content"
        className={cn(contentClass, 'origin-(--radix-context-menu-content-transform-origin)', className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

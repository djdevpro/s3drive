/**
 * Avatar (shadcn new-york) : image, ou initiales (1–2 graphèmes) en repli. Retouches UD : surface
 * de ton neutre et bordure --ud-line (jamais d'aplat clair en sombre), texte --ud-text-1.
 * Décoratif par défaut : le nom est donné en texte à côté ; `label` pour un avatar seul.
 */
import { Avatar as AvatarPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';
import { initials } from '../lib/format';

const SIZES = { sm: 'size-6 text-2xs', md: 'size-8 text-xs', lg: 'size-10 text-row' } as const;

export interface AvatarProps extends Omit<ComponentProps<typeof AvatarPrimitive.Root>, 'children'> {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  /** Nom accessible (sinon décoratif). */
  label?: string;
}

export function Avatar({ name, src, size = 'md', label, className, ...props }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-flex shrink-0 overflow-hidden rounded-full border border-line bg-tone-neutral-bg', SIZES[size], className)}
      {...props}
    >
      {src && <AvatarPrimitive.Image data-slot="avatar-image" src={src} alt="" className="aspect-square size-full object-cover" />}
      <AvatarPrimitive.Fallback data-slot="avatar-fallback" className="flex size-full items-center justify-center font-semibold text-text-1">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

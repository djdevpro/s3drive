/**
 * Breadcrumb (shadcn new-york), indépendant du routeur : les liens sont des `NavLink` (vrai href,
 * `onNavigate` de l'hôte). Retouches UD : chaque segment isolé par `<bdi>` ;
 * séparateurs `chevron-right` en --ud-text-3, en miroir en RTL ; page courante `aria-current`.
 */
import { ChevronRight, Ellipsis } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';
import { NavLink, type NavLinkProps } from './nav-link';

export function Breadcrumb({ 'aria-label': ariaLabel, ...props }: ComponentProps<'nav'>) {
  const { t } = useUdTranslation();
  return <nav data-slot="breadcrumb" aria-label={ariaLabel ?? t('breadcrumb.label')} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn('flex min-w-0 flex-wrap items-center gap-1 text-row break-words text-text-2', className)}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return <li data-slot="breadcrumb-item" className={cn('inline-flex min-w-0 items-center gap-1', className)} {...props} />;
}

export interface BreadcrumbLinkProps extends Omit<NavLinkProps, 'href'> {
  href?: string;
  /** Rend l'enfant (lien de l'hôte) avec les styles du segment. */
  asChild?: boolean;
}

const linkClass = cn(
  'truncate rounded-sm px-1 ud-transition hover:bg-menu-hover hover:text-text-1',
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
);

export function BreadcrumbLink({ asChild, className, href, children, ...props }: BreadcrumbLinkProps) {
  if (asChild) return <Slot.Root data-slot="breadcrumb-link" className={cn(linkClass, className)}>{children}</Slot.Root>;
  return (
    <NavLink data-slot="breadcrumb-link" href={href ?? '#'} className={cn(linkClass, className)} {...props}>
      <bdi>{children}</bdi>
    </NavLink>
  );
}

export function BreadcrumbPage({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span data-slot="breadcrumb-page" aria-current="page" className={cn('truncate px-1 font-medium text-text-1', className)} {...props}>
      <bdi>{children}</bdi>
    </span>
  );
}

export function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<'li'> & { children?: ReactNode }) {
  return (
    <li data-slot="breadcrumb-separator" role="presentation" aria-hidden className={cn('text-text-3 [&>svg]:size-3.5', className)} {...props}>
      {children ?? <ChevronRight className="rtl:-scale-x-100" />}
    </li>
  );
}

/** Segments repliés : à placer dans le déclencheur d'un menu (« … »). */
export function BreadcrumbEllipsis({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  const { t } = useUdTranslation();
  return (
    <span data-slot="breadcrumb-ellipsis" className={cn('inline-flex size-6 items-center justify-center', className)} {...props}>
      <Ellipsis aria-hidden className="size-4" />
      <span className="sr-only">{t('breadcrumb.more')}</span>
    </span>
  );
}

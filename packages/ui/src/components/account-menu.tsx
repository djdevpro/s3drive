/**
 * AccountMenu : menu du compte de la barre latérale ou de la barre du haut.
 * En-tête : nom, e-mail (isolé, LTR), rôles Drive (libellés fournis par l'hôte, jamais les noms
 * bruts du fournisseur) ; entrées de l'hôte ; « Se déconnecter ». Aucune logique réseau :
 * uniquement des callbacks.
 */
import { ChevronsUpDown, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';
import { Avatar } from '../primitives/avatar';
import { Badge } from '../primitives/feedback';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '../primitives/menu';

export interface AccountMenuProps {
  name: string;
  email?: string | null;
  /** Rôles Drive déjà traduits (« Administrateur »…). */
  roles?: string[];
  avatarSrc?: string | null;
  onSignOut: () => void;
  /** Entrées supplémentaires (`DropdownMenuItem`), placées avant « Se déconnecter ». */
  children?: ReactNode;
  /** Déclencheur compact (avatar seul) ou avec le nom. */
  compact?: boolean;
  /**
   * « card » : déclencheur pleine largeur du pied de la barre latérale (avatar, nom, e-mail, chevron),
   * comme le compte en bas à gauche d'Universal Email. « inline » par défaut.
   */
  variant?: 'inline' | 'card';
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function AccountMenu({
  name,
  email,
  roles = [],
  avatarSrc,
  onSignOut,
  children,
  compact = false,
  variant = 'inline',
  align = 'end',
  side,
  open,
  onOpenChange,
  className,
}: AccountMenuProps) {
  const { t } = useUdTranslation();
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        data-slot="account-menu-trigger"
        aria-label={t('account.menu', { name })}
        data-variant={variant}
        className={cn(
          variant === 'card'
            ? 'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-text-1 ud-transition'
            : 'inline-flex max-w-full min-w-0 items-center gap-2 rounded-md p-1 text-start text-row text-text-1 ud-transition',
          'hover:bg-menu-hover data-[state=open]:bg-menu-hover',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          className,
        )}
      >
        <Avatar name={name} src={avatarSrc} size="md" />
        {variant === 'card' ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] leading-tight font-medium">
                <bdi>{name}</bdi>
              </span>
              {email && (
                <span dir="ltr" className="truncate text-[11.5px] leading-tight text-text-2 rtl:text-right">
                  {email}
                </span>
              )}
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-text-3" />
          </>
        ) : (
          !compact && (
            <span className="min-w-0 truncate font-medium">
              <bdi>{name}</bdi>
            </span>
          )
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-64">
        <DropdownMenuLabel className="flex items-start gap-3 px-2 py-2 text-row font-normal">
          <Avatar name={name} src={avatarSrc} size="lg" />
          <span className="flex min-w-0 flex-col">
            <span data-slot="account-menu-name" className="truncate font-medium text-text-1">
              <bdi>{name}</bdi>
            </span>
            {email && (
              <span data-slot="account-menu-email" dir="ltr" className="truncate text-2xs font-normal text-text-2">
                {email}
              </span>
            )}
            {roles.length > 0 && (
              <span data-slot="account-menu-roles" className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="sr-only">{t('account.roles')}</span>
                {roles.map((role) => (
                  <Badge key={role} tone="neutral">
                    {role}
                  </Badge>
                ))}
              </span>
            )}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children && (
          <>
            <DropdownMenuGroup>{children}</DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem data-slot="account-menu-sign-out" onSelect={() => onSignOut()}>
          <LogOut aria-hidden className="rtl:-scale-x-100" />
          {t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

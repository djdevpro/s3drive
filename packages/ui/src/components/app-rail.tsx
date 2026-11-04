/**
 * Rail des connexions (« rail à la Gmail, comme les boîtes d'Universal Email »), repris
 * d'UE (rail/AccountRail.tsx) : colonne de 64 px sur fond --ud-rail ; une pastille de 36 px (rayon
 * 12 px) par connexion, indicateur de 3 × 24 px du côté de début sur l'élément actif (glissé
 * d'un élément à l'autre), pastilles inactives légèrement désaturées, survol 1,04, appui 0,97 ;
 * « + » en pointillés ; boutons d'outils de 36 px en bas ; infobulles du côté de fin avec raccourci.
 * Aucune logique : liens et callbacks fournis par l'hôte.
 */
import { motion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { initials } from '../lib/format';
import { tBase } from '../lib/motion';
import { useDirection } from '../primitives/direction';
import { NavLink } from '../primitives/nav-link';
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip';

/** Colonne du rail : en-tête (logo), liste défilante, pied (outils). */
export function AppRail({ label, header, footer, children, className }: { label: string; header?: ReactNode; footer?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <nav data-slot="app-rail" aria-label={label} className={cn('flex w-(--ud-rail-w) shrink-0 flex-col items-center bg-rail py-3', className)}>
      {header && <div className="mb-3 flex h-9 items-center">{header}</div>}
      <div className="flex w-full flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto py-1 [scrollbar-width:none]">{children}</div>
      {footer && <div className="flex flex-col items-center gap-1 pt-2">{footer}</div>}
    </nav>
  );
}

/** Contenu de l'infobulle du rail : libellé et raccourci éventuel. */
function RailTip({ label, hint }: { label: ReactNode; hint?: string | undefined }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {hint && (
        <kbd dir="ltr" className="rounded bg-[color-mix(in_oklab,var(--ud-tooltip-fg)_16%,transparent)] px-1 font-sans text-[10.5px]">
          {hint}
        </kbd>
      )}
    </span>
  );
}

function useTipSide(): 'left' | 'right' {
  return useDirection() === 'rtl' ? 'left' : 'right';
}

/**
 * Pastille d'une connexion : initiales (ou logo) sur un dégradé de sa couleur, 36 px, rayon 32 %.
 * `color` accepte toute couleur CSS (y compris `var(--ud-accent)`) ; `ink` est la couleur du texte.
 */
export function RailBadge({ label, text, color = 'var(--ud-accent)', ink = 'var(--ud-on-accent)', src, size = 36, className }: { label: string; /** Texte affiché à la place des initiales (une initiale…). */ text?: string; color?: string; ink?: string; src?: string | null; size?: number; className?: string }) {
  const style: CSSProperties = {
    color: ink,
    width: size,
    height: size,
    borderRadius: size * 0.32,
    fontSize: Math.round(size * 0.36),
    background: `linear-gradient(160deg, color-mix(in oklab, ${color} 88%, white), ${color})`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 70%, black 10%), inset 0 1px 0 rgb(255 255 255 / 0.18)`,
  };
  return (
    <span data-slot="rail-badge" aria-hidden className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none', className)} style={style}>
      {src ? <img src={src} alt="" className="size-full object-cover" /> : (text ?? initials(label))}
    </span>
  );
}

export interface RailItemProps {
  /** Lien de la connexion (navigation par le routeur de l'hôte). */
  href: string;
  label: string;
  active: boolean;
  /** Raccourci affiché dans l'infobulle (« Ctrl+1 »). */
  hint?: string | undefined;
  /** Couleur de l'indicateur (celle de la connexion) ; --ud-text-1 par défaut. */
  color?: string | undefined;
  /** Avertissement (reconnexion requise…) : point d'alerte et texte ajouté au nom accessible. */
  warn?: string | undefined;
  /** Identifiant partagé de l'indicateur animé (un par rail). */
  indicatorId?: string;
  children: ReactNode;
}

export function RailItem({ href, label, active, hint, color, warn, indicatorId = 'ud-rail-indicator', children }: RailItemProps) {
  const side = useTipSide();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          href={href}
          data-slot="rail-item"
          aria-label={[label, warn].filter(Boolean).join(', ')}
          aria-current={active ? 'page' : undefined}
          className="group relative flex h-11 w-full items-center justify-center outline-none"
        >
          {active && (
            <motion.span
              layoutId={indicatorId}
              aria-hidden
              className="absolute start-0 h-6 w-[3px] rounded-e-full"
              style={{ background: color ?? 'var(--ud-text-1)' }}
              transition={tBase}
            />
          )}
          <span
            className={cn(
              'relative rounded-[12px] ud-transition group-hover:scale-[1.04] group-active:scale-[0.97]',
              'group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus',
              !active && 'opacity-[0.82] saturate-[0.8] group-hover:opacity-100 group-hover:saturate-100',
            )}
          >
            {children}
            {warn && <span aria-hidden className="absolute -end-0.5 -bottom-0.5 size-3 rounded-full border-2 border-rail bg-warn" />}
          </span>
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side={side}>
        <RailTip label={label} hint={hint} />
      </TooltipContent>
    </Tooltip>
  );
}

/** « + » en pointillés (ajouter une connexion). */
export function RailAddLink({ href, label }: { href: string; label: string }) {
  const side = useTipSide();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          href={href}
          data-slot="rail-add"
          aria-label={label}
          className={cn(
            'mt-1 flex size-9 items-center justify-center rounded-[12px] border border-dashed border-line-strong text-text-2 ud-transition',
            'hover:border-text-3 hover:text-text-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Séparateur du rail (entre la vue unifiée et les connexions). */
export function RailSeparator() {
  return <div aria-hidden className="my-1.5 h-px w-6 bg-line-strong" />;
}

export interface RailButtonProps {
  label: string;
  hint?: string | undefined;
  onClick?: () => void;
  /** Lien plutôt que bouton. */
  href?: string;
  active?: boolean;
  children: ReactNode;
}

/** Bouton d'outil du pied du rail (36 px, rayon 10 px, icône 17 px). */
export function RailButton({ label, hint, onClick, href, active, children }: RailButtonProps) {
  const side = useTipSide();
  const className = cn(
    'flex size-9 items-center justify-center rounded-[10px] text-text-2 ud-transition hover:bg-menu-hover hover:text-text-1 [&_svg]:size-[17px]',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    active && 'bg-ud-accent-soft text-text-1',
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <NavLink href={href} data-slot="rail-button" aria-label={label} aria-current={active ? 'page' : undefined} className={className}>
            {children}
          </NavLink>
        ) : (
          <button type="button" data-slot="rail-button" aria-label={label} aria-pressed={active} onClick={onClick} className={className}>
            {children}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side={side}>
        <RailTip label={label} hint={hint} />
      </TooltipContent>
    </Tooltip>
  );
}

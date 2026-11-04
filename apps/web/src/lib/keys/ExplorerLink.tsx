import { type AnyRouter, useRouter } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { type ExplorerTarget, toPath } from './keyCodec';

/*
 * Seul point de construction des liens d'explorateur (mode 2) : href produit par
 * keyCodec.toPath(), navigation par router.navigate({ href }). Un clic modifié (Ctrl, Maj, Alt,
 * milieu) garde le comportement natif du lien.
 *
 * Le routeur (1.170) compare l'URL courante et la cible sans leur '/' final (commitLocation,
 * isSameLocation) : passer du fichier `a` au dossier `a/` serait ignoré. L'état d'historique
 * `udHref` distingue les deux entrées.
 */

declare module '@tanstack/history' {
  interface HistoryState {
    udHref?: string;
    /** Aperçu ouvert depuis l'explorateur de cet onglet : Fermer revient en arrière. */
    udPreview?: boolean;
  }
}

export interface NavigateHrefOptions {
  replace?: boolean;
  /** État d'historique ajouté à `udHref`. */
  state?: { udPreview?: boolean };
}

export function navigateHref(router: AnyRouter, href: string, options: NavigateHrefOptions = {}) {
  return router.navigate({ href, replace: options.replace ?? false, state: { ...options.state, udHref: href } });
}

export function navigateExplorer(router: AnyRouter, target: ExplorerTarget, options: NavigateHrefOptions = {}) {
  return navigateHref(router, toPath(target), options);
}

export function useExplorerNavigate() {
  const router = useRouter();
  return (target: ExplorerTarget, options: NavigateHrefOptions = {}) => navigateExplorer(router, target, options);
}

export interface ExplorerLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target'> {
  target: ExplorerTarget;
  replace?: boolean;
  /** Attribut target du lien (« _blank »…) : navigation native. */
  linkTarget?: string;
}

export function ExplorerLink({ target, replace, linkTarget, onClick, children, ...rest }: ExplorerLinkProps) {
  const router = useRouter();
  const href = toPath(target);
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || linkTarget) return;
    event.preventDefault();
    void navigateHref(router, href, { replace: replace ?? false });
  };
  return (
    <a {...rest} href={href} target={linkTarget} onClick={handleClick}>
      {children}
    </a>
  );
}

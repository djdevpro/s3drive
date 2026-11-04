/**
 * Liens indépendants du routeur : un vrai `<a href>` (clic du milieu, Ctrl/⌘+clic,
 * « Ouvrir dans un nouvel onglet » fonctionnent), et pour un clic simple, `onNavigate` laisse
 * l'hôte naviguer avec son routeur. `getHref` traduit une cible de l'hôte en URL.
 */
import { createContext, useContext, type AnchorHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react';

export interface Navigation {
  /** Navigation de l'hôte (ex. `router.navigate({ href })`) pour un clic simple. */
  onNavigate?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
}

const NavigationContext = createContext<Navigation>({});

/** Fournit `onNavigate` à tous les liens de @ud/ui (fil d'Ariane, cartes…). */
export function NavigationProvider({ onNavigate, children }: Navigation & { children: ReactNode }) {
  return <NavigationContext.Provider value={{ onNavigate }}>{children}</NavigationContext.Provider>;
}

/** Vrai pour un clic qui doit rester au navigateur (bouton du milieu, touche de modification, cible). */
export function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  const target = event.currentTarget.getAttribute('target');
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (target !== null && target !== '_self')
  );
}

export interface NavLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Remplace la navigation fournie par le contexte. */
  onNavigate?: Navigation['onNavigate'];
  ref?: Ref<HTMLAnchorElement>;
}

export function NavLink({ href, onNavigate, onClick, ...props }: NavLinkProps) {
  const ctx = useContext(NavigationContext);
  const navigate = onNavigate ?? ctx.onNavigate;
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (!navigate || isModifiedClick(event)) return;
        event.preventDefault();
        navigate(href, event);
      }}
      {...props}
    />
  );
}

/** Pour les composants qui reçoivent des cibles : URL de la cible, fournie par l'hôte. */
export type GetHref<T> = (target: T) => string;

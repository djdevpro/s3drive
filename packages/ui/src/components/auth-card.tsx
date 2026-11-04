/**
 * AuthCard : carte centrée des pages /login et /terms (et /connect de 01) :
 * fond .ud-auth-backdrop (lueur d'accent + trame), carte .ud-auth-card (panel, bordure 1 px,
 * liseré clair en sombre), logo facultatif, titre h1, texte, contenu, actions empilées, pied.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface AuthCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  /** Texte d'introduction sous le titre. */
  description?: ReactNode;
  /** Logo ou nom de l'instance au-dessus de la carte. */
  logo?: ReactNode;
  /** Boutons (action principale d'abord) ; pleine largeur. */
  actions?: ReactNode;
  /** Ligne sous la carte (lien « Utiliser mes propres identifiants S3 », sélecteur de langue). */
  footer?: ReactNode;
  /** Contenu de la carte entre le texte et les actions (messages, case des conditions…). */
  children?: ReactNode;
}

export function AuthCard({ title, description, logo, actions, footer, children, className, ...props }: AuthCardProps) {
  return (
    <main data-slot="auth-card-page" className={cn('relative isolate flex min-h-dvh flex-col items-center justify-center bg-app px-4 py-10', className)} {...props}>
      <div aria-hidden className="ud-auth-backdrop pointer-events-none absolute inset-0 -z-10" />
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        {logo && <div data-slot="auth-card-logo">{logo}</div>}
        <section data-slot="auth-card" className="ud-auth-card flex w-full flex-col gap-5 rounded-xl border p-6 text-text-1 sm:p-8">
          <header className="flex flex-col gap-2 text-center">
            <h1 className="text-2xl">{title}</h1>
            {description && <div className="text-row text-text-2">{description}</div>}
          </header>
          {children && <div className="flex flex-col gap-3 text-row">{children}</div>}
          {actions && <div data-slot="auth-card-actions" className="flex flex-col gap-2 [&>*]:w-full">{actions}</div>}
        </section>
        {footer && <div data-slot="auth-card-footer" className="text-center text-row text-text-2">{footer}</div>}
      </div>
    </main>
  );
}

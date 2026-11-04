/**
 * Dialog et AlertDialog (shadcn new-york). Retouches UD : niveau e4 (fond panel, bordure
 * --ud-float-border, ombre --ud-float-shadow, rayon xl) ; voile --ud-overlay (base.css) ;
 * ouverture M27 (échelle 0,97 → 1 + opacité, 160 ms, opacité seule en mouvement réduit) ;
 * `aria-modal`, `dir` explicite ; bouton Fermer traduit ; AlertDialog :
 * focus initial sur Annuler (Radix), action destructive en ud-btn-danger.
 */
import { X } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, HTMLAttributes } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';
import { buttonVariants, type ButtonVariant } from './button';
import { useDirection } from './direction';

const overlayClass = cn(
  'fixed inset-0 z-(--ud-z-overlay)',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
);

const contentClass = cn(
  // Centré par inset-0 + m-auto (aucune propriété physique, aucune translation à composer avec M27)
  'fixed inset-0 z-(--ud-z-dialog) m-auto grid h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg gap-4 overflow-y-auto',
  'rounded-xl border border-float-border bg-panel p-6 text-text-1 shadow-float outline-none',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
);

// --------------------------------------------------------------------------
// Dialog
// --------------------------------------------------------------------------

export const Dialog = (props: ComponentProps<typeof DialogPrimitive.Root>) => <DialogPrimitive.Root data-slot="dialog" {...props} />;
export const DialogTrigger = (props: ComponentProps<typeof DialogPrimitive.Trigger>) => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
);
export const DialogClose = (props: ComponentProps<typeof DialogPrimitive.Close>) => <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn(overlayClass, className)} {...props} />;
}

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** Bouton Fermer dans le coin de fin (par défaut). */
  showClose?: boolean;
  dir?: 'ltr' | 'rtl';
}

export function DialogContent({ className, children, showClose = true, dir, ...props }: DialogContentProps) {
  const { t } = useUdTranslation();
  const direction = useDirection(dir);
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content data-slot="dialog-content" aria-modal="true" dir={direction} className={cn(contentClass, className)} {...props}>
        {children}
        {showClose && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label={t('common.close')}
            className={cn(
              'absolute end-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-text-2 ud-transition',
              'hover:bg-menu-hover hover:text-text-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            <X aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pe-8 text-start', className)} {...props} />;
}

/** Pied : action principale du côté de fin, secondaire à côté. */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg text-text-1', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-row text-text-2', className)} {...props} />;
}

// --------------------------------------------------------------------------
// AlertDialog (confirmation ; Échap et Annuler ferment, focus initial sur Annuler)
// --------------------------------------------------------------------------

export const AlertDialog = (props: ComponentProps<typeof AlertDialogPrimitive.Root>) => (
  <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
);
export const AlertDialogTrigger = (props: ComponentProps<typeof AlertDialogPrimitive.Trigger>) => (
  <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
);

export function AlertDialogContent({ className, dir, ...props }: ComponentProps<typeof AlertDialogPrimitive.Content> & { dir?: 'ltr' | 'rtl' }) {
  const direction = useDirection(dir);
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay data-slot="alert-dialog-overlay" className={overlayClass} />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        aria-modal="true"
        dir={direction}
        className={cn(contentClass, className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export const AlertDialogHeader = DialogHeader;
export const AlertDialogFooter = DialogFooter;

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title data-slot="alert-dialog-title" className={cn('text-lg text-text-1', className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description data-slot="alert-dialog-description" className={cn('text-row text-text-2', className)} {...props} />;
}

/** Action : reprend le verbe (« Supprimer »), jamais « OK » ; `variant="danger"` pour une action destructive. */
export function AlertDialogAction({
  className,
  variant = 'primary',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action> & { variant?: ButtonVariant }) {
  return <AlertDialogPrimitive.Action data-slot="alert-dialog-action" className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export function AlertDialogCancel({ className, children, ...props }: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  const { t } = useUdTranslation();
  return (
    <AlertDialogPrimitive.Cancel data-slot="alert-dialog-cancel" className={cn(buttonVariants({ variant: 'secondary' }), className)} {...props}>
      {children ?? t('common.cancel')}
    </AlertDialogPrimitive.Cancel>
  );
}

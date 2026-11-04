/**
 * Toasts : `<Toaster />` monté une fois, fonction `toast()` utilisable partout (hors React compris).
 * Construit sur Radix Toast (sonner n'est pas installé, voir README). Retouches UD (M22) :
 * fond --popover, bordure --ud-float-border, ombre --ud-float-shadow, rayon 12 px, en bas côté
 * début (bas gauche en LTR, bas droite en RTL), entrée 220 ms courbe maison ; action en
 * ud-btn-primary ; région et bouton Fermer traduits ; erreurs annoncées en assertif.
 */
import { CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { useSyncExternalStore, type ReactNode } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';
import { buttonVariants } from './button';
import { useDirection, type Dir } from './direction';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Alternative pour les lecteurs d'écran (raccourci, chemin) ; le libellé par défaut. */
  altText?: string;
}

export interface ToastOptions {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Durée d'affichage en ms (5 s par défaut, `Infinity` pour rester). */
  duration?: number;
  action?: ToastAction;
}

export interface ToastItem extends ToastOptions {
  id: string;
  open: boolean;
}

// --------------------------------------------------------------------------
// Magasin minimal (module) : toast() fonctionne sans contexte React.
// --------------------------------------------------------------------------

const EXIT_MS = 220;
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit(next: ToastItem[]) {
  items = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isOptions(v: unknown): v is ToastOptions {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !('$$typeof' in v);
}

function show(message: ReactNode | ToastOptions, options: ToastOptions = {}): string {
  const opts: ToastOptions = isOptions(message) ? { ...message, ...options } : { ...options, title: message };
  const id = opts.id ?? `ud-toast-${++seq}`;
  const item: ToastItem = { ...opts, id, open: true };
  const exists = items.some((t) => t.id === id);
  emit(exists ? items.map((t) => (t.id === id ? item : t)) : [...items, item]);
  return id;
}

function dismiss(id?: string) {
  emit(items.map((t) => (id === undefined || t.id === id ? { ...t, open: false } : t)));
  setTimeout(() => emit(items.filter((t) => t.open || (id !== undefined && t.id !== id))), EXIT_MS);
}

type ToastFn = {
  (message: ReactNode | ToastOptions, options?: ToastOptions): string;
  success: (message: ReactNode, options?: ToastOptions) => string;
  warning: (message: ReactNode, options?: ToastOptions) => string;
  error: (message: ReactNode, options?: ToastOptions) => string;
  dismiss: (id?: string) => void;
};

export const toast: ToastFn = Object.assign(show, {
  success: (message: ReactNode, options?: ToastOptions) => show(message, { ...options, tone: 'success' }),
  warning: (message: ReactNode, options?: ToastOptions) => show(message, { ...options, tone: 'warning' }),
  error: (message: ReactNode, options?: ToastOptions) => show(message, { ...options, tone: 'danger' }),
  dismiss,
});

/** Toasts courants (tests, intégrations). */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, () => items, () => items);
}

// --------------------------------------------------------------------------
// Rendu
// --------------------------------------------------------------------------

const ICONS: Record<Exclude<ToastTone, 'neutral'>, ReactNode> = {
  success: <CircleCheck aria-hidden className="size-4 text-success" />,
  warning: <TriangleAlert aria-hidden className="size-4 text-warn" />,
  danger: <CircleAlert aria-hidden className="size-4 text-danger" />,
};

export interface ToasterProps {
  dir?: Dir;
  /** Durée par défaut en ms. */
  duration?: number;
}

export function Toaster({ dir, duration = 5000 }: ToasterProps) {
  const { t } = useUdTranslation();
  const direction = useDirection(dir);
  const list = useToasts();
  return (
    <ToastPrimitive.Provider label={t('toast.region')} duration={duration} swipeDirection={direction === 'rtl' ? 'right' : 'left'}>
      {list.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          data-slot="toast"
          data-tone={item.tone ?? 'neutral'}
          open={item.open}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
          duration={item.duration}
          type={item.tone === 'danger' ? 'foreground' : 'background'}
          dir={direction}
          className={cn(
            'pointer-events-auto relative flex w-full items-start gap-3 rounded-[12px] border border-float-border bg-popover p-3 pe-10 text-[13.5px] text-text-1 shadow-float',
            'duration-(--ud-dur-slow) ease-ud data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=cancel]:translate-x-0 data-[swipe=end]:animate-out',
          )}
        >
          {item.tone && item.tone !== 'neutral' && <span className="mt-0.5 shrink-0">{ICONS[item.tone]}</span>}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {item.title && <ToastPrimitive.Title className="font-medium">{item.title}</ToastPrimitive.Title>}
            {item.description && <ToastPrimitive.Description className="text-row text-text-2">{item.description}</ToastPrimitive.Description>}
          </div>
          {item.action && (
            <ToastPrimitive.Action
              altText={item.action.altText ?? item.action.label}
              onClick={item.action.onClick}
              className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'rounded-[7px]')}
            >
              {item.action.label}
            </ToastPrimitive.Action>
          )}
          <ToastPrimitive.Close
            aria-label={t('toast.close')}
            className={cn(
              'absolute end-2 top-2 inline-flex size-6 items-center justify-center rounded-sm text-text-2 ud-transition hover:bg-menu-hover hover:text-text-1',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            <X aria-hidden className="size-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        dir={direction}
        className="fixed start-0 bottom-0 z-(--ud-z-toast) flex max-h-dvh w-full flex-col-reverse gap-2 p-4 outline-none sm:max-w-[400px]"
      />
    </ToastPrimitive.Provider>
  );
}

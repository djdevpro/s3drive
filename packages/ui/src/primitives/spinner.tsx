/**
 * Spinner `loader-circle` : 0,8 s par tour, 1,5 s en mouvement réduit ; jamais plein
 * écran. Avec `slowAfterMs`, « Toujours en cours… » apparaît à côté passé ce délai (10 s par défaut).
 */
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState, type HTMLAttributes } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Taille en px (14 dans un bouton, 16 par défaut). */
  size?: number;
  /** Nom accessible ; `false` : décoratif (le parent porte `aria-busy`). */
  label?: string | false;
  /** Affiche « Toujours en cours… » après ce délai (ms) ; `true` = 10 s. */
  slowAfterMs?: number | boolean;
}

export function Spinner({ size = 16, label, slowAfterMs, className, ...props }: SpinnerProps) {
  const { t } = useUdTranslation();
  const delay = slowAfterMs === true ? 10_000 : typeof slowAfterMs === 'number' ? slowAfterMs : null;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (delay === null) return;
    const id = setTimeout(() => setSlow(true), delay);
    return () => clearTimeout(id);
  }, [delay]);

  const decorative = label === false;
  return (
    <span
      data-slot="spinner"
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : (label ?? t('common.loading'))}
      aria-hidden={decorative ? true : undefined}
      className={cn('inline-flex items-center gap-2 text-text-2', className)}
      {...props}
    >
      <LoaderCircle aria-hidden className="ud-spinner shrink-0" style={{ width: size, height: size }} />
      {slow && <span className="text-row">{t('common.loadingSlow')}</span>}
    </span>
  );
}

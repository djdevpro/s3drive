/**
 * QuotaMeter : « 312 Mo sur 1 Go », barre
 * --ud-meter-fill, --ud-meter-warn à 80 %, --ud-meter-full à 95 % ; la couleur n'est jamais seule :
 * icône et texte « presque plein » / « plein ». Sans quota : texte seul (« 312 Mo utilisés »).
 * Accessibilité : `role="meter"`, aria-valuenow|min|max, aria-valuetext = libellé.
 */
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useId, type HTMLAttributes } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';
import { formatBytes, type Digits } from '../lib/format';
import { Skeleton } from '../primitives/feedback';

export type QuotaLevel = 'normal' | 'warn' | 'full';

export const QUOTA_WARN_RATIO = 0.8;
export const QUOTA_FULL_RATIO = 0.95;

/** Niveau de la jauge : `warn` dès 80 %, `full` dès 95 % ; sans limite, toujours `normal`. */
export function quotaLevel(used: number, limit: number | null | undefined): QuotaLevel {
  if (!limit || limit <= 0) return 'normal';
  const ratio = used / limit;
  if (ratio >= QUOTA_FULL_RATIO) return 'full';
  if (ratio >= QUOTA_WARN_RATIO) return 'warn';
  return 'normal';
}

const FILL: Record<QuotaLevel, string> = {
  normal: 'bg-meter-fill',
  warn: 'bg-meter-warn',
  full: 'bg-meter-full',
};

export interface QuotaMeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Octets utilisés. */
  used: number;
  /** Plafond en octets ; `null`, `undefined` ou 0 : illimité. */
  limit?: number | null;
  /** Titre visible (« Stockage » par défaut) ; `false` pour le masquer. */
  title?: string | false;
  loading?: boolean;
  /** Locale de formatage (par défaut : langue i18next résolue). */
  locale?: string;
  digits?: Digits;
  /** `stacked` (défaut) : titre, barre, texte ; `inline` : barre fine d'Universal Email (pied de barre latérale). */
  layout?: 'stacked' | 'inline';
}

export function QuotaMeter({ used, limit, title, loading = false, locale, digits, layout = 'stacked', className, ...props }: QuotaMeterProps) {
  const { t, locale: lng } = useUdTranslation();
  const titleId = useId();
  const loc = locale ?? lng;
  const fmt = (n: number) => formatBytes(n, loc, digits ? { digits } : {});
  const unlimited = !limit || limit <= 0;
  const level = quotaLevel(used, limit);
  const text = unlimited ? t('quota.usedUnlimited', { used: fmt(used) }) : t('quota.usedOf', { used: fmt(used), total: fmt(limit) });
  const heading = title === false ? null : (title ?? t('quota.title'));

  if (loading) {
    return (
      <div data-slot="quota-meter" aria-busy="true" className={cn('flex flex-col gap-2', className)} {...props}>
        {heading && <span className="text-2xs text-text-2">{heading}</span>}
        <Skeleton className="h-1.5 w-full rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    );
  }

  const ratio = unlimited ? 0 : Math.min(1, Math.max(0, used / limit));

  if (layout === 'inline') {
    // Barre fine d'Universal Email (quota/QuotaBar.tsx) : titre et « x sur y » sur une ligne, barre de 4 px.
    return (
      <div data-slot="quota-meter" data-layout="inline" data-level={level} data-unlimited={unlimited || undefined} className={cn('text-[11.5px] text-text-2', className)} {...props}>
        <div className="mb-1 flex items-center justify-between gap-2">
          {heading && (
            <span id={titleId} className="truncate">
              {heading}
            </span>
          )}
          <span className={cn('tabular ms-auto shrink-0', level === 'full' ? 'font-medium text-danger-text' : level === 'warn' ? 'font-medium text-text-1' : '')}>{text}</span>
        </div>
        {!unlimited && (
          <div
            role="meter"
            aria-labelledby={heading ? titleId : undefined}
            aria-label={heading ? undefined : t('quota.title')}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={Math.min(used, limit)}
            aria-valuetext={text}
            className="relative h-1 w-full overflow-hidden rounded-full bg-progress-track"
          >
            <div
              data-slot="quota-meter-fill"
              className={cn('h-full origin-left rounded-full transition-transform duration-(--ud-dur-progress) ease-linear rtl:origin-right', FILL[level])}
              style={{ transform: `scaleX(${ratio})` }}
            />
          </div>
        )}
        {level !== 'normal' && (
          <span className="mt-1 inline-flex items-center gap-1 text-text-1">
            {level === 'full' ? <CircleAlert aria-hidden className="size-3.5 text-danger" /> : <TriangleAlert aria-hidden className="size-3.5 text-warn" />}
            {!unlimited && used >= limit ? t('quota.full') : t('quota.warn')}
          </span>
        )}
      </div>
    );
  }

  return (
    <div data-slot="quota-meter" data-level={level} data-unlimited={unlimited || undefined} className={cn('flex flex-col gap-1.5', className)} {...props}>
      {heading && (
        <span id={titleId} className="text-2xs text-text-2">
          {heading}
        </span>
      )}
      {!unlimited && (
        <div
          role="meter"
          aria-labelledby={heading ? titleId : undefined}
          aria-label={heading ? undefined : t('quota.title')}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={text}
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-progress-track"
        >
          <div
            data-slot="quota-meter-fill"
            className={cn('h-full origin-left rounded-full transition-transform duration-(--ud-dur-progress) ease-linear rtl:origin-right', FILL[level])}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
      )}
      <span className="tabular text-2xs font-normal text-text-2">{text}</span>
      {level !== 'normal' && (
        <span className="inline-flex items-center gap-1 text-2xs text-text-1">
          {level === 'full' ? <CircleAlert aria-hidden className="size-3.5 text-danger" /> : <TriangleAlert aria-hidden className="size-3.5 text-warn" />}
          {!unlimited && used >= limit ? t('quota.full') : t('quota.warn')}
        </span>
      )}
    </div>
  );
}

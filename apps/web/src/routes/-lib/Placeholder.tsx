import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Écran provisoire : nom de la vue et paramètres décodés, en attendant l'écran réel.
export interface PlaceholderProps {
  view: string;
  values?: Record<string, unknown>;
  children?: ReactNode;
  /** Niveau du titre : 2 quand la page a déjà un h1. */
  level?: 1 | 2;
}

export function Placeholder({ view, values = {}, children, level = 1 }: PlaceholderProps) {
  const { t } = useTranslation('common');
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  return (
    <section className="p-6" data-view={view}>
      {level === 1 ? (
        <h1 className="text-xl font-semibold">{t(`placeholder.views.${view}`)}</h1>
      ) : (
        <h2 className="text-xl font-semibold">{t(`placeholder.views.${view}`)}</h2>
      )}
      {entries.length > 0 && (
        <dl aria-label={t('placeholder.params')} className="mt-4 grid grid-cols-[auto_1fr] gap-x-4">
          {entries.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="font-mono">{name}</dt>
              <dd className="font-mono" dir="ltr" data-param={name}>
                {typeof value === 'string' ? value : JSON.stringify(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </section>
  );
}

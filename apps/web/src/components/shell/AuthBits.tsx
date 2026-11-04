import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, UD_LANGUAGES } from '@ud/ui';
import { CircleAlert, Info, Languages, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isLanguage, setLanguage } from '../../i18n';
import { AppLogo } from './AppLogo';

// Éléments des pages /login et /terms : marque, encadré de message, choix de la langue.

export function AuthLogo({ name }: { name?: string | undefined }) {
  return (
    <div className="flex items-center gap-2.5 text-text-1">
      <AppLogo size={36} />
      {name && (
        <span className="text-lg font-medium">
          <bdi>{name}</bdi>
        </span>
      )}
    </div>
  );
}

export type CalloutTone = 'neutral' | 'warning' | 'danger';

const CALLOUT: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  neutral: { box: 'border-tone-neutral-border bg-tone-neutral-bg', icon: 'text-tone-neutral-icon', Icon: Info },
  warning: { box: 'border-tone-warning-border bg-tone-warning-bg', icon: 'text-tone-warning-icon', Icon: TriangleAlert },
  danger: { box: 'border-tone-danger-border bg-tone-danger-bg', icon: 'text-tone-danger-icon', Icon: CircleAlert },
};

/** Encadré sobre : icône + titre + texte ; la couleur n'est jamais seule. */
export function Callout({ tone = 'neutral', title, children, role }: { tone?: CalloutTone; title?: ReactNode; children?: ReactNode; role?: 'alert' | 'status' }) {
  const style = CALLOUT[tone];
  return (
    <div role={role} data-tone={tone} className={cn('flex items-start gap-3 rounded-lg border p-3 text-start text-row text-text-1', style.box)}>
      <style.Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', style.icon)} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-text-2">{children}</div>}
      </div>
    </div>
  );
}

/** Choix de la langue hors session (pied des pages /login et /terms), mémorisé sur l'appareil. */
export function LanguagePicker() {
  const { t, i18n } = useTranslation('common');
  const current = i18n.resolvedLanguage ?? i18n.language;
  const name = UD_LANGUAGES.find((l) => l.code === current)?.name ?? current;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" icon={<Languages aria-hidden />} aria-label={t('language.choose', { language: name })}>
          {name}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuRadioGroup value={current} onValueChange={(value) => isLanguage(value) && void setLanguage(i18n, value)}>
          {UD_LANGUAGES.map((l) => (
            <DropdownMenuRadioItem key={l.code} value={l.code} lang={l.code} dir={l.dir}>
              {l.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

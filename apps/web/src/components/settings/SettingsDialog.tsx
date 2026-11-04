import type { MeResponse } from '@ud/contracts';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, SettingsPanel } from '@ud/ui';
import { Keyboard, Languages, Paintbrush, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type SettingsTab, useSettingsNav } from '../../lib/settings';
import { useMediaQuery } from '../shell/helpers';
import { AccountSection, AppearanceSection, LanguageSection, ShortcutsSection } from './sections';

/*
 * Paramètres de l'appli en surimpression (`?settings=<onglet>`), même charpente que le
 * SettingsDialog d'Universal Email : 980 × 720 px au plus, plein écran sous 768 px.
 */

const TABS = [
  { id: 'appearance', icon: Paintbrush },
  { id: 'language', icon: Languages },
  { id: 'account', icon: UserRound },
  { id: 'shortcuts', icon: Keyboard },
] as const satisfies ReadonlyArray<{ id: SettingsTab; icon: unknown }>;

export function SettingsDialog({ me }: { me: MeResponse }) {
  const { t } = useTranslation('settings');
  const { tab, select, close } = useSettingsNav();
  const mobile = useMediaQuery('(max-width: 767px)', false);
  const active: SettingsTab = tab ?? 'appearance';
  const tabs = TABS.map((entry) => ({ ...entry, label: t(`tabs.${entry.id}`) }));
  const label = t(`tabs.${active}`);

  return (
    <Dialog open={tab !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showClose={false}
        data-settings-tab={active}
        // focus sur le dialogue lui-même : pas d'anneau parasite sur le premier onglet à l'ouverture
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
        className={cn(
          'flex gap-0 overflow-hidden p-0',
          mobile ? 'h-dvh max-h-none w-full max-w-none rounded-none border-0' : 'h-[min(720px,90vh)] max-h-none w-[min(980px,94vw)] max-w-none',
        )}
      >
        <DialogDescription className="sr-only">{t('description')}</DialogDescription>
        <SettingsPanel
          title={t('title')}
          sectionsLabel={t('sections')}
          closeLabel={t('close')}
          tabs={tabs}
          active={active}
          onSelect={select}
          onClose={close}
          mobile={mobile}
          heading={
            <DialogTitle className="truncate text-[15px] font-semibold text-text-1">
              <span className="sr-only">{`${t('title')} · `}</span>
              {label}
            </DialogTitle>
          }
        >
          {active === 'appearance' && <AppearanceSection />}
          {active === 'language' && <LanguageSection />}
          {active === 'account' && <AccountSection me={me} />}
          {active === 'shortcuts' && <ShortcutsSection />}
        </SettingsPanel>
      </DialogContent>
    </Dialog>
  );
}

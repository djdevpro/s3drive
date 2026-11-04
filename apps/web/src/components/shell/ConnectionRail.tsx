import { AppRail, RailAddLink, RailBadge, RailButton, RailItem, useColorMode, useResolvedMode } from '@ud/ui';
import { Moon, PanelLeftOpen, Settings, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsNav } from '../../lib/settings';
import { AppLogo } from './AppLogo';
import { homeHref } from './helpers';

/*
 * Rail des connexions, comme le rail des boîtes d'Universal Email : logo, une pastille
 * par connexion (en mode instance, celle de l'instance, initiale de son nom sur l'accent), « + »
 * vers /connect quand les stockages personnels sont ouverts (mode `both`) ; en bas, thème
 * clair/sombre, Paramètres et, barre latérale repliée, le bouton pour la déplier.
 */
export function ConnectionRail({
  conn,
  instanceName,
  personal,
  active,
  collapsed,
  onExpand,
}: {
  conn: string;
  instanceName: string;
  personal: boolean;
  active: boolean;
  collapsed?: boolean;
  onExpand?: (() => void) | undefined;
}) {
  const { t } = useTranslation('common');
  const [, setMode] = useColorMode();
  const dark = useResolvedMode() === 'dark';
  const settings = useSettingsNav();
  const label = instanceName || conn;
  // Initiale de l'instance : première lettre ou chiffre de son nom.
  const initial = (/[\p{L}\p{N}]/u.exec(label)?.[0] ?? '?').toLocaleUpperCase();

  return (
    <AppRail
      label={t('rail.label')}
      header={<AppLogo size={30} />}
      footer={
        <>
          {collapsed && onExpand && (
            <RailButton label={t('shell.expandSidebar')} onClick={onExpand}>
              <PanelLeftOpen aria-hidden className="rtl:-scale-x-100" />
            </RailButton>
          )}
          <RailButton label={dark ? t('rail.lightTheme') : t('rail.darkTheme')} onClick={() => setMode(dark ? 'light' : 'dark')}>
            {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </RailButton>
          <RailButton label={t('rail.settings')} onClick={() => settings.open()} active={settings.tab !== null}>
            <Settings aria-hidden />
          </RailButton>
        </>
      }
    >
      <RailItem href={homeHref(conn)} label={label} active={active} color="var(--ud-accent)">
        <RailBadge label={label} text={initial} />
      </RailItem>
      {personal && <RailAddLink href="/connect" label={t('rail.add')} />}
    </AppRail>
  );
}

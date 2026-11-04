import { useLocation, useRouter } from '@tanstack/react-router';
import { HOME_SPACE, type MeResponse } from '@ud/contracts';
import { cn, IconButton, NavLink, QuotaMeter, SimpleTooltip, SpaceIcon } from '@ud/ui';
import { Lock, Menu, PanelLeftClose, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { canReadUsers } from '../../lib/api/queries/admin';
import { useSettingsNav } from '../../lib/settings';
import { SettingsDialog } from '../settings/SettingsDialog';
import { AccountControls } from './AccountControls';
import { AppLogo } from './AppLogo';
import { ConnectionRail } from './ConnectionRail';
import { homeHref, spaceHref, spaceLabel, useLayoutPrefs, useMediaQuery, writeLayout } from './helpers';

/*
 * Coquille du mode instance, disposition d'Universal Email (MailApp) :
 * rail des connexions sur fond --ud-rail, puis un panneau à coin arrondi (14 px) qui contient la
 * barre latérale (nom de l'instance, Mon drive, espaces partagés, Administration, jauge du quota,
 * compte en bas à gauche) et le contenu. ≥ 768 px : barre latérale repliable (mémorisé),
 * le rail reste ; < 768 px : barre du haut et tiroir (rail + barre latérale). Paramètres en
 * surimpression par `?settings=<onglet>` sur toutes les pages de la coquille.
 * Les vues Récents, Favoris, Partagés et Corbeille ne sont pas encore servies : absentes.
 */

export interface AppShellProps {
  me: MeResponse;
  instanceName: string;
  /** Stockages personnels ouverts (mode `both`) : « + » vers /connect dans le rail. */
  personal?: boolean;
  children: ReactNode;
}

export function AppShell({ me, instanceName, personal = false, children }: AppShellProps) {
  const { t } = useTranslation(['common', 'instance']);
  const mobile = !useMediaQuery('(min-width: 768px)');
  const { sidebarCollapsed } = useLayoutPrefs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const pathname = useLocation({ select: (l) => l.pathname });
  const settingsTab = useSettingsNav().tab;
  const conn = me.connection;
  const onConnection = pathname === `/d/${conn}` || pathname.startsWith(`/d/${encodeURIComponent(conn)}/`);

  // Le tiroir se referme à la navigation, à l'ouverture des paramètres et au passage en grand écran.
  useEffect(() => setDrawerOpen(false), [pathname, mobile, settingsTab]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    menuButton.current?.focus();
  };

  const skip = (
    <a
      href="#ud-main"
      className="sr-only z-(--ud-z-skip) rounded-md bg-panel px-3 py-2 text-row focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:border focus:border-float-border focus:shadow-float"
    >
      {t('common:shell.skipToContent')}
    </a>
  );
  const main = (
    <main id="ud-main" tabIndex={-1} inert={mobile && drawerOpen} className="relative min-w-0 flex-1 overflow-auto bg-panel outline-none">
      {children}
    </main>
  );
  const rail = (collapsed: boolean) => (
    <ConnectionRail
      conn={conn}
      instanceName={instanceName}
      personal={personal}
      active={onConnection}
      collapsed={collapsed}
      onExpand={collapsed ? () => writeLayout({ sidebarCollapsed: false }) : undefined}
    />
  );

  if (mobile) {
    return (
      <div className="flex h-dvh flex-col bg-panel text-text-1">
        {skip}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line ps-2 pe-3" inert={drawerOpen}>
          <IconButton ref={menuButton} aria-label={t('common:shell.openMenu')} aria-expanded={drawerOpen} aria-controls="ud-sidebar" onClick={() => setDrawerOpen(true)} size="lg">
            <Menu aria-hidden />
          </IconButton>
          <AppLogo size={24} />
          <span className="min-w-0 truncate text-[15px] font-semibold">
            <bdi>{instanceName}</bdi>
          </span>
        </header>
        {main}
        {drawerOpen && (
          <>
            <div aria-hidden data-slot="sidebar-overlay" className="fixed inset-0 z-(--ud-z-overlay) bg-(--ud-overlay) animate-in fade-in-0 duration-(--ud-dur)" onClick={closeDrawer} />
            <div
              id="ud-sidebar"
              data-mode="drawer"
              role="dialog"
              aria-modal
              aria-label={t('common:shell.navigation')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closeDrawer();
                }
              }}
              className="fixed inset-y-0 start-0 z-(--ud-z-dialog) flex w-[86%] max-w-[340px] border-e border-float-border bg-sidebar pt-[env(safe-area-inset-top)] shadow-float animate-in slide-in-from-left-full duration-(--ud-dur-slow) ease-(--ud-ease) rtl:slide-in-from-right-full"
            >
              {rail(false)}
              <Sidebar me={me} instanceName={instanceName} mode="drawer" onClose={closeDrawer} className="min-w-0 flex-1" />
            </div>
          </>
        )}
        <SettingsDialog me={me} />
      </div>
    );
  }

  return (
    <div className="flex h-dvh bg-rail text-text-1">
      {skip}
      {rail(sidebarCollapsed)}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-ss-[14px] border-s border-t border-line bg-panel shadow-[0_0_0_1px_var(--ud-line)]">
        {!sidebarCollapsed && (
          <Sidebar
            me={me}
            instanceName={instanceName}
            mode="full"
            onClose={() => writeLayout({ sidebarCollapsed: true })}
            className="w-[248px] shrink-0 border-e border-line"
          />
        )}
        {main}
      </div>
      <SettingsDialog me={me} />
    </div>
  );
}

interface NavEntry {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  hint?: string | undefined;
}

function Sidebar({
  me,
  instanceName,
  mode,
  onClose,
  className,
}: {
  me: MeResponse;
  instanceName: string;
  mode: 'full' | 'drawer';
  onClose: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation(['common', 'instance']);
  const router = useRouter();
  useLocation();
  const raw = router.history.location.pathname;
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const closeButton = useRef<HTMLButtonElement>(null);
  const conn = me.connection;

  useEffect(() => {
    if (mode === 'drawer') closeButton.current?.focus();
  }, [mode]);

  const isActive = (href: string) => raw === href.slice(0, -1) || raw.startsWith(href);
  const home: NavEntry = {
    href: homeHref(conn),
    label: t('instance:nav.myDrive'),
    icon: <SpaceIcon kind="home" size={16} />,
    active: isActive(homeHref(conn)),
  };
  const shared: NavEntry[] = me.spaces
    .filter((space) => space.id !== HOME_SPACE)
    .map((space) => {
      const href = spaceHref(conn, space.id);
      return {
        href,
        label: spaceLabel(space, lng),
        icon: <SpaceIcon kind="shared" size={16} />,
        active: isActive(href),
        hint: space.scopes.includes('write') ? undefined : t('instance:nav.readOnly'),
      };
    });
  const admin: NavEntry | null = canReadUsers(me)
    ? { href: '/admin', label: t('instance:nav.administration'), icon: <ShieldCheck aria-hidden />, active: raw === '/admin' || raw.startsWith('/admin/') }
    : null;

  const closeLabel = mode === 'drawer' ? t('common:shell.closeMenu') : t('common:shell.collapseSidebar');

  return (
    <aside data-pane="sidebar" {...(mode === 'full' ? { id: 'ud-sidebar', 'data-mode': mode } : {})} className={cn('flex min-h-0 flex-col bg-sidebar', className)}>
      <div className="flex h-16 shrink-0 items-center gap-2 ps-4 pe-2">
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-1">
          <bdi>{instanceName}</bdi>
        </span>
        <IconButton ref={closeButton} aria-label={closeLabel} tooltip={mode === 'full'} onClick={onClose}>
          {mode === 'drawer' ? <X aria-hidden /> : <PanelLeftClose aria-hidden className="rtl:-scale-x-100" />}
        </IconButton>
      </div>
      <nav aria-label={t('common:shell.navigation')} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <div className="space-y-px">
          <SidebarLink entry={home} />
        </div>
        {shared.length > 0 && (
          <section aria-labelledby="ud-nav-shared" className="mt-5">
            <h2 id="ud-nav-shared" className="mb-1 flex h-6 items-center px-2 text-[11.5px] font-medium tracking-wide text-text-2 uppercase">
              {t('instance:nav.sharedSpaces')}
            </h2>
            <ul className="space-y-px">
              {shared.map((entry) => (
                <li key={entry.href}>
                  <SidebarLink entry={entry} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {admin && (
          <div className="mt-5 space-y-px border-t border-line pt-3">
            <SidebarLink entry={admin} />
          </div>
        )}
      </nav>
      {/* jauge du quota, dessinée comme la QuotaBar d'Universal Email */}
      <div className="shrink-0 border-t border-line px-4 py-2.5">
        <QuotaMeter layout="inline" used={me.quota.used} limit={me.quota.limit} title={t('instance:quota.title')} />
      </div>
      <div className="shrink-0 border-t border-line p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <AccountControls me={me} />
      </div>
    </aside>
  );
}

function SidebarLink({ entry }: { entry: NavEntry }) {
  const link = (
    <NavLink
      href={entry.href}
      aria-current={entry.active ? 'page' : undefined}
      className={cn(
        'group relative flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-[13.5px] ud-transition outline-none select-none pointer-coarse:h-11',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        entry.active ? 'bg-ud-accent-soft font-medium text-text-1' : 'text-text-2 hover:bg-menu-hover hover:text-text-1',
      )}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center [&_svg]:size-[15px]',
          entry.active ? 'text-ud-accent-strong' : 'text-text-3 group-hover:text-text-2',
        )}
      >
        {entry.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <bdi>{entry.label}</bdi>
        {entry.hint && <span className="sr-only">{` (${entry.hint})`}</span>}
      </span>
      {entry.hint && <Lock aria-hidden className="size-3.5 shrink-0 text-text-3" />}
    </NavLink>
  );
  return entry.hint ? <SimpleTooltip content={entry.hint}>{link}</SimpleTooltip> : link;
}

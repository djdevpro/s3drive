import { HOME_SPACE, type MeResponse } from '@ud/contracts';
import {
  Avatar,
  Badge,
  Button,
  cn,
  ColorModePicker,
  formatBytes,
  KbdGroup,
  QuotaMeter,
  SettingRow,
  SettingsIntro,
  ThemePicker,
  UD_LANGUAGES,
  useUdTranslation,
} from '@ud/ui';
import { Check, LogOut } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { isLanguage, setLanguage } from '../../i18n';
import { roleLabel, spaceLabel } from '../shell/helpers';
import { useSignOut } from '../shell/AccountControls';

// Onglets des paramètres : Apparence, Langue, Compte, Raccourcis (même mise en page qu'Universal Email).

export function AppearanceSection() {
  const { t } = useUdTranslation();
  return (
    <div className="max-w-[680px]">
      <div className="border-b border-line pb-5">
        <div className="text-[13.5px] font-medium text-text-1">{t('appearance.collectionTitle')}</div>
        <div className="mt-0.5 mb-3 text-[12.5px] leading-relaxed text-text-2">{t('appearance.collectionDescription')}</div>
        <ThemePicker />
      </div>
      <SettingRow title={t('appearance.modeTitle')} description={t('appearance.modeDescription')}>
        <ColorModePicker />
      </SettingRow>
    </div>
  );
}

export function LanguageSection() {
  const { t, i18n } = useTranslation('settings');
  const current = i18n.resolvedLanguage ?? i18n.language;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const choose = (code: string) => {
    if (isLanguage(code)) void setLanguage(i18n, code);
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const target = (index + step + UD_LANGUAGES.length) % UD_LANGUAGES.length;
    const lang = UD_LANGUAGES[target];
    if (!lang) return;
    choose(lang.code);
    refs.current[target]?.focus();
  };
  return (
    <div className="max-w-[680px]">
      <SettingsIntro>{t('language.description')}</SettingsIntro>
      <div role="radiogroup" aria-label={t('language.title')} className="flex max-w-[360px] flex-col gap-px">
        {UD_LANGUAGES.map((lang, i) => {
          const active = lang.code === current;
          return (
            <button
              key={lang.code}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(lang.code)}
              onKeyDown={(event) => onKeyDown(event, i)}
              className={cn(
                'flex h-9 items-center gap-3 rounded-md px-3 text-start text-[13.5px] ud-transition',
                'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                active ? 'bg-ud-accent-soft font-medium text-text-1' : 'text-text-2 hover:bg-menu-hover hover:text-text-1',
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                <bdi lang={lang.code} dir={lang.dir}>
                  {lang.name}
                </bdi>
              </span>
              <span dir="ltr" className="text-[11.5px] text-text-2">
                {lang.code.toUpperCase()}
              </span>
              <Check aria-hidden className={cn('size-4 text-ud-accent-strong', active ? 'opacity-100' : 'opacity-0')} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AccountSection({ me }: { me: MeResponse }) {
  const { t, i18n } = useTranslation(['settings', 'instance']);
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const { signOut, pending } = useSignOut();
  const name = me.user.name || me.user.email || me.user.id;
  const shared = me.spaces.filter((space) => space.id !== HOME_SPACE);

  return (
    <div className="max-w-[680px]">
      <SettingRow title={t('settings:account.profile')} description={t('settings:account.profileDescription')}>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={name} size="lg" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13.5px] font-medium text-text-1">
              <bdi>{name}</bdi>
            </span>
            <span dir="ltr" className="truncate text-[12.5px] text-text-2 rtl:text-right">
              {me.user.email ?? t('settings:account.noEmail')}
            </span>
          </span>
        </span>
      </SettingRow>
      <SettingRow title={t('settings:account.roles')} description={t('settings:account.rolesDescription')}>
        <span className="flex flex-wrap gap-1">
          {me.user.roles.length > 0 ? (
            me.user.roles.map((role) => (
              <Badge key={role} tone="neutral">
                {roleLabel(t, role)}
              </Badge>
            ))
          ) : (
            <span className="text-[12.5px] text-text-2">{t('settings:account.noRoles')}</span>
          )}
        </span>
      </SettingRow>
      <div className="border-b border-line py-4">
        <div className="text-[13.5px] font-medium text-text-1">{t('settings:account.storage')}</div>
        <div className="mt-0.5 mb-3 text-[12.5px] leading-relaxed text-text-2">{t('settings:account.storageDescription')}</div>
        <QuotaMeter used={me.quota.used} limit={me.quota.limit} title={t('settings:account.myDrive')} className="max-w-[420px]" />
        {shared.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[11.5px] font-medium tracking-wide text-text-2 uppercase">{t('settings:account.sharedSpaces')}</div>
            <ul className="flex max-w-[420px] flex-col gap-3">
              {shared.map((space) => (
                <li key={space.id}>
                  {space.quota ? (
                    <QuotaMeter layout="inline" used={space.usage.bytes} limit={space.quota} title={spaceLabel(space, lng)} />
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-[11.5px] text-text-2">
                      <span className="truncate">
                        <bdi>{spaceLabel(space, lng)}</bdi>
                      </span>
                      <span className="tabular shrink-0">{t('settings:account.spaceUsage', { used: formatBytes(space.usage.bytes, lng) })}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <SettingRow title={t('settings:account.signOut')} description={t('settings:account.signOutDescription')}>
        <Button variant="secondary" size="sm" icon={<LogOut aria-hidden className="rtl:-scale-x-100" />} loading={pending} onClick={signOut}>
          {t('settings:account.signOut')}
        </Button>
      </SettingRow>
    </div>
  );
}

type Key = string | { k: string };
interface ShortcutDef {
  id: string;
  keys: Key[][];
}

// Raccourcis de l'explorateur (interactions.ts) et de l'aperçu (PreviewOverlay.tsx).
const SHORTCUT_GROUPS: Array<{ id: string; items: ShortcutDef[] }> = [
  {
    id: 'navigation',
    items: [
      { id: 'move', keys: [['↑'], ['↓'], ['←'], ['→']] },
      { id: 'firstLast', keys: [[{ k: 'home' }], [{ k: 'end' }]] },
      { id: 'page', keys: [[{ k: 'pageUp' }], [{ k: 'pageDown' }]] },
      { id: 'open', keys: [[{ k: 'enter' }]] },
      { id: 'openNewTab', keys: [['Ctrl', { k: 'enter' }]] },
    ],
  },
  {
    id: 'selection',
    items: [
      { id: 'toggle', keys: [[{ k: 'space' }]] },
      { id: 'extend', keys: [[{ k: 'shift' }, '↑'], [{ k: 'shift' }, '↓']] },
      { id: 'selectAll', keys: [['Ctrl', 'A']] },
      { id: 'clear', keys: [[{ k: 'esc' }]] },
    ],
  },
  {
    id: 'actions',
    items: [
      { id: 'rename', keys: [['F2']] },
      { id: 'delete', keys: [[{ k: 'delete' }]] },
      { id: 'copy', keys: [['Ctrl', 'C']] },
      { id: 'cut', keys: [['Ctrl', 'X']] },
      { id: 'paste', keys: [['Ctrl', 'V']] },
      { id: 'menu', keys: [[{ k: 'shift' }, 'F10'], [{ k: 'menu' }]] },
    ],
  },
  {
    id: 'preview',
    items: [
      { id: 'previewNav', keys: [['←'], ['→']] },
      { id: 'previewClose', keys: [[{ k: 'esc' }]] },
    ],
  },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function ShortcutsSection() {
  const { t } = useTranslation('settings');
  const label = (key: Key) => (typeof key === 'string' ? (key === 'Ctrl' && isMac ? '⌘' : key) : t(`shortcuts.keys.${key.k}`));
  return (
    <div>
      <SettingsIntro className="mb-5">{t('shortcuts.hint')}</SettingsIntro>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`ud-shortcuts-${group.id}`}>
            <h3 id={`ud-shortcuts-${group.id}`} className="mb-2 text-[11.5px] font-medium tracking-wide text-text-2 uppercase">
              {t(`shortcuts.groups.${group.id}`)}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id} className="flex min-h-7 items-center justify-between gap-3 text-[13px] text-text-2">
                  <span>{t(`shortcuts.items.${item.id}`)}</span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {item.keys.map((combo, i) => (
                      <KbdGroup key={i} keys={combo.map(label)} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

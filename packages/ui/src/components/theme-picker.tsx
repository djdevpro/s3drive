/**
 * Choix de l'apparence, repris d'Universal Email (PreferenceSections.tsx) :
 * - ThemePicker : une tuile par collection, avec une miniature de l'appli dans les couleurs réelles
 *   de la collection (le conteneur porte data-theme, et .dark en sombre), nom et description ;
 *   anneau d'accent animé sur la tuile choisie ; choix appliqué tout de suite (fondu croisé).
 * - ColorModePicker : clair, sombre ou système.
 * Textes : espace ud-ui (`themes`, `themeDescriptions`, `appearance`).
 */
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';
import { tBase } from '../lib/motion';
import { THEMES, useColorMode, useResolvedMode, useThemeId, type ColorMode, type ThemeId } from '../lib/themes';
import { useDirection } from '../primitives/direction';
import { Segmented } from '../primitives/segmented';

/** Miniature : rail, barre latérale (bouton « Nouveau », entrées), liste de fichiers. */
export function ThemeMiniature({ id, dark, className }: { id: ThemeId; dark: boolean; className?: string }) {
  return (
    <div
      data-theme={id}
      aria-hidden
      className={cn('pointer-events-none relative flex h-[76px] w-full overflow-hidden rounded-lg border border-line bg-app text-text-1', dark && 'dark', className)}
    >
      <div className="flex w-4 flex-col items-center gap-1 border-e border-line bg-rail pt-2">
        <div className="size-2 rounded-[3px] bg-ud-accent" />
        <div className="size-2 rounded-[3px] bg-line-strong" />
      </div>
      <div className="flex w-[30%] flex-col gap-1 border-e border-line bg-sidebar p-1.5">
        <div
          className="mb-0.5 flex h-2.5 items-center gap-0.5 rounded-[3px] border px-1"
          style={{ background: 'color-mix(in oklab, var(--ud-accent) 14%, var(--ud-panel))', borderColor: 'color-mix(in oklab, var(--ud-accent) 30%, var(--ud-line))' }}
        >
          <div className="size-1 rounded-full bg-ud-accent" />
          <div className="h-[2px] flex-1 rounded-full bg-text-2 opacity-70" />
        </div>
        <div className="h-[3px] w-4/5 rounded-full" style={{ background: 'color-mix(in oklab, var(--ud-accent) 40%, transparent)' }} />
        <div className="h-[3px] w-3/5 rounded-full bg-text-3 opacity-60" />
        <div className="h-[3px] w-2/3 rounded-full bg-text-3 opacity-60" />
      </div>
      <div className="flex flex-1 flex-col bg-panel">
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn('flex items-center gap-1 border-b border-line px-1.5 py-[5px]', i === 0 && 'bg-row-selected')}>
            <div className={cn('size-[7px] shrink-0 rounded-[2px]', i === 0 ? 'bg-ud-accent' : 'bg-text-3 opacity-50')} />
            <div className="flex flex-1 flex-col gap-[3px]">
              <div className={cn('h-[3px] rounded-full bg-text-1', i === 0 ? 'w-3/4' : 'w-1/2 opacity-80')} />
              <div className="h-[3px] w-full rounded-full bg-text-2 opacity-45" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ThemeTile({
  id,
  active,
  dark,
  group,
  onSelect,
  onKeyDown,
  buttonRef,
}: {
  id: ThemeId;
  active: boolean;
  dark: boolean;
  group: string;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const { t } = useUdTranslation();
  const name = t(`themes.${id}`);
  const description = t(`themeDescriptions.${id}`);
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={name}
      aria-description={description}
      tabIndex={active ? 0 : -1}
      data-theme-id={id}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex min-w-0 flex-col gap-2 rounded-xl border p-1.5 pb-2 text-start ud-transition',
        'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        active ? 'border-transparent' : 'border-line hover:border-line-strong hover:bg-row-hover',
      )}
    >
      {active && (
        <motion.span
          layoutId={`${group}-ring`}
          transition={tBase}
          className="pointer-events-none absolute -inset-px rounded-xl border-[1.5px] border-ud-accent ring-[3px] ring-ud-accent-soft"
        />
      )}
      <ThemeMiniature id={id} dark={dark} />
      <span className="flex min-w-0 items-start gap-1.5 px-0.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-text-1">{name}</span>
          <span className="block truncate text-[11.5px] text-text-2" title={description}>
            {description}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-ud-accent text-on-accent ud-transition [&_svg]:size-2.5',
            active ? 'scale-100 opacity-100' : 'scale-60 opacity-0',
          )}
        >
          <Check strokeWidth={3} />
        </span>
      </span>
    </button>
  );
}

export interface ThemePickerProps {
  /** Collection choisie ; par défaut, celle mémorisée (et `onChange` l'applique). */
  value?: ThemeId;
  onChange?: (id: ThemeId) => void;
  className?: string;
}

/** Grille des 10 collections (2 colonnes, 3 dès 640 px, 4 dès 768 px). */
export function ThemePicker({ value, onChange, className }: ThemePickerProps) {
  const { t } = useUdTranslation();
  const [stored, setStored] = useThemeId();
  const current = value ?? stored;
  const select = onChange ?? setStored;
  const dark = useResolvedMode() === 'dark';
  const rtl = useDirection() === 'rtl';
  const group = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const target = (index + step + THEMES.length) % THEMES.length;
    const theme = THEMES[target];
    if (!theme) return;
    select(theme.id);
    refs.current[target]?.focus();
  };

  return (
    <div data-slot="theme-picker" role="radiogroup" aria-label={t('appearance.collectionLabel')} className={cn('grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4', className)}>
      {THEMES.map((theme, i) => (
        <ThemeTile
          key={theme.id}
          id={theme.id}
          active={theme.id === current}
          dark={dark}
          group={group}
          onSelect={() => select(theme.id)}
          onKeyDown={(event) => onKeyDown(event, i)}
          buttonRef={(el) => {
            refs.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}

/** Clair, sombre ou système (mémorisé, appliqué tout de suite). */
export function ColorModePicker({ value, onChange, className }: { value?: ColorMode; onChange?: (mode: ColorMode) => void; className?: string }) {
  const { t } = useUdTranslation();
  const [stored, setStored] = useColorMode();
  return (
    <Segmented
      aria-label={t('appearance.modeTitle')}
      className={className}
      value={value ?? stored}
      onChange={onChange ?? setStored}
      options={[
        { value: 'light', label: t('appearance.light'), icon: <Sun aria-hidden /> },
        { value: 'dark', label: t('appearance.dark'), icon: <Moon aria-hidden /> },
        { value: 'system', label: t('appearance.system'), icon: <Monitor aria-hidden /> },
      ]}
    />
  );
}

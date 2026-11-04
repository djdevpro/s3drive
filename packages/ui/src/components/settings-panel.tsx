/**
 * SettingsPanel : charpente des paramètres en onglets, reprise d'Universal Email
 * (settings/SettingsDialog.tsx). Grand écran : liste des onglets de 220 px sur fond --ud-sidebar
 * (titre 15 px), contenu à droite avec un en-tête de 56 px (titre de l'onglet, Fermer) ; mobile :
 * onglets en bande défilante au-dessus du contenu. Fond de l'onglet actif glissé d'un onglet à
 * l'autre, contenu en fondu à l'entrée. L'hôte place ce panneau dans son `DialogContent` et gère
 * l'URL (`?settings=<onglet>`).
 */
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useId, type ComponentType, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { tFast } from '../lib/motion';

export interface SettingsPanelTab<T extends string = string> {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

export interface SettingsPanelProps<T extends string> {
  title: string;
  /** Nom accessible de la liste des onglets (« Sections »). */
  sectionsLabel: string;
  closeLabel: string;
  tabs: ReadonlyArray<SettingsPanelTab<T>>;
  active: T;
  onSelect: (id: T) => void;
  onClose: () => void;
  mobile?: boolean;
  /** Titre de l'onglet rendu par l'hôte (DialogTitle) ; sinon un h2. */
  heading?: ReactNode;
  children: ReactNode;
}

export function SettingsPanel<T extends string>({ title, sectionsLabel, closeLabel, tabs, active, onSelect, onClose, mobile = false, heading, children }: SettingsPanelProps<T>) {
  const group = useId();
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div data-slot="settings-panel" className={cn('flex min-h-0 w-full flex-1 overflow-hidden', mobile ? 'flex-col' : 'flex-row')}>
      <nav
        aria-label={sectionsLabel}
        className={cn('shrink-0 bg-sidebar', mobile ? 'flex gap-1 overflow-x-auto border-b border-line p-2 [scrollbar-width:none]' : 'w-[220px] border-e border-line p-3')}
      >
        {!mobile && <div className="px-2 pt-1 pb-3 text-[15px] font-semibold text-text-1">{title}</div>}
        {tabs.map((t) => {
          const selected = t.id === current?.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              data-tab={t.id}
              onClick={() => onSelect(t.id)}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'relative flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] whitespace-nowrap ud-transition',
                'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                !mobile && 'w-full',
                selected ? 'font-medium text-text-1' : 'text-text-2 hover:bg-menu-hover hover:text-text-1',
              )}
            >
              {selected && <motion.span layoutId={`${group}-tab`} aria-hidden className="absolute inset-0 rounded-md bg-ud-accent-soft" transition={tFast} />}
              <Icon aria-hidden className={cn('relative size-4', selected ? 'text-ud-accent-strong' : 'text-text-3')} />
              <span className="relative">{t.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line ps-6 pe-4">
          {heading ?? <h2 className="truncate text-[15px] font-semibold text-text-1">{current?.label}</h2>}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-2 ud-transition hover:bg-menu-hover hover:text-text-1 outline-none focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* fondu à l'entrée seulement : changer d'onglet n'attend jamais une animation de sortie */}
          <motion.div key={current?.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={tFast} className={cn('py-5', mobile ? 'px-4' : 'px-6')}>
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

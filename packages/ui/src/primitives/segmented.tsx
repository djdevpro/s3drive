/**
 * Segmented : choix exclusif court (2 à 4 options) en pastilles, repris d'Universal Email
 * (settings/ui.tsx) : piste grisée, option active sur fond panel avec ombre douce, 28 px de haut.
 * Accessibilité : `radiogroup` + `radio` (aria-checked), flèches pour passer d'une option à l'autre.
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useDirection } from './direction';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  'aria-label'?: string;
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, className, ...props }: SegmentedProps<T>) {
  const rtl = useDirection() === 'rtl';
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!next) return;
    event.preventDefault();
    const target = (index + next + options.length) % options.length;
    const option = options[target];
    if (!option) return;
    onChange(option.value);
    refs.current[target]?.focus();
  };
  return (
    <div data-slot="segmented" role="radiogroup" aria-label={props['aria-label']} className={cn('inline-flex rounded-lg bg-tone-neutral-bg p-0.5', className)}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(event) => onKeyDown(event, i)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium ud-transition [&_svg]:size-3.5',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
              active ? 'bg-panel text-text-1 shadow-(--ud-shadow-soft)' : 'text-text-2 hover:text-text-1',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

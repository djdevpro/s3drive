/**
 * SettingRow : ligne de réglage des paramètres, reprise d'Universal Email (settings/ui.tsx) :
 * titre 13,5 px, description 12,5 px, contrôle du côté de fin (empilé sous 640 px), filet entre lignes.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function SettingRow({ title, description, children, className }: SettingRowProps) {
  return (
    <div
      data-slot="setting-row"
      className={cn('flex flex-col gap-3 border-b border-line py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-8', className)}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-text-1">{title}</div>
        {description && <div className="mt-0.5 text-[12.5px] leading-relaxed text-text-2">{description}</div>}
      </div>
      {children !== undefined && <div className="min-w-0 shrink-0">{children}</div>}
    </div>
  );
}

/** Paragraphe d'introduction d'une section de paramètres. */
export function SettingsIntro({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('mb-4 max-w-[560px] text-[13px] leading-relaxed text-text-2', className)}>{children}</p>;
}

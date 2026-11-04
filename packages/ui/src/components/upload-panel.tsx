/**
 * UploadPanel : section « Transferts » du dock du coin bas
 * côté fin, largeur --ud-transfers-w, bord --ud-float-border, ombre flottante. Masqué sans envoi ;
 * replié (« 3 en cours · 42 % · environ 2 min restantes ») ou déplié ; filtres En cours / Terminés /
 * Erreurs. Ligne : icône, nom, dossier, barre (`role="progressbar"`, `aria-valuetext`), état en texte,
 * débit et temps restant, actions nommées avec le fichier. Erreurs traduites (quota : reste disponible).
 * Aucune logique réseau : données et callbacks en props (l'hôte branche `@ud/sdk/upload`).
 */
import type { UploadState } from '@ud/sdk/upload';
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, FolderOpen, Pause, Play, RotateCw, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { useUdTranslation } from '../i18n';
import { cn } from '../lib/cn';
import { formatBytes, formatLocale, formatPercent, type Digits } from '../lib/format';
import { Button } from '../primitives/button';
import { Progress, type ProgressTone } from '../primitives/feedback';
import { IconButton } from '../primitives/icon-button';
import { FileIcon } from './file-icon';

export type { UploadState };

export interface UploadPanelError {
  code: string;
  reason?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface UploadPanelItem {
  id: string;
  name: string;
  /** Dossier de destination affiché (« Mon drive / Photos »). */
  folder?: string;
  size: number;
  /** Octets envoyés (affichage monotone fourni par le moteur). */
  sent: number;
  state: UploadState;
  contentType?: string;
  /** Octets par seconde. */
  speed?: number;
  /** Millisecondes restantes, `null` si inconnu. */
  remainingMs?: number | null;
  error?: UploadPanelError;
}

export type UploadFilter = 'active' | 'done' | 'errors';
export type ConflictResolution = 'overwrite' | 'rename' | 'skip';

export interface UploadPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'onPause'> {
  items: UploadPanelItem[];
  /** Replié (contrôlé) ; sinon état interne, initialisé par `defaultCollapsed`. */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  filter?: UploadFilter;
  onFilterChange?: (filter: UploadFilter) => void;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onCancel?: (id: string) => void;
  onRetry?: (id: string) => void;
  onShowInFolder?: (id: string) => void;
  /** Nouvelle sélection d'un fichier perdu au rechargement (`needs_file`). */
  onReselect?: (id: string) => void;
  onResolveConflict?: (id: string, choice: ConflictResolution) => void;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onCancelAll?: () => void;
  onClearFinished?: () => void;
  onClose?: () => void;
  /** Locale de formatage (par défaut : langue i18next résolue). */
  locale?: string;
  digits?: Digits;
}

const ACTIVE: readonly UploadState[] = ['queued', 'uploading', 'paused', 'waiting_network', 'waiting_auth', 'completing', 'needs_file', 'conflict'];
const FINISHED: readonly UploadState[] = ['done', 'canceled', 'skipped'];
const RUNNING: readonly UploadState[] = ['queued', 'uploading', 'waiting_network', 'completing'];

/** Clé de traduction et variables du message d'une erreur d'envoi (06 annexe A). */
export function uploadErrorMessage(error: UploadPanelError): { key: string; remaining?: number } {
  const remaining = typeof error.details?.['remaining'] === 'number' ? (error.details['remaining'] as number) : undefined;
  if (error.code === 'quota_exceeded') {
    const key = error.details?.['limit'] === 'space_quota' ? 'uploadError.space_quota' : 'uploadError.quota_exceeded';
    return remaining === undefined ? { key: `${key}NoValue` } : { key, remaining };
  }
  if (error.reason === 'upload_gone') return { key: 'uploadError.upload_gone' };
  const local = error.code.startsWith('local.') ? error.code.slice('local.'.length) : null;
  const known = [
    'access_denied',
    'scope_denied',
    'forbidden',
    'already_exists',
    'validation',
    'entity_too_large',
    'unauthorized',
    'slow_down',
    'network',
    'file_changed',
    'reselect_mismatch',
    'file_unreadable',
  ];
  const code = local ?? error.code;
  return { key: known.includes(code) ? `uploadError.${code}` : 'uploadError.generic' };
}

/** Durée lisible arrondie (« 45 s », « 3 min », « 2 h »). */
export function formatRemaining(ms: number, locale: string, digits?: Digits): string {
  const loc = formatLocale(locale, digits ? { digits } : {});
  const seconds = Math.max(1, Math.round(ms / 1000));
  const unit = (value: number, u: 'second' | 'minute' | 'hour') => new Intl.NumberFormat(loc, { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: 0 }).format(value);
  if (seconds < 60) return unit(Math.max(5, Math.ceil(seconds / 5) * 5), 'second');
  if (seconds < 3600) return unit(Math.ceil(seconds / 60), 'minute');
  return unit(Math.round(seconds / 3600), 'hour');
}

function toneOf(state: UploadState): ProgressTone {
  if (state === 'done') return 'done';
  if (state === 'error') return 'error';
  if (state === 'paused' || state === 'waiting_network' || state === 'waiting_auth' || state === 'needs_file' || state === 'conflict') return 'paused';
  return 'default';
}

function matches(item: UploadPanelItem, filter: UploadFilter): boolean {
  if (filter === 'errors') return item.state === 'error';
  if (filter === 'done') return FINISHED.includes(item.state);
  return ACTIVE.includes(item.state);
}

export function UploadPanel({
  items,
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onCollapsedChange,
  filter: filterProp,
  onFilterChange,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onShowInFolder,
  onReselect,
  onResolveConflict,
  onPauseAll,
  onResumeAll,
  onCancelAll,
  onClearFinished,
  onClose,
  locale,
  digits,
  className,
  ...props
}: UploadPanelProps) {
  const { t, locale: lng } = useUdTranslation();
  const loc = locale ?? lng;
  const titleId = useId();
  const listId = useId();
  const [innerCollapsed, setInnerCollapsed] = useState(defaultCollapsed);
  const collapsed = collapsedProp ?? innerCollapsed;
  const setCollapsed = (next: boolean) => {
    if (collapsedProp === undefined) setInnerCollapsed(next);
    onCollapsedChange?.(next);
  };
  const errorsCount = items.filter((i) => i.state === 'error').length;
  const activeCount = items.filter((i) => ACTIVE.includes(i.state)).length;
  const [innerFilter, setInnerFilter] = useState<UploadFilter>('active');
  const filter = filterProp ?? innerFilter;
  const setFilter = (next: UploadFilter) => {
    if (filterProp === undefined) setInnerFilter(next);
    onFilterChange?.(next);
  };

  const fmtBytes = (n: number) => formatBytes(n, loc, digits ? { digits } : {});
  const totals = useMemo(() => {
    let bytes = 0;
    let sent = 0;
    let speed = 0;
    let remaining: number | null = null;
    for (const item of items) {
      if (item.state === 'canceled' || item.state === 'skipped' || item.state === 'error') continue;
      bytes += item.size;
      sent += Math.min(item.size, item.sent);
      if (RUNNING.includes(item.state)) speed += item.speed ?? 0;
    }
    if (speed > 0 && bytes > sent) remaining = ((bytes - sent) / speed) * 1000;
    const known = items.some((i) => RUNNING.includes(i.state) && typeof i.remainingMs === 'number');
    return { bytes, sent, speed, remainingMs: known ? remaining : null, ratio: bytes > 0 ? sent / bytes : activeCount === 0 ? 1 : 0 };
  }, [items, activeCount]);

  // Annonces : fin de lot (poli), échec (assertif).
  const [politeMessage, setPolite] = useState('');
  const [assertiveMessage, setAssertive] = useState('');
  const previous = useRef<{ active: number; failed: Set<string> }>({ active: activeCount, failed: new Set(items.filter((i) => i.state === 'error').map((i) => i.id)) });
  useEffect(() => {
    const before = previous.current;
    if (before.active > 0 && activeCount === 0 && items.some((i) => i.state === 'done')) setPolite(t('upload.announceDone'));
    const failedNow = items.filter((i) => i.state === 'error');
    const fresh = failedNow.find((i) => !before.failed.has(i.id));
    if (fresh) setAssertive(t('upload.announceFailed', { name: fresh.name }));
    previous.current = { active: activeCount, failed: new Set(failedNow.map((i) => i.id)) };
  }, [items, activeCount, t]);

  if (items.length === 0) return null;

  const percent = formatPercent(totals.ratio, loc, digits ? { digits } : {});
  const remainingText = totals.remainingMs !== null ? t('upload.remaining', { time: formatRemaining(totals.remainingMs, loc, digits) }) : null;
  const summary =
    activeCount > 0 ? [t('upload.summary', { count: activeCount, percent }), remainingText].filter(Boolean).join(' · ') : errorsCount > 0 ? t('upload.filterErrors', { count: errorsCount }) : t('upload.summaryDone');
  const visible = items.filter((i) => matches(i, filter));
  const anyPausable = items.some((i) => RUNNING.includes(i.state));
  const anyResumable = items.some((i) => i.state === 'paused' || i.state === 'waiting_auth');
  const anyFinished = items.some((i) => FINISHED.includes(i.state));

  return (
    <section
      data-slot="upload-panel"
      data-collapsed={collapsed || undefined}
      aria-labelledby={titleId}
      className={cn(
        'flex max-h-[50vh] w-(--ud-transfers-w) max-w-full flex-col overflow-hidden rounded-lg border border-float-border bg-panel text-text-1 shadow-float',
        className,
      )}
      {...props}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <Upload aria-hidden className="size-4 shrink-0 text-text-2" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id={titleId} className="text-row font-medium">
            {t('upload.region')}
          </h2>
          <span data-slot="upload-panel-summary" className="tabular truncate text-2xs text-text-2">
            {summary}
          </span>
        </div>
        {!collapsed && anyPausable && onPauseAll && (
          <IconButton size="sm" aria-label={t('upload.pauseAll')} onClick={onPauseAll}>
            <Pause aria-hidden />
          </IconButton>
        )}
        {!collapsed && anyResumable && onResumeAll && (
          <IconButton size="sm" aria-label={t('upload.resumeAll')} onClick={onResumeAll}>
            <Play aria-hidden />
          </IconButton>
        )}
        <IconButton size="sm" aria-label={collapsed ? t('upload.expand') : t('upload.collapse')} aria-expanded={!collapsed} aria-controls={listId} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
        </IconButton>
        {onClose && activeCount === 0 && (
          <IconButton size="sm" aria-label={t('upload.close')} onClick={onClose}>
            <X aria-hidden />
          </IconButton>
        )}
      </header>
      <div className="px-3 pb-2">
        <Progress
          aria-label={t('upload.progressTotal')}
          value={Math.round(totals.ratio * 100)}
          max={100}
          getValueLabel={() => [percent, remainingText].filter(Boolean).join(', ')}
          tone={activeCount === 0 && errorsCount > 0 ? 'error' : activeCount === 0 ? 'done' : 'default'}
        />
      </div>
      <div id={listId} hidden={collapsed} className="flex min-h-0 flex-col border-t border-line">
        <div role="group" aria-label={t('upload.filterLabel')} className="flex items-center gap-1 px-2 py-1.5">
          {(['active', 'done', 'errors'] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'tonal' : 'ghost'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'errors' ? t('upload.filterErrors', { count: errorsCount }) : t(f === 'active' ? 'upload.filterActive' : 'upload.filterDone')}
            </Button>
          ))}
          <span className="flex-1" />
          {filter === 'done' && anyFinished && onClearFinished && (
            <Button size="sm" variant="ghost" onClick={onClearFinished}>
              {t('upload.clearFinished')}
            </Button>
          )}
          {filter === 'active' && activeCount > 0 && onCancelAll && (
            <Button size="sm" variant="ghost" onClick={onCancelAll}>
              {t('upload.cancelAll')}
            </Button>
          )}
        </div>
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-center text-2xs text-text-2">{t('upload.empty')}</p>
        ) : (
          <ul aria-label={t('upload.region')} className="min-h-0 overflow-y-auto pb-1">
            {visible.map((item) => (
              <UploadRow
                key={item.id}
                item={item}
                locale={loc}
                digits={digits}
                fmtBytes={fmtBytes}
                {...{ onPause, onResume, onCancel, onRetry, onShowInFolder, onReselect, onResolveConflict }}
              />
            ))}
          </ul>
        )}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {politeMessage}
      </span>
      <span role="alert" aria-live="assertive" className="sr-only">
        {assertiveMessage}
      </span>
    </section>
  );
}

interface UploadRowProps extends Pick<UploadPanelProps, 'onPause' | 'onResume' | 'onCancel' | 'onRetry' | 'onShowInFolder' | 'onReselect' | 'onResolveConflict'> {
  item: UploadPanelItem;
  locale: string;
  digits: Digits | undefined;
  fmtBytes: (n: number) => string;
}

function UploadRow({ item, locale, digits, fmtBytes, onPause, onResume, onCancel, onRetry, onShowInFolder, onReselect, onResolveConflict }: UploadRowProps) {
  const { t } = useUdTranslation();
  const { id, name, state } = item;
  const ratio = item.size > 0 ? Math.min(1, item.sent / item.size) : state === 'done' ? 1 : 0;
  const percent = formatPercent(ratio, locale, digits ? { digits } : {});
  const running = state === 'uploading' || state === 'completing';
  const remaining = running && typeof item.remainingMs === 'number' ? t('upload.remaining', { time: formatRemaining(item.remainingMs, locale, digits) }) : null;
  const speed = running && item.speed ? t('upload.speed', { size: fmtBytes(item.speed) }) : null;
  const errorText = (() => {
    if (state !== 'error' || !item.error) return null;
    const message = uploadErrorMessage(item.error);
    return t(message.key, message.remaining !== undefined ? { remaining: fmtBytes(message.remaining) } : {});
  })();
  const stateText = errorText ?? t(`uploadState.${state}`);
  const finished = FINISHED.includes(state);

  return (
    <li data-slot="upload-row" data-state={state} className="flex items-start gap-2.5 px-3 py-2 hover:bg-row-hover">
      <FileIcon name={name} contentType={item.contentType} size={24} className="mt-0.5" state={state === 'error' ? 'error' : 'normal'} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span data-slot="upload-row-name" className="min-w-0 flex-1 truncate text-row font-medium">
            <bdi>{name}</bdi>
          </span>
          <span className="tabular shrink-0 text-2xs text-text-2">{finished || state === 'error' ? fmtBytes(item.size) : t('upload.sizeOf', { sent: fmtBytes(item.sent), total: fmtBytes(item.size) })}</span>
        </div>
        {item.folder && (
          <span className="truncate text-2xs text-text-2">
            <bdi>{item.folder}</bdi>
          </span>
        )}
        {!finished && state !== 'error' && state !== 'conflict' && (
          <Progress
            aria-label={t('upload.progress', { name })}
            value={Math.round(ratio * 100)}
            max={100}
            tone={toneOf(state)}
            getValueLabel={() => [percent, remaining].filter(Boolean).join(', ')}
          />
        )}
        <span data-slot="upload-row-state" className={cn('flex items-center gap-1 text-2xs', state === 'error' ? 'text-danger-text' : 'text-text-2')}>
          {state === 'done' && <CircleCheck aria-hidden className="size-3.5 text-success" />}
          {state === 'error' && <CircleAlert aria-hidden className="size-3.5 text-danger" />}
          <span>{stateText}</span>
          {speed && <span className="tabular">· {speed}</span>}
          {remaining && <span className="tabular">· {remaining}</span>}
        </span>
        {state === 'conflict' && onResolveConflict && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" variant="secondary" onClick={() => onResolveConflict(id, 'overwrite')}>
              {t('upload.replace')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onResolveConflict(id, 'rename')}>
              {t('upload.keepBoth')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onResolveConflict(id, 'skip')}>
              {t('upload.skip')}
            </Button>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {(state === 'uploading' || state === 'queued' || state === 'waiting_network') && onPause && (
          <IconButton size="sm" aria-label={t('upload.pause', { name })} onClick={() => onPause(id)}>
            <Pause aria-hidden />
          </IconButton>
        )}
        {(state === 'paused' || state === 'waiting_auth') && onResume && (
          <IconButton size="sm" aria-label={t('upload.resume', { name })} onClick={() => onResume(id)}>
            <Play aria-hidden />
          </IconButton>
        )}
        {state === 'needs_file' && onReselect && (
          <IconButton size="sm" aria-label={t('upload.reselect', { name })} onClick={() => onReselect(id)}>
            <FolderOpen aria-hidden />
          </IconButton>
        )}
        {state === 'error' && onRetry && (item.error?.retryable !== false || item.error.code === 'quota_exceeded') && (
          <IconButton size="sm" aria-label={t('upload.retry', { name })} onClick={() => onRetry(id)}>
            <RotateCw aria-hidden />
          </IconButton>
        )}
        {state === 'done' && onShowInFolder && (
          <IconButton size="sm" aria-label={t('upload.showInFolder', { name })} onClick={() => onShowInFolder(id)}>
            <FolderOpen aria-hidden />
          </IconButton>
        )}
        {!finished && onCancel && (
          <IconButton size="sm" aria-label={t('upload.cancel', { name })} onClick={() => onCancel(id)}>
            {state === 'error' ? <Trash2 aria-hidden /> : <X aria-hidden />}
          </IconButton>
        )}
      </div>
    </li>
  );
}

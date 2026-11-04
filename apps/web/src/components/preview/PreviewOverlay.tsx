import { useQuery } from '@tanstack/react-query';
import { keyName } from '@ud/contracts';
import { Button, FileIcon, IconButton, Spinner, cn, formatBytes, useDirection, useUdTranslation } from '@ud/ui';
import { ChevronLeft, ChevronRight, Download, FileQuestion, Link2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useObject, useObjectUrl } from '../../lib/api/queries/objects';
import { apiError } from '../explorer/errors';
import { TEXT_PREVIEW_MAX_BYTES, isForeignOrigin, previewKind } from './kind';

/*
 * Aperçu en surimpression sur le dossier parent (06 aperçus simples) : barre
 * (nom, Télécharger, Copier le lien, Fermer), ← / → entre les fichiers du dossier (l'hôte
 * remplace l'entrée d'historique), Échap ferme. Le contenu n'est jamais interprété dans
 * l'origine de l'appli : images en `<img>`, HTML en iframe `sandbox` sans scripts,
 * texte lu par fetch et rendu comme texte.
 */

export interface PreviewOverlayProps {
  conn: string;
  bucket: string;
  fileKey: string;
  /** Fichiers du dossier, dans l'ordre affiché (navigation ← / →). */
  siblings: readonly string[];
  onNavigate: (key: string) => void;
  onClose: () => void;
  onDownload: (key: string) => void;
  onCopyLink: (key: string) => void;
}

export function PreviewOverlay({ conn, bucket, fileKey, siblings, onNavigate, onClose, onDownload, onCopyLink }: PreviewOverlayProps) {
  const { t } = useTranslation('preview');
  const { locale } = useUdTranslation();
  const direction = useDirection();
  const closeRef = useRef<HTMLButtonElement>(null);
  const name = keyName(fileKey);
  const details = useObject(conn, bucket, fileKey);
  const index = siblings.indexOf(fileKey);
  const prev = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;

  // Focus dans la visionneuse, rendu au déclencheur à la fermeture.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (target instanceof Element && target.closest('video, audio, input, textarea')) return;
      const goPrev = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      const goNext = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === goPrev && prev) {
        event.preventDefault();
        onNavigate(prev);
      } else if (event.key === goNext && next) {
        event.preventDefault();
        onNavigate(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [direction, next, onClose, onNavigate, prev]);

  const notFound = details.isError && ['key_not_found', 'access_denied'].includes(apiError(details.error)?.code ?? '');

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('label', { name })}
      dir={direction}
      data-preview={fileKey}
      className="fixed inset-0 z-(--ud-z-viewer) flex flex-col bg-(--ud-viewer-scrim) text-(--ud-viewer-fg) animate-in fade-in duration-200"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-(--ud-viewer-line) bg-(--ud-viewer-chrome) px-2 sm:px-3">
        <ViewerButton ref={closeRef} label={t('close')} onClick={onClose}>
          <X className="size-5" />
        </ViewerButton>
        <FileIcon name={name} size={20} className="ms-1" />
        <h2 className="min-w-0 flex-1 truncate text-md font-medium">
          <bdi>{name}</bdi>
        </h2>
        {details.data && <span className="hidden text-row text-(--ud-viewer-fg-2) tabular-nums sm:inline">{formatBytes(details.data.size, locale)}</span>}
        <ViewerButton label={t('copyLink')} onClick={() => onCopyLink(fileKey)}>
          <Link2 className="size-5" />
        </ViewerButton>
        <ViewerButton label={t('download')} onClick={() => onDownload(fileKey)}>
          <Download className="size-5" />
        </ViewerButton>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:p-6">
        {prev && (
          <ViewerButton label={t('previous')} onClick={() => onNavigate(prev)} className="absolute start-2 top-1/2 z-1 -translate-y-1/2 sm:start-4" round>
            <ChevronLeft className="size-6 rtl:-scale-x-100" />
          </ViewerButton>
        )}
        {notFound ? (
          <Unavailable title={t('notFound.title')} body={t('notFound.body')} />
        ) : (
          <PreviewBody conn={conn} bucket={bucket} fileKey={fileKey} name={name} contentType={details.data?.contentType} size={details.data?.size} onDownload={() => onDownload(fileKey)} />
        )}
        {next && (
          <ViewerButton label={t('next')} onClick={() => onNavigate(next)} className="absolute end-2 top-1/2 z-1 -translate-y-1/2 sm:end-4" round>
            <ChevronRight className="size-6 rtl:-scale-x-100" />
          </ViewerButton>
        )}
      </div>
      {siblings.length > 1 && index >= 0 && (
        <p className="pb-3 text-center text-2xs font-normal text-(--ud-viewer-fg-2) tabular-nums" aria-live="polite">
          {t('position', { index: index + 1, total: siblings.length })}
        </p>
      )}
    </div>,
    document.body,
  );
}

function ViewerButton({ label, onClick, children, className, round, ref }: { label: string; onClick: () => void; children: React.ReactNode; className?: string; round?: boolean; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center text-(--ud-viewer-fg) transition-colors duration-150',
        'hover:bg-(--ud-viewer-btn-hover) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ud-viewer-focus)',
        round ? 'size-11 rounded-full bg-(--ud-viewer-chrome)' : 'rounded-full',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Unavailable({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-(--ud-viewer-line) bg-(--ud-viewer-chrome) px-8 py-10 text-center">
      <FileQuestion aria-hidden className="size-10 text-(--ud-viewer-fg-2)" />
      <p className="text-lg">{title}</p>
      {body && <p className="text-row text-(--ud-viewer-fg-2)">{body}</p>}
      {action}
    </div>
  );
}

interface BodyProps {
  conn: string;
  bucket: string;
  fileKey: string;
  name: string;
  contentType: string | undefined;
  size: number | undefined;
  onDownload: () => void;
}

function PreviewBody({ conn, bucket, fileKey, name, contentType, size, onDownload }: BodyProps) {
  const { t } = useTranslation('preview');
  const kind = previewKind(name, contentType);
  const tooLarge = kind === 'text' && size !== undefined && size > TEXT_PREVIEW_MAX_BYTES;
  const wantsUrl = kind !== 'none' && !tooLarge;
  const url = useObjectUrl(conn, bucket, fileKey, { enabled: wantsUrl });

  const downloadAction = (
    <Button variant="secondary" icon={<Download className="size-4" />} onClick={onDownload}>
      {t('download')}
    </Button>
  );

  if (!wantsUrl) return <Unavailable title={t(tooLarge ? 'tooLarge' : 'unavailable')} body={t('unavailableBody')} action={downloadAction} />;
  if (url.isError) return <Unavailable title={t('unavailable')} body={t('loadError')} action={downloadAction} />;
  if (!url.data) return <Spinner size={28} label={t('loading')} slowAfterMs={10_000} />;
  const src = url.data.url;

  switch (kind) {
    case 'image':
      return <img key={src} src={src} alt={name} referrerPolicy="no-referrer" className="max-h-full max-w-full rounded-sm object-contain shadow-2xl" />;
    case 'video':
      return <video key={src} src={src} controls playsInline className="max-h-full max-w-full rounded-md bg-black" aria-label={name} />;
    case 'audio':
      return (
        <div className="flex w-full max-w-md flex-col items-center gap-6">
          <FileIcon name={name} size={64} />
          <audio key={src} src={src} controls className="w-full" aria-label={name} />
        </div>
      );
    case 'pdf':
      // Lecteur PDF du navigateur : seulement depuis une autre origine que l'appli.
      if (!isForeignOrigin(src)) return <Unavailable title={t('unavailable')} body={t('unavailableBody')} action={downloadAction} />;
      return <iframe key={src} src={src} title={name} className="size-full max-w-5xl rounded-md border-0 bg-white" referrerPolicy="no-referrer" />;
    case 'html':
      // Sans scripts, sans formulaires, origine opaque.
      return <iframe key={src} src={src} title={name} sandbox="" className="size-full max-w-5xl rounded-md border-0 bg-white" referrerPolicy="no-referrer" />;
    case 'text':
      return <TextPreview url={src} name={name} onDownload={downloadAction} />;
    default:
      return <Unavailable title={t('unavailable')} body={t('unavailableBody')} action={downloadAction} />;
  }
}

function TextPreview({ url, name, onDownload }: { url: string; name: string; onDownload: React.ReactNode }) {
  const { t } = useTranslation('preview');
  const text = useQuery({
    queryKey: ['ud', 'preview-text', url],
    queryFn: async ({ signal }) => {
      const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      return new TextDecoder('utf-8').decode(buffer.slice(0, TEXT_PREVIEW_MAX_BYTES));
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (text.isError) return <Unavailable title={t('unavailable')} body={t('loadError')} action={onDownload} />;
  if (text.data === undefined) return <Spinner size={28} label={t('loading')} />;
  return (
    <pre
      aria-label={name}
      tabIndex={0}
      dir="auto"
      className="size-full max-w-5xl overflow-auto rounded-lg border border-(--ud-viewer-line) bg-(--ud-viewer-chrome) p-4 font-mono text-row whitespace-pre-wrap break-words text-(--ud-viewer-fg) select-text outline-none focus-visible:outline-2 focus-visible:outline-(--ud-viewer-focus)"
    >
      {text.data}
    </pre>
  );
}

/**
 * FileIcon : icône de catégorie colorée par --ud-ft-<cat>, dossiers colorés
 * (--ud-folder-<id> : contour couleur, corps 22 %), dossier partagé (`users` superposé au coin de
 * fin), pastille d'extension à partir de 32 px (4 caractères au plus ; aplat en clair, surface
 * teintée bordée en sombre). États : normal, désactivé (0,55), estompé (--ud-cut-opacity), erreur
 * (`circle-alert` au coin de fin). Toujours `aria-hidden` : le type est donné en texte à côté.
 */
import {
  CircleAlert,
  Database,
  File,
  FileArchive,
  FileAxis3d,
  FileCode,
  FileCog,
  FileHeadphone,
  FileImage,
  FilePenLine,
  FilePlay,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Presentation,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { fileCategory, fileExtension, folderColorOf, type FileCategory, type FolderColor } from '../lib/file-category';

export const FILE_ICONS: Record<FileCategory, LucideIcon> = {
  folder: Folder,
  bucket: Database,
  image: FileImage,
  video: FilePlay,
  audio: FileHeadphone,
  pdf: FileText,
  text: FileText,
  code: FileCode,
  sheet: FileSpreadsheet,
  slides: Presentation,
  doc: FilePenLine,
  archive: FileArchive,
  font: FileType,
  '3d': FileAxis3d,
  exec: FileCog,
  unknown: File,
};

/** Classes statiques (lisibles par le scan Tailwind de l'hôte). */
const CATEGORY_TEXT: Record<FileCategory, string> = {
  folder: 'text-ft-folder',
  bucket: 'text-ft-bucket',
  image: 'text-ft-image',
  video: 'text-ft-video',
  audio: 'text-ft-audio',
  pdf: 'text-ft-pdf',
  text: 'text-ft-text',
  code: 'text-ft-code',
  sheet: 'text-ft-sheet',
  slides: 'text-ft-slides',
  doc: 'text-ft-doc',
  archive: 'text-ft-archive',
  font: 'text-ft-font',
  '3d': 'text-ft-3d',
  exec: 'text-ft-exec',
  unknown: 'text-ft-unknown',
};

const FOLDER_TEXT: Record<FolderColor, string> = {
  neutral: 'text-folder-neutral',
  red: 'text-folder-red',
  orange: 'text-folder-orange',
  yellow: 'text-folder-yellow',
  green: 'text-folder-green',
  teal: 'text-folder-teal',
  blue: 'text-folder-blue',
  indigo: 'text-folder-indigo',
  purple: 'text-folder-purple',
  pink: 'text-folder-pink',
};

export type FileIconSize = 16 | 20 | 24 | 32 | 48 | 64;
export type FileIconState = 'normal' | 'disabled' | 'cut' | 'error';

export interface FileIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Catégorie imposée ; sinon déduite de `name` et `contentType` (fileCategory). */
  category?: FileCategory;
  /** Nom ou clé S3 (une clé terminée par `/` est un dossier). */
  name?: string;
  contentType?: string | null;
  size?: FileIconSize;
  /** Dossier ouvert (`folder-open`). */
  open?: boolean;
  /** Dossier partagé : `users` superposé au coin de fin. */
  shared?: boolean;
  /** Couleur de dossier ; id inconnu → neutral. */
  folderColor?: FolderColor | string | null;
  state?: FileIconState;
  /** Pastille d'extension (dès 32 px) ; `false` pour la masquer. */
  showExtension?: boolean;
}

export function FileIcon({
  category,
  name = '',
  contentType,
  size = 20,
  open = false,
  shared = false,
  folderColor,
  state = 'normal',
  showExtension = true,
  className,
  style,
  ...props
}: FileIconProps) {
  const cat = category ?? fileCategory(name, contentType);
  const isFolder = cat === 'folder';
  const Icon = isFolder && open ? FolderOpen : FILE_ICONS[cat];
  const colorClass = isFolder ? FOLDER_TEXT[folderColorOf(folderColor)] : CATEGORY_TEXT[cat];
  const ext = name ? fileExtension(name).toUpperCase() : '';
  const badge = showExtension && size >= 32 && !isFolder && cat !== 'bucket' && ext.length > 0 && ext.length <= 4 ? ext : '';
  const corner = Math.max(10, Math.round(size * 0.42));

  return (
    <span
      data-slot="file-icon"
      data-category={cat}
      data-state={state}
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        colorClass,
        state === 'disabled' && 'opacity-55',
        state === 'cut' && 'opacity-(--ud-cut-opacity)',
        className,
      )}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <Icon
        width={size}
        height={size}
        // Dossier : corps teinté à 22 % de la couleur
        fill={isFolder ? 'currentColor' : 'none'}
        fillOpacity={isFolder ? 0.22 : undefined}
      />
      {badge && (
        <span
          data-slot="file-icon-badge"
          className="ud-ft-badge absolute bottom-[8%] start-0 rounded-xs px-0.5 text-[0.5rem] leading-[1.1] font-semibold tracking-tight"
          style={{ '--ft': `var(--ud-ft-${cat})`, fontSize: Math.max(8, Math.round(size / 5.3)) } as CSSProperties}
        >
          {badge}
        </span>
      )}
      {shared && isFolder && (
        <Users
          data-slot="file-icon-shared"
          className="absolute -end-0.5 -bottom-0.5 rounded-full bg-panel text-current"
          width={Math.round(size * 0.5)}
          height={Math.round(size * 0.5)}
        />
      )}
      {state === 'error' && (
        <CircleAlert
          data-slot="file-icon-error"
          className="absolute -end-0.5 -top-0.5 rounded-full bg-panel text-danger"
          width={corner}
          height={corner}
        />
      )}
    </span>
  );
}

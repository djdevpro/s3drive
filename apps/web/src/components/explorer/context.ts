import type { ListItem, SpaceBucket } from '@ud/contracts';
import { createContext, useContext } from 'react';

/*
 * Contexte partagé par la liste, la grille, les menus et la barre de sélection : dossier
 * affiché, droits de l'espace, éléments triés et actions. Les actions ouvrent les boîtes
 * de dialogue tenues par `Explorer`.
 */

export interface ExplorerPermissions {
  read: boolean;
  write: boolean;
  delete: boolean;
  /** Renommer = écrire + supprimer à la source. */
  rename: boolean;
  /** Déplacer : supprimer à la source (l'écriture se vérifie à la cible). */
  move: boolean;
}

export function permissionsOf(space: Pick<SpaceBucket, 'scopes'> | undefined): ExplorerPermissions {
  const scopes = new Set(space?.scopes ?? []);
  const read = scopes.has('read');
  const write = scopes.has('write');
  const del = scopes.has('delete');
  return { read, write, delete: del, rename: read && write && del, move: read && del };
}

export interface ExplorerActions {
  open: (item: ListItem) => void;
  openInNewTab: (item: ListItem) => void;
  download: (items: readonly ListItem[]) => void;
  rename: (item: ListItem) => void;
  moveTo: (items: readonly ListItem[]) => void;
  copyTo: (items: readonly ListItem[]) => void;
  copyLink: (items: readonly ListItem[]) => void;
  remove: (items: readonly ListItem[]) => void;
  cut: (items: readonly ListItem[]) => void;
  copy: (items: readonly ListItem[]) => void;
  paste: () => void;
  newFolder: () => void;
  uploadFiles: () => void;
  uploadFolder: () => void;
  refresh: () => void;
  copyFolderLink: () => void;
  selectAll: () => void;
  /** Dépôt de fichiers du système dans un dossier (`''` = racine). */
  dropFiles: (dataTransfer: DataTransfer, prefix: string) => void;
  /** Dépôt d'éléments glissés depuis l'explorateur dans un dossier. */
  dropItems: (keys: readonly string[], prefix: string, copy: boolean) => void;
}

export interface ExplorerContextValue {
  conn: string;
  bucket: string;
  prefix: string;
  space: SpaceBucket | undefined;
  spaceLabel: string;
  can: ExplorerPermissions;
  items: readonly ListItem[];
  order: readonly string[];
  byKey: ReadonlyMap<string, ListItem>;
  hrefOf: (item: ListItem) => string;
  actions: ExplorerActions;
  locale: string;
  mobile: boolean;
  hasClipboard: boolean;
}

export const ExplorerContext = createContext<ExplorerContextValue | null>(null);

export function useExplorer(): ExplorerContextValue {
  const value = useContext(ExplorerContext);
  if (!value) throw new Error('useExplorer outside of <Explorer>');
  return value;
}

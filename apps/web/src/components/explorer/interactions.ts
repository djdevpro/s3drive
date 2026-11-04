import type { ListItem } from '@ud/contracts';
import { type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject, useCallback } from 'react';
import { useSelectionStore } from '../../stores/selection';
import { useExplorer } from './context';

/*
 * Souris, clavier et glisser communs à la liste et à la grille.
 * Ctrl/⌘+clic sélectionne ; le clic du milieu ouvre un onglet ; double-clic ou Entrée ouvre.
 */

export const DRAG_TYPE = 'application/x-ud-items+json';

interface DragPayload {
  dragId: string;
  conn: string;
  bucket: string;
  keys: string[];
  origin: string;
}

// Registre des glissers en cours de cet onglet : un dépôt d'une autre page est ignoré.
const activeDrags = new Map<string, DragPayload>();

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function readDrag(dataTransfer: DataTransfer): DragPayload | null {
  const raw = dataTransfer.getData(DRAG_TYPE);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as DragPayload;
    const known = activeDrags.get(payload.dragId);
    if (!known || payload.origin !== location.origin || known.conn !== payload.conn) return null;
    return known;
  } catch {
    return null;
  }
}

export const hasFiles = (dataTransfer: DataTransfer | null) => !!dataTransfer && Array.from(dataTransfer.types).includes('Files');
export const hasItems = (dataTransfer: DataTransfer | null) => !!dataTransfer && Array.from(dataTransfer.types).includes(DRAG_TYPE);

const isMod = (event: { metaKey: boolean; ctrlKey: boolean }) => event.metaKey || event.ctrlKey;

/** Effet du dépôt : déplacer par défaut dans le même stockage, Ctrl (⌥ sous macOS) = copier. */
export const isCopyDrop = (event: { ctrlKey: boolean; altKey: boolean }) => event.ctrlKey || event.altKey;

export interface InteractionOptions {
  /** Éléments par rangée (1 en liste). */
  columns: number;
  containerRef: RefObject<HTMLElement | null>;
  scrollToIndex: (index: number) => void;
  /** Ouvre le menu contextuel de l'élément focalisé (Maj+F10, touche Menu). */
  rtl?: boolean;
}

export function useItemInteractions({ columns, containerRef, scrollToIndex, rtl = false }: InteractionOptions) {
  const ctx = useExplorer();
  const { order, byKey, actions, can, mobile } = ctx;

  const focusKey = useCallback(
    (key: string) => {
      const index = order.indexOf(key);
      if (index < 0) return;
      scrollToIndex(index);
      requestAnimationFrame(() => {
        const nodes = containerRef.current?.querySelectorAll<HTMLElement>('[data-item-key]') ?? [];
        for (const node of nodes) {
          if (node.dataset['itemKey'] === key) {
            node.focus({ preventScroll: true });
            break;
          }
        }
      });
    },
    [containerRef, order, scrollToIndex],
  );

  const onItemClick = useCallback(
    (event: MouseEvent, item: ListItem) => {
      const store = useSelectionStore.getState();
      if (event.shiftKey) store.selectRange(order, item.key, isMod(event));
      else if (isMod(event)) store.toggle(item.key);
      else if (mobile && store.selected.size > 0) store.toggle(item.key);
      else if (mobile) actions.open(item);
      else store.selectOnly(item.key);
    },
    [actions, mobile, order],
  );

  const onItemDoubleClick = useCallback(
    (event: MouseEvent, item: ListItem) => {
      if (event.shiftKey || isMod(event)) return;
      actions.open(item);
    },
    [actions],
  );

  /** Clic du milieu hors du lien du nom : nouvel onglet. */
  const onItemAuxClick = useCallback(
    (event: MouseEvent, item: ListItem) => {
      if (event.button !== 1) return;
      if ((event.target as HTMLElement).closest('a')) return;
      event.preventDefault();
      actions.openInNewTab(item);
    },
    [actions],
  );

  /** Clic droit sur un élément non sélectionné : le sélectionne seul. */
  const onItemContextMenu = useCallback((item: ListItem) => {
    const store = useSelectionStore.getState();
    if (!store.selected.has(item.key)) store.selectOnly(item.key);
    else store.setFocus(item.key);
  }, []);

  const selectedItems = useCallback((): ListItem[] => {
    const { selected } = useSelectionStore.getState();
    const result: ListItem[] = [];
    for (const key of order) {
      if (selected.has(key)) {
        const item = byKey.get(key);
        if (item) result.push(item);
      }
    }
    return result;
  }, [byKey, order]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.nativeEvent.isComposing) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable="true"]')) return;
      const store = useSelectionStore.getState();
      const current = store.focus ?? store.anchor;
      const index = current === null ? -1 : order.indexOf(current);
      const last = order.length - 1;
      const mod = isMod(event);

      const moveTo = (next: number) => {
        if (order.length === 0) return;
        const clamped = Math.max(0, Math.min(last, next));
        const key = order[clamped]!;
        if (event.shiftKey) store.selectRange(order, key, mod);
        else if (mod) store.setFocus(key);
        else store.selectOnly(key);
        focusKey(key);
      };

      const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
      const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveTo(index < 0 ? 0 : index + columns);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveTo(index < 0 ? 0 : index - columns);
          return;
        case forward:
          if (columns > 1) {
            event.preventDefault();
            moveTo(index + 1);
          }
          return;
        case backward:
          if (columns > 1) {
            event.preventDefault();
            moveTo(index - 1);
          }
          return;
        case 'Home':
          event.preventDefault();
          moveTo(0);
          return;
        case 'End':
          event.preventDefault();
          moveTo(last);
          return;
        case 'PageDown':
          event.preventDefault();
          moveTo(index + columns * 10);
          return;
        case 'PageUp':
          event.preventDefault();
          moveTo(index - columns * 10);
          return;
        case 'Enter': {
          const item = current === null ? undefined : byKey.get(current);
          if (!item) return;
          event.preventDefault();
          if (mod) actions.openInNewTab(item);
          else actions.open(item);
          return;
        }
        case ' ': {
          const item = current === null ? undefined : byKey.get(current);
          if (!item) return;
          event.preventDefault();
          if (event.shiftKey || item.kind === 'folder') store.toggle(item.key);
          else actions.open(item);
          return;
        }
        case 'F2': {
          const items = selectedItems();
          if (items.length === 1 && can.rename) {
            event.preventDefault();
            actions.rename(items[0]!);
          }
          return;
        }
        case 'Delete': {
          const items = selectedItems();
          if (items.length > 0 && can.delete) {
            event.preventDefault();
            actions.remove(items);
          }
          return;
        }
        case 'Backspace':
          // ⌘⌫ sous macOS.
          if (event.metaKey) {
            const items = selectedItems();
            if (items.length > 0 && can.delete) {
              event.preventDefault();
              actions.remove(items);
            }
          }
          return;
        case 'Escape':
          if (store.selected.size > 0) {
            event.preventDefault();
            store.clear();
          }
          return;
        case 'F10':
        case 'ContextMenu':
          if (event.key === 'F10' && !event.shiftKey) return;
          event.preventDefault();
          openContextMenuAt(containerRef.current, current);
          return;
      }
      if (!mod || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case 'a':
          event.preventDefault();
          store.selectAll(order);
          return;
        case 'c': {
          const items = selectedItems();
          if (items.length > 0) {
            event.preventDefault();
            actions.copy(items);
          }
          return;
        }
        case 'x': {
          const items = selectedItems();
          if (items.length > 0 && can.move) {
            event.preventDefault();
            actions.cut(items);
          }
          return;
        }
        case 'v':
          if (ctx.hasClipboard && can.write) {
            event.preventDefault();
            actions.paste();
          }
          return;
      }
    },
    [actions, byKey, can, columns, containerRef, ctx.hasClipboard, focusKey, order, rtl, selectedItems],
  );

  /** Glisser interne : la sélection entière si l'élément en fait partie. */
  const onItemDragStart = useCallback(
    (event: DragEvent, item: ListItem) => {
      const store = useSelectionStore.getState();
      if (!store.selected.has(item.key)) store.selectOnly(item.key);
      const keys = selectedItems().map((i) => i.key);
      const payload: DragPayload = { dragId: randomId(), conn: ctx.conn, bucket: ctx.bucket, keys, origin: location.origin };
      activeDrags.set(payload.dragId, payload);
      setTimeout(() => activeDrags.delete(payload.dragId), 60_000);
      event.dataTransfer.effectAllowed = can.move ? 'copyMove' : 'copy';
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
      event.dataTransfer.setData('text/plain', keys.map((k) => location.origin + ctx.hrefOf(byKey.get(k)!)).join('\n'));
    },
    [byKey, can.move, ctx, selectedItems],
  );

  /** Un dossier accepte fichiers du système (écriture) et éléments glissés (ni lui-même ni un descendant). */
  const canDropOn = useCallback(
    (event: DragEvent, folder: ListItem) => {
      if (folder.kind !== 'folder' || !can.write) return false;
      if (hasFiles(event.dataTransfer)) return true;
      if (!hasItems(event.dataTransfer)) return false;
      const { selected } = useSelectionStore.getState();
      for (const key of selected) if (key.endsWith('/') && folder.key.startsWith(key)) return false;
      return !selected.has(folder.key);
    },
    [can.write],
  );

  const onFolderDrop = useCallback(
    (event: DragEvent, folder: ListItem) => {
      if (!canDropOn(event, folder)) return;
      event.preventDefault();
      event.stopPropagation();
      if (hasFiles(event.dataTransfer)) {
        actions.dropFiles(event.dataTransfer, folder.key);
        return;
      }
      const drag = readDrag(event.dataTransfer);
      if (!drag || drag.bucket !== ctx.bucket) return;
      const keys = drag.keys.filter((k) => k !== folder.key && !(k.endsWith('/') && folder.key.startsWith(k)));
      if (keys.length > 0) actions.dropItems(keys, folder.key, isCopyDrop(event) || !can.move);
    },
    [actions, can.move, canDropOn, ctx.bucket],
  );

  return { onItemClick, onItemDoubleClick, onItemAuxClick, onItemContextMenu, onKeyDown, onItemDragStart, canDropOn, onFolderDrop, focusKey };
}

/** Ouvre le menu contextuel de l'élément `key` (ou de la zone) par un événement `contextmenu` synthétique. */
export function openContextMenuAt(container: HTMLElement | null, key: string | null): void {
  if (!container) return;
  let node: HTMLElement | null = null;
  if (key !== null) {
    for (const el of container.querySelectorAll<HTMLElement>('[data-item-key]')) {
      if (el.dataset['itemKey'] === key) {
        node = el;
        break;
      }
    }
  }
  const target = node ?? container;
  const rect = target.getBoundingClientRect();
  target.dispatchEvent(new globalThis.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 24, clientY: rect.top + Math.min(rect.height, 32) }));
}

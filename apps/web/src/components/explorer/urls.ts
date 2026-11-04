import { type ExplorerTarget, toPath } from '../../lib/keys/keyCodec';

/*
 * URL de l'explorateur : chemin de keyCodec + paramètres partageables (`?view=`, `?sort=`,
 * `?dir=`). Un paramètre égal au défaut n'est pas écrit.
 */

export type SearchValues = Record<string, string | undefined>;

/** Ajoute des paramètres à un chemin de `toPath` (qui peut déjà porter `?key=` ou `?version=`). */
export function withSearch(href: string, values: SearchValues): string {
  const [path, query = ''] = href.split('?', 2) as [string, string?];
  const params = new URLSearchParams(query);
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === '') params.delete(name);
    else params.set(name, value);
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function explorerHref(target: ExplorerTarget, values: SearchValues = {}): string {
  return withSearch(toPath(target), values);
}

/** Lien interne absolu de l'appli (« Copier le lien »). */
export function absoluteLink(href: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${href}`;
}

/** Copie un texte dans le presse-papiers du système ; repli par zone de texte cachée. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Permission refusée : repli ci-dessous.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    document.execCommand('copy');
  } finally {
    area.remove();
  }
}

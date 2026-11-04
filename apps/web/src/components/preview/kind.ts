import { fileCategory, fileExtension } from '@ud/ui';

/*
 * Nature d'un aperçu simple : images (SVG compris, toujours en `<img>`), vidéo,
 * audio, PDF (lecteur du navigateur), texte (≤ 1 Mo, lu par fetch et affiché comme texte),
 * HTML (iframe `sandbox` sans scripts). Le reste : « Aperçu indisponible ».
 */

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'html' | 'none';

/** Taille maximale d'un texte affiché. */
export const TEXT_PREVIEW_MAX_BYTES = 1_000_000;

const HTML_EXTENSIONS = new Set(['html', 'htm', 'xhtml']);
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-sh|x-yaml|yaml|toml|x-ndjson|ld\+json|sql|graphql))/;

export function previewKind(name: string, contentType?: string | null): PreviewKind {
  const ext = fileExtension(name).toLowerCase();
  if (HTML_EXTENSIONS.has(ext) || contentType?.startsWith('text/html')) return 'html';
  const category = fileCategory(name, contentType);
  switch (category) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'pdf':
      return 'pdf';
    case 'text':
    case 'code':
      return 'text';
  }
  if (contentType && TEXT_TYPES.test(contentType)) return 'text';
  return 'none';
}

/** Vrai si l'URL n'est pas servie par l'origine de l'appli (contenu jamais interprété chez elle). */
export function isForeignOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

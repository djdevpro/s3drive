/*
 * Analyse et écriture de la recherche d'URL directement sur URLSearchParams :
 * chaque valeur reste une chaîne (`?q=2024`, `?version=null`), la première valeur répétée l'emporte.
 * À migrer vers @ud/contracts (`links/search`).
 */

export function parseSearchStrings(search: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of new URLSearchParams(search)) {
    if (!(name in result)) result[name] = value;
  }
  return result;
}

export function stringifySearchStrings(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    params.append(name, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

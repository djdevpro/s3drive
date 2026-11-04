// Outils des tests de jetons : lecture des blocs CSS et évaluation des couleurs (hex, rgb, var, color-mix oklab).

export type Decls = Record<string, string>;
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Blocs sans imbrication : sélecteur → déclarations (les blocs @media sont lus par leur contenu). */
export function parseBlocks(css: string): Array<{ selector: string; decls: Decls }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ selector: string; decls: Decls }> = [];
  for (const m of clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const decls: Decls = {};
    for (const d of (m[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1] as string] = (d[2] as string).trim();
    // Le texte avant le sélecteur peut contenir des at-rules sans bloc (@import, @custom-variant).
    const selector = (m[1] ?? '').split(';').pop() ?? '';
    out.push({ selector: selector.trim().replace(/\s+/g, ' '), decls });
  }
  return out;
}

/** Feuille sans ses commentaires. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

export function declsFor(css: string, match: (selector: string) => boolean): Decls {
  const all: Decls = {};
  for (const b of parseBlocks(css)) if (match(b.selector)) Object.assign(all, b.decls);
  return all;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function hexToRgb(hex: string): Rgb | null {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6) return null;
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const toLin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLin = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
};

function toOklab({ r, g, b }: Rgb): [number, number, number] {
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/**
 * Évalue une couleur opaque. Retourne null pour un format non pris en charge ou translucide
 * (transparent, alpha < 1) : le test se limite alors à la présence.
 */
export function evalColor(value: string, vars: Decls, depth = 0): Rgb | null {
  if (depth > 20) throw new Error(`cycle: ${value}`);
  const v = value.trim();
  if (v.startsWith('#')) return hexToRgb(v);
  if (v === 'white') return { r: 255, g: 255, b: 255 };
  if (v === 'black') return { r: 0, g: 0, b: 0 };
  const varM = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v);
  if (varM) {
    const ref = vars[varM[1] as string] ?? varM[2];
    if (ref === undefined) throw new Error(`undefined token ${varM[1]}`);
    return evalColor(ref, vars, depth + 1);
  }
  const rgbM = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\)$/.exec(v);
  if (rgbM) {
    if (rgbM[4] !== undefined && Number(rgbM[4]) < 1) return null;
    return { r: Number(rgbM[1]), g: Number(rgbM[2]), b: Number(rgbM[3]) };
  }
  const mixM = /^color-mix\(in oklab,(.*)\)$/s.exec(v);
  if (mixM) {
    const [a, b] = splitArgs(mixM[1] as string);
    const pa = /^(.*?)\s+([\d.]+)%$/.exec(a ?? '');
    if (!pa || !b) return null;
    const ca = evalColor(pa[1] as string, vars, depth + 1);
    const cb = evalColor(b, vars, depth + 1);
    if (!ca || !cb) return null;
    const p = Number(pa[2]) / 100;
    const la = toOklab(ca);
    const lb = toOklab(cb);
    return fromOklab([la[0] * p + lb[0] * (1 - p), la[1] * p + lb[1] * (1 - p), la[2] * p + lb[2] * (1 - p)]);
  }
  return null;
}

export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

type ReadFs = { readFileSync(path: URL, encoding: 'utf8'): string };
// Lecture sans types node (le paquet est isomorphe) : process.getBuiltinModule existe depuis Node 22.3.
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule('node:fs') as ReadFs;

/** Texte d'une feuille de styles/, chemin relatif à ce dossier. */
export function readStyle(rel: string): string {
  return fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
}

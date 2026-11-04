/**
 * Formats Intl : tailles en base 1000 avec les unités de CLDR (« ko, Mo, Go » en
 * français), dates absolues et relatives, nombres. Calendrier grégorien imposé ; en arabe, chiffres
 * latins par défaut (`-u-nu-latn`). Formateurs mis en cache par locale complète.
 */

export type Digits = 'latn' | 'arab' | 'auto';

export interface LocaleOptions {
  /** Chiffres en arabe (réglage `ud.digits`) : latins par défaut. */
  digits?: Digits;
}

/** Locale de formatage complète : calendrier grégorien, chiffres latins en arabe sauf réglage contraire. */
export function formatLocale(locale: string, { digits = 'latn' }: LocaleOptions = {}): string {
  let base: Intl.Locale;
  try {
    base = new Intl.Locale(locale);
  } catch {
    base = new Intl.Locale('en');
  }
  const numberingSystem = base.language === 'ar' && digits !== 'auto' ? digits : base.numberingSystem;
  return new Intl.Locale(base.baseName, {
    calendar: 'gregory',
    ...(numberingSystem ? { numberingSystem } : {}),
  }).toString();
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.RelativeTimeFormat>(key: string, make: () => T): T {
  let f = cache.get(key) as T | undefined;
  if (!f) {
    f = make();
    cache.set(key, f);
  }
  return f;
}

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached(`n|${locale}|${JSON.stringify(options)}`, () => new Intl.NumberFormat(locale, options));
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(`d|${locale}|${JSON.stringify(options)}`, () => new Intl.DateTimeFormat(locale, options));
}

function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  return cached(`r|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
}

// --------------------------------------------------------------------------
// Tailles
// --------------------------------------------------------------------------

const BYTE_UNITS = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const;

/** Arrondi d'affichage : une décimale sous 10, entier au-delà (« 1,5 Mo », « 312 Mo »). */
function roundSize(v: number): number {
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
}

/**
 * Taille lisible, base 1000 : « 512 octets », « 1,5 ko », « 312 Mo », « 1 Go » (fr) ; « 1.5 MB » (en).
 * Passage à l'unité supérieure dès que la valeur arrondie atteint 1000 (jamais « 1 000 ko »).
 */
export function formatBytes(bytes: number, locale: string, options: LocaleOptions = {}): string {
  const loc = formatLocale(locale, options);
  const n = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (n < 1000) {
    return numberFormat(loc, { style: 'unit', unit: 'byte', unitDisplay: 'long', maximumFractionDigits: 0 }).format(Math.round(n));
  }
  let value = n / 1000;
  let i = 0;
  while (roundSize(value) >= 1000 && i < BYTE_UNITS.length - 1) {
    value /= 1000;
    i++;
  }
  const rounded = roundSize(value);
  return numberFormat(loc, {
    style: 'unit',
    unit: BYTE_UNITS[i] ?? 'petabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(rounded);
}

/** Valeur exacte en octets (« 1 572 864 octets »), pour les infobulles et les détails. */
export function formatBytesExact(bytes: number, locale: string, options: LocaleOptions = {}): string {
  return numberFormat(formatLocale(locale, options), { style: 'unit', unit: 'byte', unitDisplay: 'long' }).format(Math.round(bytes));
}

// --------------------------------------------------------------------------
// Nombres
// --------------------------------------------------------------------------

export function formatNumber(value: number, locale: string, options: LocaleOptions & Intl.NumberFormatOptions = {}): string {
  const { digits, ...nf } = options;
  return numberFormat(formatLocale(locale, digits ? { digits } : {}), nf).format(value);
}

/** Pourcentage à partir d'un ratio (0,42 → « 42 % » en fr, « 42% » en en). */
export function formatPercent(ratio: number, locale: string, options: LocaleOptions = {}): string {
  return numberFormat(formatLocale(locale, options), { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

// --------------------------------------------------------------------------
// Dates
// --------------------------------------------------------------------------

export type DateStyle = 'list' | 'medium' | 'exact' | 'relative';

export interface DateOptions extends LocaleOptions {
  /** list (défaut) : date de liste ; medium : panneau de détails ; exact : avec secondes et fuseau ; relative. */
  style?: DateStyle;
  /** Référence pour « aujourd'hui », « hier », relatif (tests, horloge partagée). */
  now?: Date | number;
  /** Fuseau (défaut : celui du navigateur). */
  timeZone?: string;
}

const DAY = 86_400_000;

function toDate(d: Date | number | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Jour civil (année, mois, jour) dans le fuseau demandé, sous forme de nombre comparable. */
function dayNumber(d: Date, timeZone: string | undefined): number {
  const parts = dateFormat('en-US-u-ca-gregory-nu-latn', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.round(Date.UTC(get('year'), get('month') - 1, get('day')) / DAY);
}

function yearOf(d: Date, timeZone: string | undefined): number {
  return Number(dateFormat('en-US-u-ca-gregory-nu-latn', { timeZone, year: 'numeric' }).format(d));
}

/**
 * Date affichée. `list` : aujourd'hui → heure ; hier → « hier » ; moins de 7 jours → jour de la semaine ;
 * même année → jour + mois court ; sinon jour + mois court + année. `relative` : « il y a 5 minutes »,
 * « dans 3 jours » ; au-delà de 7 jours, date de liste.
 */
export function formatDate(date: Date | number | string, locale: string, options: DateOptions = {}): string {
  const { style = 'list', timeZone } = options;
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return '';
  const loc = formatLocale(locale, options);
  const tz = timeZone ? { timeZone } : {};

  if (style === 'medium') return dateFormat(loc, { ...tz, dateStyle: 'medium', timeStyle: 'short' }).format(d);
  if (style === 'exact') return dateFormat(loc, { ...tz, dateStyle: 'medium', timeStyle: 'long' }).format(d);

  const now = toDate(options.now ?? Date.now());
  if (style === 'relative') {
    const diff = d.getTime() - now.getTime();
    const abs = Math.abs(diff);
    const rtf = relativeFormat(loc);
    if (abs < 60_000) return rtf.format(0, 'second');
    if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
    if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour');
    if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  }

  const days = dayNumber(now, timeZone) - dayNumber(d, timeZone);
  if (days === 0) return dateFormat(loc, { ...tz, timeStyle: 'short' }).format(d);
  if (days === 1) return relativeFormat(loc).format(-1, 'day');
  if (days > 1 && days < 7) return dateFormat(loc, { ...tz, weekday: 'long' }).format(d);
  if (yearOf(d, timeZone) === yearOf(now, timeZone)) return dateFormat(loc, { ...tz, day: 'numeric', month: 'short' }).format(d);
  return dateFormat(loc, { ...tz, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** Date ISO 8601 UTC copiable (dates exactes ou juridiques). */
export function formatIsoDate(date: Date | number | string): string {
  return toDate(date).toISOString();
}

// --------------------------------------------------------------------------
// Initiales (Avatar)
// --------------------------------------------------------------------------

/** Une ou deux initiales en graphèmes (« Ada Lovelace » → « AL ») ; jamais au milieu d'un émoji. */
export function initials(name: string): string {
  const words = name.trim().split(/[\s@._-]+/u).filter(Boolean);
  const first = (w: string | undefined): string => {
    if (!w) return '';
    if (typeof Intl.Segmenter === 'function') {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(w)[Symbol.iterator]().next();
      return seg.done ? '' : seg.value.segment;
    }
    return Array.from(w)[0] ?? '';
  };
  const picked = words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
  return picked.toLocaleUpperCase();
}

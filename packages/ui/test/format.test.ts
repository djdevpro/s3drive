import { describe, expect, it } from 'vitest';
import { formatBytes, formatBytesExact, formatDate, formatLocale, formatNumber, formatPercent, initials } from '../src/lib/format';

// Intl insère des espaces insécables (U+00A0, U+202F) : normalisés pour comparer.
const sp = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatBytes (base 1000, unités Intl)', () => {
  it('français : octets, ko, Mo, Go', () => {
    expect(sp(formatBytes(0, 'fr'))).toBe('0 octet');
    expect(sp(formatBytes(512, 'fr'))).toBe('512 octets');
    expect(sp(formatBytes(1500, 'fr'))).toBe('1,5 ko');
    expect(sp(formatBytes(312_000_000, 'fr'))).toBe('312 Mo');
    expect(sp(formatBytes(1_000_000_000, 'fr'))).toBe('1 Go');
    expect(sp(formatBytes(1_500_000_000_000, 'fr'))).toBe('1,5 To');
  });

  it('anglais et allemand', () => {
    expect(formatBytes(512, 'en')).toBe('512 bytes');
    expect(formatBytes(1, 'en')).toBe('1 byte');
    expect(formatBytes(1_500_000, 'en')).toBe('1.5 MB');
    expect(sp(formatBytes(1500, 'de'))).toBe('1,5 kB');
  });

  it('arabe : chiffres latins par défaut, arabes orientaux sur demande', () => {
    expect(sp(formatBytes(1_500_000, 'ar'))).toBe('1.5 م.ب');
    expect(formatBytes(1_500_000, 'ar', { digits: 'arab' })).toMatch(/[٠-٩]/);
    expect(formatBytes(512, 'ar')).toMatch(/^512 /);
  });

  it('arrondi : une décimale sous 10, entier au-delà, jamais « 1 000 ko »', () => {
    expect(sp(formatBytes(9_440, 'fr'))).toBe('9,4 ko');
    expect(sp(formatBytes(10_400, 'fr'))).toBe('10 ko');
    expect(sp(formatBytes(2_000, 'fr'))).toBe('2 ko');
    expect(sp(formatBytes(999_950, 'fr'))).toBe('1 Mo');
    expect(sp(formatBytes(999_400, 'fr'))).toBe('999 ko');
  });

  it('valeur exacte', () => {
    expect(sp(formatBytesExact(1_572_864, 'fr'))).toBe('1 572 864 octets');
    expect(formatBytesExact(1_572_864, 'en')).toBe('1,572,864 bytes');
  });
});

describe('formatNumber, formatPercent, formatLocale', () => {
  it('séparateurs et pourcentages selon la langue', () => {
    expect(sp(formatNumber(12_480, 'fr'))).toBe('12 480');
    expect(formatNumber(12_480, 'en')).toBe('12,480');
    expect(formatNumber(12_480, 'de')).toBe('12.480');
    expect(sp(formatPercent(0.42, 'fr'))).toBe('42 %');
    expect(formatPercent(0.42, 'en')).toBe('42%');
  });

  it('calendrier grégorien imposé, chiffres latins en arabe', () => {
    expect(formatLocale('fr-CA')).toBe('fr-CA-u-ca-gregory');
    expect(formatLocale('ar')).toBe('ar-u-ca-gregory-nu-latn');
    expect(formatLocale('ar', { digits: 'arab' })).toBe('ar-u-ca-gregory-nu-arab');
    expect(formatLocale('ar-MA', { digits: 'auto' })).toBe('ar-MA-u-ca-gregory');
    expect(formatLocale('pas une locale !')).toBe('en-u-ca-gregory');
  });
});

describe('formatDate', () => {
  const now = new Date('2026-11-03T15:05:00Z');
  const opts = { now, timeZone: 'UTC' };

  it('liste : aujourd’hui → heure ; hier ; jour de la semaine ; même année ; autre année', () => {
    expect(formatDate('2026-11-03T10:00:00Z', 'fr', opts)).toBe('10:00');
    expect(sp(formatDate('2026-11-03T10:00:00Z', 'en', opts))).toBe('10:00 AM');
    expect(formatDate('2026-11-02T22:00:00Z', 'fr', opts)).toBe('hier');
    expect(formatDate('2026-11-02T22:00:00Z', 'en', opts)).toBe('yesterday');
    expect(formatDate('2026-10-30T12:00:00Z', 'fr', opts)).toBe('vendredi');
    expect(formatDate('2026-03-12T12:00:00Z', 'fr', opts)).toBe('12 mars');
    expect(formatDate('2026-03-12T12:00:00Z', 'en', opts)).toBe('Mar 12');
    expect(formatDate('2025-03-12T12:00:00Z', 'fr', opts)).toBe('12 mars 2025');
  });

  it('relatif, passé et futur', () => {
    expect(formatDate('2026-11-03T15:00:00Z', 'fr', { ...opts, style: 'relative' })).toBe('il y a 5 minutes');
    expect(formatDate('2026-11-06T15:05:00Z', 'fr', { ...opts, style: 'relative' })).toBe('dans 3 jours');
    expect(formatDate('2026-11-03T15:04:40Z', 'en', { ...opts, style: 'relative' })).toBe('now');
    expect(formatDate('2026-03-12T12:00:00Z', 'fr', { ...opts, style: 'relative' })).toBe('12 mars');
  });

  it('moyen et exact', () => {
    expect(sp(formatDate('2026-11-03T15:05:00Z', 'fr', { ...opts, style: 'medium' }))).toBe('3 nov. 2026, 15:05');
    expect(formatDate('2026-11-03T15:05:09Z', 'en', { ...opts, style: 'exact' })).toContain('UTC');
  });

  it('arabe : chiffres latins', () => {
    const s = formatDate('2026-03-12T12:00:00Z', 'ar', opts);
    expect(s).toMatch(/12/);
    expect(s).not.toMatch(/[٠-٩]/);
  });

  it('date invalide → chaîne vide', () => {
    expect(formatDate('n’importe quoi', 'fr')).toBe('');
  });
});

describe('initials', () => {
  it('une ou deux initiales en graphèmes', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('ada')).toBe('A');
    expect(initials('jean-paul.sartre@example.org')).toBe('JO');
    expect(initials('Élodie Ünal')).toBe('ÉÜ');
    expect(initials('👩‍💻 Dev')).toBe('👩‍💻D');
    expect(initials('')).toBe('');
  });
});

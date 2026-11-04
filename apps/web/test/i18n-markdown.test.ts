// Traductions de l'appli (7 langues, mêmes clés) et moteur Markdown des conditions.
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from '../src/components/shell/markdown';
import { NAMESPACES, SUPPORTED_LANGUAGES, createI18n, detectLanguage, resources, setLanguage } from '../src/i18n';
import { loginPageHref, reauthHref, safeNext, termsPageHref } from '../src/lib/api/client';
import { parseQuota, splitQuota } from '../src/components/admin/format';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('i18n', () => {
  it('7 langues et les espaces common, instance, admin chargés par import.meta.glob', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'fr', 'es', 'de', 'it', 'pt', 'ar']);
    for (const ns of ['common', 'instance', 'admin']) expect(NAMESPACES).toContain(ns);
  });

  it.each(['common', 'instance', 'admin'])('%s : mêmes clés que l’anglais dans chaque langue, aucune valeur vide', (ns) => {
    const reference = keys(resources['en']?.[ns]).sort();
    expect(reference.length).toBeGreaterThan(10);
    for (const lng of SUPPORTED_LANGUAGES) {
      const bundle = resources[lng]?.[ns];
      expect(bundle, `${lng}/${ns}`).toBeTruthy();
      expect(keys(bundle).sort(), `${lng}/${ns}`).toEqual(reference);
      for (const key of reference) {
        const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], bundle);
        expect(typeof value === 'string' && value.trim().length > 0, `${lng}/${ns}:${key}`).toBe(true);
      }
    }
  });

  it('espace ud-ui ajouté ; choix de langue mémorisé', async () => {
    const i18n = createI18n('de');
    expect(i18n.t('ud-ui:account.signOut')).toBe('Abmelden');
    await setLanguage(i18n, 'it');
    expect(i18n.language).toBe('it');
    expect(localStorage.getItem('ud.lang')).toBe('it');
    expect(detectLanguage()).toBe('it');
    localStorage.removeItem('ud.lang');
  });
});

describe('redirections', () => {
  it('safeNext refuse ce qui sort de l’appli', () => {
    expect(safeNext('/d/drive/b/home/')).toBe('/d/drive/b/home/');
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext('/\\evil.test')).toBe('/');
    expect(safeNext('https://evil.test')).toBe('/');
    expect(safeNext(undefined, '')).toBe('');
  });

  it('loginPageHref et termsPageHref', () => {
    expect(loginPageHref({ reason: 'session_ended', next: '/d/drive/b/home/a b' })).toBe('/login?error=session_ended&next=%2Fd%2Fdrive%2Fb%2Fhome%2Fa+b');
    expect(loginPageHref({ reason: 'whatever', next: '/' })).toBe('/login');
    expect(loginPageHref({ next: '/login?next=/x' })).toBe('/login');
    expect(termsPageHref('/admin?q=a')).toBe('/terms?next=%2Fadmin%3Fq%3Da');
    expect(termsPageHref('/terms?next=/x')).toBe('/terms');
    expect(reauthHref('/d/drive/b/home/?view=grid')).toBe('/d/drive/b/home/?view=grid&reauth=1');
  });
});

describe('quota de l’administration', () => {
  it('saisie en unités de base 1000', () => {
    expect(parseQuota('2,5', 'GB')).toBe(2_500_000_000);
    expect(parseQuota('500', 'MB')).toBe(500_000_000);
    expect(parseQuota('0', 'GB')).toBeNull();
    expect(parseQuota('abc', 'GB')).toBeNull();
    expect(splitQuota(2_500_000_000)).toEqual({ value: '2.5', unit: 'GB' });
    expect(splitQuota(3_000_000_000_000)).toEqual({ value: '3', unit: 'TB' });
  });
});

describe('Markdown sûr', () => {
  it('blocs : titres, listes, citation, code, règle, paragraphes', () => {
    const blocks = parseMarkdown('# Titre\n\nUn *texte*\nsur deux lignes.\n\n1. un\n2. deux\n\n> cité\n\n```\n<b>x</b>\n```\n\n---');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'quote', 'code', 'rule']);
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: true, start: 1 });
    expect(blocks[4]).toEqual({ type: 'code', text: '<b>x</b>' });
  });

  it('en ligne : gras, italique, code, liens filtrés, échappements', () => {
    expect(parseInline('**gras** et _ital_ et `code`')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'gras' }] },
      { type: 'text', text: ' et ' },
      { type: 'em', children: [{ type: 'text', text: 'ital' }] },
      { type: 'text', text: ' et ' },
      { type: 'code', text: 'code' },
    ]);
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({ type: 'text', text: 'x' });
    expect(parseInline('[x](/terms)')[0]).toMatchObject({ type: 'link', href: '/terms' });
    expect(parseInline('\\*pas\\* italique')).toEqual([{ type: 'text', text: '*pas* italique' }]);
    expect(parseInline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }]);
    expect(safeHref('//evil.test')).toBeNull();
    expect(safeHref('mailto:a@b.test')).toBe('mailto:a@b.test');
  });
});

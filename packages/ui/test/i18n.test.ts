import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { addUdUiResources, directionOf, UD_LANGUAGES, UD_UI_NS, udUiResources } from '../src/i18n';
import { FILE_CATEGORIES } from '../src/lib/file-category';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}

const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
const reference = flatten(udUiResources.en as unknown as Tree);
const languages = UD_LANGUAGES.map((l) => l.code);

describe('espace ud-ui', () => {
  it('7 langues, en de référence', () => {
    expect(languages).toEqual(['en', 'fr', 'es', 'de', 'it', 'pt', 'ar']);
    expect(Object.keys(udUiResources).sort()).toEqual([...languages].sort());
  });

  it.each(languages)('%s : toutes les clés de en, aucune autre, aucune valeur vide, mêmes variables', (lng) => {
    const flat = flatten(udUiResources[lng] as unknown as Tree);
    expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort());
    for (const [key, value] of Object.entries(flat)) {
      expect(value.trim(), `${lng}:${key}`).not.toBe('');
      expect(vars(value), `${lng}:${key}`).toEqual(vars(reference[key] ?? ''));
    }
  });

  it('un libellé par catégorie de fichier', () => {
    for (const cat of FILE_CATEGORIES) expect(reference[`fileTypes.${cat}`]).toBeTruthy();
  });

  it('addUdUiResources ajoute l’espace sans écraser les surcharges de l’hôte', () => {
    const i18n = i18next.createInstance();
    void i18n.init({ lng: 'fr', fallbackLng: 'en', resources: { fr: { [UD_UI_NS]: { spaces: { home: 'Mes fichiers' } } } }, initAsync: false });
    addUdUiResources(i18n);
    expect(i18n.t('spaces.home', { ns: UD_UI_NS })).toBe('Mes fichiers');
    expect(i18n.t('account.signOut', { ns: UD_UI_NS })).toBe('Se déconnecter');
    expect(i18n.t('quota.usedOf', { ns: UD_UI_NS, used: '312 Mo', total: '1 Go' })).toBe('312 Mo sur 1 Go');
    void i18n.changeLanguage('ar');
    expect(i18n.t('account.signOut', { ns: UD_UI_NS })).toBe('تسجيل الخروج');
  });

  it('direction : arabe en RTL, le reste en LTR', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('ar-MA')).toBe('rtl');
    expect(directionOf('fr-CA')).toBe('ltr');
    expect(directionOf('xx')).toBe('ltr');
  });
});

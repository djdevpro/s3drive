import { describe, expect, it } from 'vitest';

// Espaces `explorer` et `preview` : mêmes clés dans les 7 langues (formes plurielles mises à part).
const files = import.meta.glob<Record<string, unknown>>('../src/i18n/locales/*/{explorer,preview}.json', { eager: true, import: 'default' });

function keysOf(tree: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    value && typeof value === 'object' ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`.replace(/_(zero|one|two|few|many|other)$/, '')],
  );
}

describe('traductions de l’explorateur', () => {
  for (const ns of ['explorer', 'preview']) {
    it(`${ns} : 7 langues, clés identiques à en`, () => {
      const byLang = Object.fromEntries(
        Object.entries(files)
          .filter(([path]) => path.endsWith(`/${ns}.json`))
          .map(([path, tree]) => [/locales\/([^/]+)\//.exec(path)![1]!, new Set(keysOf(tree))]),
      );
      expect(Object.keys(byLang).sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'it', 'pt']);
      const ref = [...byLang['en']!].sort();
      for (const [lng, keys] of Object.entries(byLang)) expect([...keys].sort(), lng).toEqual(ref);
    });
  }
});

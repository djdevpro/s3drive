import { HOME_SPACE, type SpaceBucket } from '@ud/contracts';
import { useUdTranslation } from '@ud/ui';
import { useCallback } from 'react';

/*
 * Libellé d'un espace : « Mon drive » pour `home`, sinon la table de
 * libellés par langue (langue exacte, puis langue de base, puis `en`, puis la première), sinon l'id.
 */

export function spaceLabelOf(space: Pick<SpaceBucket, 'name' | 'label'>, language: string, homeLabel: string): string {
  if (space.name === HOME_SPACE) return homeLabel;
  const table = space.label;
  if (table) {
    const base = language.split('-')[0] ?? language;
    const value = table[language] ?? table[base] ?? table['en'] ?? Object.values(table)[0];
    if (value) return value;
  }
  return space.name;
}

export function useSpaceLabel() {
  const { t, locale: language } = useUdTranslation();
  const home = t('spaces.home');
  return useCallback((space: Pick<SpaceBucket, 'name' | 'label'>) => spaceLabelOf(space, language, home), [home, language]);
}

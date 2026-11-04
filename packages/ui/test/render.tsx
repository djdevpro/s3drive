// Rendu de test : instance i18next isolée avec l'espace ud-ui, direction de la langue.
import { render, type RenderOptions } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { addUdUiResources, directionOf, DirectionProvider } from '../src';

export function createTestI18n(lng = 'en') {
  const i18n = i18next.createInstance();
  void i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'es', 'de', 'it', 'pt', 'ar'],
    resources: {},
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  addUdUiResources(i18n);
  return i18n;
}

export function renderUi(ui: ReactElement, { lng = 'en', ...options }: RenderOptions & { lng?: string } = {}) {
  const i18n = createTestI18n(lng);
  return render(
    <I18nextProvider i18n={i18n}>
      <DirectionProvider dir={directionOf(lng)}>{ui}</DirectionProvider>
    </I18nextProvider>,
    options,
  );
}

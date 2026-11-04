import { defineProject } from 'vitest/config';

const conditions = ['@ud/source'];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: '@ud/sdk',
    environment: 'node',
    // Les tests d'intégration contre RustFS dépassent les 5 s par défaut quand toute la suite tourne en parallèle.
    testTimeout: 60_000,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});

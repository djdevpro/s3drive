import { defineProject } from 'vitest/config';

const conditions = ['@ud/source'];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: '@ud/ui',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    // Nettoyage testing-library et API absentes de jsdom (Radix)
    setupFiles: ['./test/setup.ts'],
  },
});

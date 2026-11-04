import { defineConfig } from 'vitest/config';

// Les paquets @ud/* sont lus depuis leurs sources (condition @ud/source), comme dans Vite et tsx.
const conditions = ['@ud/source'];

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      {
        resolve: { conditions },
        ssr: { resolve: { conditions } },
        test: { name: 'repo', root: '.', include: ['tests/**/*.test.ts'], environment: 'node' },
      },
    ],
  },
});

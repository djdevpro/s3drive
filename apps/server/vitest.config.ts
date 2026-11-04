import { defineProject } from 'vitest/config';

const conditions = ['@ud/source'];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: '@ud/server',
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});

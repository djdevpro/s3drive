import react from '@vitejs/plugin-react';
import { defaultClientConditions } from 'vite';
import { defineProject } from 'vitest/config';

const conditions = ['@ud/source', ...defaultClientConditions];

export default defineProject({
  plugins: [react()],
  resolve: { conditions },
  test: {
    name: '@ud/web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});

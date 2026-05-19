import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Mirror the `@` alias from vite.config.ts so component imports
  // (`@/lib/utils` etc.) resolve under vitest jsdom.
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/**/__tests__/*.{ts,tsx}',
    ],
  },
});

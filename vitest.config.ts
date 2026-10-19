import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // En pruebas unitarias no hay entorno de React Server Components.
      'server-only': path.resolve(__dirname, 'tests/server-only-stub.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: {
      NEXT_PUBLIC_SITE_URL: 'https://lulu.ejemplo.test',
      MANAGE_LINK_SECRET: 'secreto-de-prueba-solo-para-tests-0123456789',
      CLIENT_KEY_SECRET: 'otro-secreto-de-prueba-solo-para-tests-0123456789',
    },
  },
});

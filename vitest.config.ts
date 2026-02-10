import { defineConfig } from 'vitest/config';
import path from 'path';
import os from 'os';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: Math.max(1, Math.floor(os.cpus().length / 2)),
      },
    },
    globals: true,
    // Use jsdom for React component tests, node for main process tests
    environment: 'jsdom',
    environmentMatchGlobs: [
      // Use node environment for main process engine tests
      ['tests/engine/**', 'node'],
    ],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/main/**/*.ts', 'src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
      exclude: [
        'src/main/main.ts',
        'src/main/preload.ts',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
});

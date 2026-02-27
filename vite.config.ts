import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      onLog(level, log, defaultHandler) {
        if (log.message.includes('has been externalized for browser compatibility') && log.message.includes('pyodide')) {
          return;
        }
        defaultHandler(level, log);
      },
      input: resolve(__dirname, 'src/renderer/index.html'),
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/monaco-editor') || id.includes('node_modules/@monaco-editor')) {
            return 'monaco-vendor';
          }

          if (id.includes('node_modules/@milkdown') || id.includes('node_modules/prosemirror')) {
            return 'editor-vendor';
          }

          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }

          if (id.includes('node_modules/zustand') || id.includes('node_modules/date-fns')) {
            return 'app-vendor';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['pyodide'],
  },
  worker: {
    format: 'es',
  },
});

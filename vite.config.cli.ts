/**
 * Vite build config for the standalone CLI bundle.
 *
 * Produces:  dist/cli/bds-mcp.cjs
 * Target:    Node.js (same version as Electron's Node)
 * Format:    CommonJS (required by ELECTRON_RUN_AS_NODE)
 * Strategy:  Bundle all first-party code; externalize native modules and
 *            packages whose platform-specific binaries cannot be inlined.
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

// Packages that contain native binaries or platform-specific build outputs
// that must be resolved at runtime from the app bundle.
const EXTERNALS = [
  'electron',
  '@libsql/client',
  '@libsql/linux-x64-gnu',
  '@libsql/linux-arm64-gnu',
  '@libsql/darwin-x64',
  '@libsql/darwin-arm64',
  '@libsql/win32-x64-msvc',
  '@libsql/win32-arm64-msvc',
  'chokidar',
  'fsevents',
  // Node built-ins (already externalized by Vite's 'node' target, but explicit
  // listing ensures they survive any future config change)
  'path',
  'fs',
  'os',
  'crypto',
  'child_process',
  'net',
  'tls',
  'http',
  'https',
  'stream',
  'util',
  'events',
  'assert',
  'url',
  'zlib',
  'buffer',
  'dgram',
  'dns',
];

export default defineConfig({
  build: {
    target: 'node18',
    outDir: 'dist/cli',
    emptyOutDir: true,
    ssr: resolve(__dirname, 'src/cli/bds-mcp.ts'),
    rollupOptions: {
      input: resolve(__dirname, 'src/cli/bds-mcp.ts'),
      external: EXTERNALS,
      output: {
        format: 'cjs',
        // Ensure the output file is named bds-mcp.cjs
        entryFileNames: 'bds-mcp.cjs',
        // Preserve __dirname for path resolution at runtime
        interop: 'auto',
      },
    },
    // Source maps help with debugging; keep them external to avoid inflating file size.
    sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
    minify: false, // readable stack traces in production
  },
});

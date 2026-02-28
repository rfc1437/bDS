/**
 * MCP App Review Views — loaded from HTML files in the `mcp-views/` directory.
 *
 * Each function returns a self-contained HTML page that uses the
 * `App` class from `@modelcontextprotocol/ext-apps` (loaded via
 * the `app-with-deps` bundle that includes its own dependencies).
 *
 * These Views are served as `ui://` resources and rendered inline
 * in MCP hosts that support MCP Apps (Claude, ChatGPT, VS Code, etc.).
 */

import { readFileSync } from 'fs';
import path from 'path';

/**
 * Resolve candidate directories for MCP view HTML files.
 * Checks `__dirname/mcp-views`, `dist/main/engine/mcp-views`,
 * `src/main/engine/mcp-views`, and `process.resourcesPath/mcp-views`.
 */
export function resolveMcpViewsDirs(options?: {
  moduleDir?: string;
  cwd?: string;
  resourcesPath?: string;
}): string[] {
  const moduleDir = options?.moduleDir ?? __dirname;
  const cwd = options?.cwd ?? process.cwd();
  const resourcesPath = options?.resourcesPath ?? process.resourcesPath;

  const dirs = [
    path.resolve(moduleDir, 'mcp-views'),
    path.resolve(cwd, 'dist', 'main', 'engine', 'mcp-views'),
    path.resolve(cwd, 'src', 'main', 'engine', 'mcp-views'),
  ];

  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    dirs.unshift(path.resolve(resourcesPath, 'mcp-views'));
  }

  return Array.from(new Set(dirs));
}

/**
 * Load an MCP view HTML file by name, searching candidate directories.
 * Throws if the file cannot be found in any candidate directory.
 */
export function loadViewHtml(
  filename: string,
  options?: Parameters<typeof resolveMcpViewsDirs>[0],
): string {
  const dirs = resolveMcpViewsDirs(options);
  for (const dir of dirs) {
    try {
      return readFileSync(path.join(dir, filename), 'utf-8');
    } catch {
      // try next directory
    }
  }
  throw new Error(
    `MCP view "${filename}" not found in any of: ${dirs.join(', ')}`,
  );
}

export function reviewPostHtml(
  options?: Parameters<typeof resolveMcpViewsDirs>[0],
): string {
  return loadViewHtml('review-post.html', options);
}

export function reviewScriptHtml(
  options?: Parameters<typeof resolveMcpViewsDirs>[0],
): string {
  return loadViewHtml('review-script.html', options);
}

export function reviewTemplateHtml(
  options?: Parameters<typeof resolveMcpViewsDirs>[0],
): string {
  return loadViewHtml('review-template.html', options);
}

export function reviewMetadataHtml(
  options?: Parameters<typeof resolveMcpViewsDirs>[0],
): string {
  return loadViewHtml('review-metadata.html', options);
}

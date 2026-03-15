import * as path from 'path';
import * as os from 'os';
import { spawn } from 'node:child_process';

export interface SearchIndexOptions {
  htmlDir: string;
  mainLanguage: string;
  additionalLanguages: string[];
  onProgress?: (progress: number, message?: string) => void;
}

export interface SearchIndexLanguageResult {
  language: string;
  pageCount: number;
}

export interface SearchIndexResult {
  languageIndexes: SearchIndexLanguageResult[];
}

function resolvePagefindBinaryPath(): string {
  const cpu = os.arch();
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const execnames = ['pagefind_extended', 'pagefind'];

  for (const execname of execnames) {
    const executable = platform === 'windows' ? `${execname}.exe` : execname;
    try {
      let resolved = require.resolve(`@pagefind/${platform}-${cpu}/bin/${executable}`);
      // In packaged Electron, require.resolve returns a path through app.asar
      // but the binary is in the unpacked directory alongside it
      resolved = resolved.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
      return resolved;
    } catch {
      // try next
    }
  }

  throw new Error(
    `Failed to find pagefind binary for ${platform}-${cpu}. ` +
    `Ensure @pagefind/${platform}-${cpu} is installed.`,
  );
}

function runPagefind(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const binaryPath = resolvePagefindBinaryPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Pagefind exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function parsePageCount(output: string): number {
  const match = output.match(/indexed\s+(\d+)\s+page/i) ?? output.match(/(\d+)\s+page/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Build Pagefind search indexes for a generated static site.
 *
 * For single-language sites, creates one index at `{htmlDir}/pagefind/`.
 * For multilingual sites, creates per-language indexes:
 *   - main language: `{htmlDir}/pagefind/` (indexes root html)
 *   - additional languages: `{htmlDir}/{lang}/pagefind/` (indexes `{htmlDir}/{lang}/`)
 */
export async function buildSearchIndex(options: SearchIndexOptions): Promise<SearchIndexResult> {
  const { htmlDir, mainLanguage, additionalLanguages, onProgress } = options;

  const languages = [mainLanguage, ...additionalLanguages];
  const results: SearchIndexLanguageResult[] = [];

  for (let i = 0; i < languages.length; i++) {
    const lang = languages[i];
    const isMain = lang === mainLanguage;
    const sourceDir = isMain ? htmlDir : path.join(htmlDir, lang);
    const outputDir = isMain
      ? path.join(htmlDir, 'pagefind')
      : path.join(htmlDir, lang, 'pagefind');

    const progressBase = Math.floor((i / languages.length) * 100);

    onProgress?.(progressBase, `Indexing search for ${lang}...`);

    const { stdout, stderr } = await runPagefind([
      '--site', sourceDir,
      '--output-path', outputDir,
      '--force-language', lang,
    ]);

    const pageCount = parsePageCount(stdout + stderr);
    results.push({ language: lang, pageCount });
  }

  onProgress?.(100, 'Search indexes built');
  return { languageIndexes: results };
}

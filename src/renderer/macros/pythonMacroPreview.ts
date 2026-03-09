import type { PythonMacroResolver, PythonMacroRendererFn } from './types';
import { setPythonMacroResolver } from './registry';
import { getPythonRuntimeManager } from '../python/runtimeManagerInstance';

interface ScriptLike {
  id: string;
  slug: string;
  kind: string;
  enabled: boolean;
  content: string;
  entrypoint: string;
  version: number;
}

let cachedMacroScripts: ScriptLike[] | null = null;

export function invalidatePythonMacroScriptCache(): void {
  cachedMacroScripts = null;
}

async function loadMacroScripts(): Promise<ScriptLike[]> {
  if (cachedMacroScripts) return cachedMacroScripts;

  const allScripts = await window.electronAPI?.scripts.getAll();
  cachedMacroScripts = (allScripts ?? []).filter(
    (s: ScriptLike) => s.kind === 'macro' && s.enabled,
  );
  return cachedMacroScripts;
}

const resolvePythonMacro: PythonMacroResolver = async (macroName) => {
  const scripts = await loadMacroScripts();
  const lower = macroName.toLowerCase();
  const script = scripts.find((s) => s.slug.toLowerCase() === lower);
  if (!script) return null;

  return {
    scriptId: script.id,
    slug: script.slug,
    code: script.content,
    entrypoint: script.entrypoint,
    version: script.version,
  };
};

const renderPythonMacro: PythonMacroRendererFn = async (info, params, context) => {
  const manager = getPythonRuntimeManager();
  const macroContext = {
    env: {
      isPreview: context.isPreview,
      source: { kind: 'script', id: info.scriptId },
    },
    params: params as Record<string, unknown>,
  };

  const result = await manager.renderMacroV1(info.code, macroContext, {
    entrypoint: info.entrypoint,
    cacheKey: `${info.scriptId}:v${info.version}`,
    macroSource: { kind: 'script', id: info.scriptId },
  });

  return result.result.html;
};

/**
 * Wire the Python macro resolver and renderer into the macro registry
 * so that the editor preview can render Python-backed macros.
 * Call once on startup after refreshPythonMacroSlugs().
 */
export function wirePythonMacroPreview(): void {
  setPythonMacroResolver(resolvePythonMacro, renderPythonMacro);
}

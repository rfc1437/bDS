import type { PythonMacroRenderOptions, PythonMacroSourceOptions } from './PythonRuntimeManager';

export interface MacroRenderOptionInput {
  timeoutMs?: number;
  cacheKey?: string;
  hook?: string;
  source?: PythonMacroSourceOptions;
}

export function createMacroRenderOptions(input?: MacroRenderOptionInput): PythonMacroRenderOptions {
  if (!input) {
    return {};
  }

  const options: PythonMacroRenderOptions = {};

  if (input.timeoutMs !== undefined) {
    options.timeoutMs = input.timeoutMs;
  }

  if (input.cacheKey !== undefined) {
    options.cacheKey = input.cacheKey;
  }

  if (input.hook !== undefined) {
    options.macroHook = input.hook;
  }

  if (input.source !== undefined) {
    options.macroSource = input.source;
  }

  return options;
}

/**
 * Macros Module
 * 
 * Provides a simple extension system for rendering custom content blocks
 * in markdown using [[macro param="value"]] syntax.
 * 
 * Usage:
 * 1. Import this module to register all macros
 * 2. Use the registry functions to render macros
 * 
 * Adding new macros:
 * 1. Create a file in ./definitions/ (e.g., myMacro.ts)
 * 2. Implement MacroDefinition interface
 * 3. Call registerMacro() to self-register
 * 4. Import the file in ./definitions/index.ts
 */

// Import all macro definitions so they register
import './definitions';

// Re-export types
export type {
  MacroDefinition,
  MacroParams,
  MacroRenderContext,
  ParsedMacro,
  PythonMacroInfo,
  PythonMacroResolver,
  PythonMacroRendererFn,
} from './types';

// Re-export registry functions
export {
  registerMacro,
  getMacro,
  hasMacro,
  getMacroNames,
  getAllMacros,
  clearMacros,
  parseParams,
  parseMacros,
  renderMacro,
  renderAllMacros,
  getEditorPreview,
  setPythonMacroResolver,
  refreshPythonMacroSlugs,
} from './registry';

export {
  wirePythonMacroPreview,
  invalidatePythonMacroScriptCache,
} from './pythonMacroPreview';

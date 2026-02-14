/**
 * Macro Registry
 * 
 * Central registry for all macro definitions.
 * Macros self-register using registerMacro() function.
 */

import type { MacroDefinition, MacroParams, MacroRenderContext, ParsedMacro } from './types';

// Internal registry storage
const macroRegistry = new Map<string, MacroDefinition>();

/**
 * Register a macro definition.
 * Call this from each macro definition file.
 * 
 * @param macro - The macro definition to register
 * @throws Error if a macro with the same name is already registered
 */
export function registerMacro(macro: MacroDefinition): void {
  const name = macro.name.toLowerCase();
  if (macroRegistry.has(name)) {
    console.warn(`Macro "${name}" is already registered. Overwriting.`);
  }
  macroRegistry.set(name, macro);
}

/**
 * Get a macro definition by name.
 * 
 * @param name - The macro name (case-insensitive)
 * @returns The macro definition or undefined if not found
 */
export function getMacro(name: string): MacroDefinition | undefined {
  return macroRegistry.get(name.toLowerCase());
}

/**
 * Check if a macro is registered.
 * 
 * @param name - The macro name (case-insensitive)
 */
export function hasMacro(name: string): boolean {
  return macroRegistry.has(name.toLowerCase());
}

/**
 * Get all registered macro names.
 */
export function getMacroNames(): string[] {
  return Array.from(macroRegistry.keys());
}

/**
 * Get all registered macro definitions.
 */
export function getAllMacros(): MacroDefinition[] {
  return Array.from(macroRegistry.values());
}

/**
 * Clear all registered macros (useful for testing).
 */
export function clearMacros(): void {
  macroRegistry.clear();
}

// Regex to match [[macroName param1="value1" param2='value2']]
// Supports both single and double quotes for values
const MACRO_REGEX = /\[\[(\w+)(?:\s+([^\]]+))?\]\]/g;

// Regex to extract individual parameters
// Supports: key="value", key='value', key=value (unquoted)
const PARAM_REGEX = /(\w+)=(?:["']([^"']*?)["']|([^\s\]]+))/g;

/**
 * Parse parameters from a macro parameter string.
 * 
 * @param paramString - The parameter string (e.g., 'link="file.jpg" caption="Hello"' or 'year=2016')
 * @returns Parsed key-value pairs
 */
export function parseParams(paramString: string | undefined): MacroParams {
  if (!paramString) return {};
  
  const params: MacroParams = {};
  let match;
  
  while ((match = PARAM_REGEX.exec(paramString)) !== null) {
    // match[1] = key, match[2] = quoted value, match[3] = unquoted value
    params[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  
  // Reset regex lastIndex for next use
  PARAM_REGEX.lastIndex = 0;
  
  return params;
}

/**
 * Parse all macros from a markdown string.
 * 
 * @param markdown - The markdown content to parse
 * @returns Array of parsed macros with their positions
 */
export function parseMacros(markdown: string): ParsedMacro[] {
  const macros: ParsedMacro[] = [];
  let match;
  
  while ((match = MACRO_REGEX.exec(markdown)) !== null) {
    macros.push({
      name: match[1].toLowerCase(),
      params: parseParams(match[2]),
      rawText: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  
  // Reset regex lastIndex for next use
  MACRO_REGEX.lastIndex = 0;
  
  return macros;
}

/**
 * Render a single macro to HTML.
 * 
 * @param macro - The parsed macro
 * @param context - Render context
 * @returns The rendered HTML or an error placeholder
 */
export async function renderMacro(
  macro: ParsedMacro,
  context: MacroRenderContext
): Promise<string> {
  const definition = getMacro(macro.name);
  
  if (!definition) {
    return `<span class="macro-error" title="Unknown macro: ${macro.name}">${macro.rawText}</span>`;
  }
  
  // Validate if validator exists
  if (definition.validate) {
    const error = definition.validate(macro.params);
    if (error) {
      return `<span class="macro-error" title="${error}">${macro.rawText}</span>`;
    }
  }
  
  try {
    const result = definition.render(macro.params, context);
    return result instanceof Promise ? await result : result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Render error';
    return `<span class="macro-error" title="${message}">${macro.rawText}</span>`;
  }
}

/**
 * Render all macros in a markdown string to HTML.
 * Returns the markdown with macros replaced by their rendered HTML.
 * 
 * @param markdown - The markdown content
 * @param context - Render context
 * @returns Markdown with macros replaced by rendered HTML
 */
export async function renderAllMacros(
  markdown: string,
  context: MacroRenderContext
): Promise<string> {
  const macros = parseMacros(markdown);
  
  if (macros.length === 0) return markdown;
  
  // Render all macros in parallel
  const rendered = await Promise.all(
    macros.map(macro => renderMacro(macro, context))
  );
  
  // Replace macros from end to start to preserve positions
  let result = markdown;
  for (let i = macros.length - 1; i >= 0; i--) {
    const macro = macros[i];
    result = result.slice(0, macro.start) + rendered[i] + result.slice(macro.end);
  }
  
  return result;
}

/**
 * Get the editor preview text for a macro.
 * 
 * @param name - The macro name
 * @param params - The macro parameters
 * @returns Preview text for the editor
 */
export function getEditorPreview(name: string, params: MacroParams): string {
  const definition = getMacro(name);
  
  if (!definition) {
    return `⚠ ${name}`;
  }
  
  if (definition.editorPreview) {
    return definition.editorPreview(params);
  }
  
  return `⬡ ${definition.name}`;
}

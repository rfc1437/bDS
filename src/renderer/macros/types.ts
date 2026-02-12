/**
 * Interface for macro definitions.
 * 
 * Macros are custom content blocks that can be inserted into markdown
 * using the syntax: [[macroName param1="value1" param2="value2"]]
 * 
 * They are rendered in the editor with a shaded background showing the raw syntax,
 * and can be transformed to custom HTML during preview/export.
 */

export interface MacroParams {
  [key: string]: string;
}

export interface MacroRenderContext {
  /** The post ID if available */
  postId?: string;
  /** Base path for resolving relative URLs */
  basePath?: string;
  /** Whether rendering for preview (true) or final export (false) */
  isPreview: boolean;
}

export interface MacroDefinition {
  /**
   * Unique name for the macro (lowercase, no spaces).
   * Used in the syntax: [[name ...]]
   */
  name: string;

  /**
   * Human-readable description of what this macro does.
   */
  description: string;

  /**
   * Render the macro to HTML for preview/export.
   * 
   * @param params - Key-value pairs from the macro syntax
   * @param context - Additional context for rendering
   * @returns HTML string to replace the macro with
   */
  render(params: MacroParams, context: MacroRenderContext): string | Promise<string>;

  /**
   * Optional: Short preview text shown in the editor.
   * If not provided, shows the macro name.
   * 
   * @param params - Key-value pairs from the macro syntax
   * @returns Preview text (not HTML, just plain text)
   */
  editorPreview?(params: MacroParams): string;

  /**
   * Optional: Validate macro parameters.
   * 
   * @param params - Key-value pairs to validate
   * @returns Error message if invalid, undefined if valid
   */
  validate?(params: MacroParams): string | undefined;
}

/**
 * Parsed macro from markdown content
 */
export interface ParsedMacro {
  /** The macro name */
  name: string;
  /** Parsed parameters */
  params: MacroParams;
  /** Original raw text including [[ and ]] */
  rawText: string;
  /** Start position in the source text */
  start: number;
  /** End position in the source text */
  end: number;
}

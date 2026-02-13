/**
 * Markdown escape utilities for Milkdown editor
 * 
 * Handles unescaping of special characters that Milkdown/remark escapes
 * but should be preserved in macro syntax.
 */

/**
 * Unescape special characters in macro syntax that Milkdown escapes.
 * 
 * Milkdown/remark-stringify escapes:
 * - Brackets [ and ] to prevent unwanted link syntax
 * - Underscores _ to prevent unwanted emphasis
 * 
 * For macros like [[photo_gallery]], we want to preserve the original syntax.
 * 
 * Strategy:
 * 1. First unescape all brackets (they're always safe to unescape)
 * 2. Then unescape underscores only inside [[...]] macro syntax
 * 
 * @param markdown - The markdown string with escaped characters
 * @returns The markdown with macro syntax unescaped
 */
export function unescapeMacroSyntax(markdown: string): string {
  if (!markdown) return markdown;
  
  // Step 1: Unescape all brackets \[ and \] back to [ and ]
  let result = markdown.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  
  // Step 2: Unescape underscores only inside macro brackets [[...]]
  // Match [[...]] patterns and unescape underscores within them
  result = result.replace(/\[\[([^\]]*)\]\]/g, (_match, content) => {
    // Unescape underscores within the macro content
    const unescapedContent = content.replace(/\\_/g, '_');
    return `[[${unescapedContent}]]`;
  });
  
  return result;
}

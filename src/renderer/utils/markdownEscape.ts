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

const unorderedListItemPattern = /^\s{0,3}[-+*]\s/;
const orderedListItemPattern = /^\s{0,3}\d+\.\s/;

function getListLineType(line: string): 'ordered' | 'unordered' | null {
  if (unorderedListItemPattern.test(line)) return 'unordered';
  if (orderedListItemPattern.test(line)) return 'ordered';
  return null;
}

export function normalizeMilkdownMarkdown(markdown: string): string {
  const unescaped = unescapeMacroSyntax(markdown);
  const lines = unescaped.split('\n');
  const normalized: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const previousListType = i > 0 ? getListLineType(lines[i - 1]) : null;
    const nextListType = i < lines.length - 1 ? getListLineType(lines[i + 1]) : null;
    if (line === '' && previousListType !== null && previousListType === nextListType) {
      continue;
    }

    if (line === '>') {
      normalized.push('> ');
      continue;
    }

    normalized.push(line);
  }

  return normalized.join('\n');
}

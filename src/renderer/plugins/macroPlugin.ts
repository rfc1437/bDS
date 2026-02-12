/**
 * Milkdown Macro Plugin
 * 
 * Provides parsing and rendering of [[macro param="value"]] syntax in Milkdown.
 * Macros appear with a shaded background in the editor.
 */

import { $node, $inputRule, $remark } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { Plugin } from 'unified';
import type { Root, Text, Parent } from 'mdast';
import { visit } from 'unist-util-visit';
import { getEditorPreview, parseParams, hasMacro } from '../macros/registry';

// Regex to match [[macroName param1="value1" param2='value2']]
const MACRO_REGEX = /\[\[(\w+)(?:\s+([^\]]+))?\]\]/g;

/**
 * Custom MDAST node type for macros
 */
interface MacroMdastNode {
  type: 'macro';
  name: string;
  params: Record<string, string>;
  raw: string;
}

/**
 * Remark plugin to parse [[macro]] syntax into macro nodes
 */
const remarkMacroParser: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (index === undefined || parent === undefined) return;
      
      const matches = [...node.value.matchAll(MACRO_REGEX)];
      if (matches.length === 0) return;
      
      // Build new nodes to replace this text node
      const newNodes: (Text | MacroMdastNode)[] = [];
      let lastIndex = 0;
      
      for (const match of matches) {
        const [fullMatch, name, paramStr] = match;
        const startIdx = match.index!;
        
        // Text before macro
        if (startIdx > lastIndex) {
          newNodes.push({
            type: 'text',
            value: node.value.slice(lastIndex, startIdx),
          });
        }
        
        // Macro node
        newNodes.push({
          type: 'macro',
          name: name.toLowerCase(),
          params: parseParams(paramStr),
          raw: fullMatch,
        });
        
        lastIndex = startIdx + fullMatch.length;
      }
      
      // Text after last macro
      if (lastIndex < node.value.length) {
        newNodes.push({
          type: 'text',
          value: node.value.slice(lastIndex),
        });
      }
      
      // Replace the text node with our new nodes
      parent.children.splice(index, 1, ...(newNodes as typeof parent.children));
      
      // Return the index to skip newly inserted nodes
      return index + newNodes.length;
    });
  };
};

/**
 * Remark plugin registration for Milkdown
 */
export const remarkMacro = $remark('remarkMacro', () => remarkMacroParser);

/**
 * ProseMirror node schema for macros
 */
export const macroNode = $node('macro', () => ({
  group: 'inline',
  inline: true,
  atom: true, // Treated as a single unit, not editable as text
  attrs: {
    name: { default: '' },
    params: { default: {} },
    raw: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span[data-macro]',
      getAttrs: (dom): Record<string, unknown> => {
        const element = dom as HTMLElement;
        return {
          name: element.dataset.macroName || '',
          params: JSON.parse(element.dataset.macroParams || '{}'),
          raw: element.dataset.macroRaw || '',
        };
      },
    },
  ],
  toDOM: (node: ProseNode) => {
    const { name, params, raw } = node.attrs;
    const preview = getEditorPreview(name, params);
    const isKnown = hasMacro(name);
    
    return [
      'span',
      {
        'data-macro': 'true',
        'data-macro-name': name,
        'data-macro-params': JSON.stringify(params),
        'data-macro-raw': raw,
        class: `milkdown-macro ${isKnown ? 'macro-known' : 'macro-unknown'}`,
        title: raw,
        contenteditable: 'false',
      },
      preview,
    ];
  },
  parseMarkdown: {
    match: (node) => node.type === 'macro',
    runner: (state, node, type) => {
      const macroNode = node as unknown as MacroMdastNode;
      state.addNode(type, {
        name: macroNode.name,
        params: macroNode.params,
        raw: macroNode.raw,
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'macro',
    runner: (state, node) => {
      // Output the original raw macro syntax
      state.addNode('text', undefined, node.attrs.raw);
    },
  },
}));

/**
 * Input rule to convert typed [[macro...]] to macro node
 * Triggers when user types ]] to close a macro
 */
export const macroInputRule = $inputRule(() => {
  // Match [[macroName param="value"]] when user types the closing ]]
  return new InputRule(
    /\[\[(\w+)(?:\s+([^\]]+))?\]\]$/,
    (state, match, start, end) => {
      const [fullMatch, name, paramStr] = match;
      const macroType = state.schema.nodes.macro;
      
      if (!macroType) return null;
      
      const params = parseParams(paramStr);
      const macroNodeInstance = macroType.create({
        name: name.toLowerCase(),
        params,
        raw: fullMatch,
      });
      
      return state.tr.replaceWith(start, end, macroNodeInstance);
    }
  );
});

/**
 * Export all macro plugin components
 * Use with: editor.use(macroPlugin)
 */
export const macroPlugin = [
  remarkMacro,
  macroNode,
  macroInputRule,
].flat();

export default macroPlugin;

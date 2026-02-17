import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Editor, defaultValueCtx, parserCtx, remarkPluginsCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { Plugin } from 'unified';
import type { Root, List, ListItem } from 'mdast';
import { visit } from 'unist-util-visit';
import { normalizeMilkdownMarkdown } from '../../../src/renderer/utils/markdownEscape';

const wxrRefDir = path.join(__dirname, '../../assets/wxr-ref');

const remarkTightListsPlugin: Plugin<[Record<string, unknown>], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'list', (node) => {
      const listNode = node as List;
      listNode.spread = false;
      for (const child of listNode.children) {
        if (child.type === 'listItem') {
          (child as ListItem).spread = false;
        }
      }
    });
  };
};

describe('Milkdown markdown round trip', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  it('preserves reference markdown bodies across load -> internal -> markdown cycle', async () => {
    const files = fs.readdirSync(wxrRefDir).filter((file) => file.endsWith('.md'));

    for (const file of files) {
      const raw = fs.readFileSync(path.join(wxrRefDir, file), 'utf-8');
      const { content } = matter(raw);

      const editor = await Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, content);
          ctx.set(remarkStringifyOptionsCtx, {
            bullet: '-',
            listItemIndent: 'one',
          });
          ctx.set(remarkPluginsCtx, [{ plugin: remarkTightListsPlugin, options: {} }]);
        })
        .use(commonmark)
        .use(gfm)
        .create();

      const serialized = editor.action((ctx) => {
        const parser = ctx.get(parserCtx);
        const serializer = ctx.get(serializerCtx);
        const doc = parser(content);
        return normalizeMilkdownMarkdown(serializer(doc));
      });

      await editor.destroy();

      expect(serialized, `round trip mismatch for ${file}`).toBe(content);
    }
  }, 30000);
});

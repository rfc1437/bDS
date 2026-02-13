import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, remarkStringifyOptionsCtx, remarkPluginsCtx } from '@milkdown/kit/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand, insertHrCommand, toggleInlineCodeCommand, insertImageCommand, toggleLinkCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { indent } from '@milkdown/kit/plugin/indent';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { replaceAll } from '@milkdown/kit/utils';
import { Milkdown, MilkdownProvider, useInstance, useEditor } from '@milkdown/react';
import { callCommand } from '@milkdown/kit/utils';
import type { Ctx } from '@milkdown/kit/ctx';
import type { RemarkPlugin } from '@milkdown/kit/transformer';
import type { Root, List, ListItem } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';
import { macroPlugin } from '../../plugins/macroPlugin';
// Import macros module to register all macro definitions
import '../../macros';
import './MilkdownEditor.css';
import { PostSearchModal } from '../PostSearchModal';
import { unescapeMacroSyntax } from '../../utils/markdownEscape';

// Remark plugin to force tight lists (no blank lines between list items)
const remarkTightListsPlugin: Plugin<[Record<string, unknown>], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'list', (node) => {
      const listNode = node as List;
      // Set spread to false to make lists tight
      listNode.spread = false;
      // Also set each list item's spread to false
      for (const child of listNode.children) {
        if (child.type === 'listItem') {
          (child as ListItem).spread = false;
        }
      }
    });
  };
};

// Wrap as Milkdown RemarkPlugin format
const remarkTightLists: RemarkPlugin = {
  plugin: remarkTightListsPlugin,
  options: {},
};

interface SearchResult {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
}

interface MilkdownEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

// Toolbar component that uses the editor instance
const EditorToolbar: React.FC = () => {
  const [loading, getEditor] = useInstance();
  const [showPostSearch, setShowPostSearch] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runCommand = useCallback((commandKey: any, payload?: unknown) => {
    if (loading) return;
    const editor = getEditor();
    if (editor) {
      editor.action(callCommand(commandKey, payload));
    }
  }, [loading, getEditor]);

  const insertHeading = useCallback((level: number) => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;
    
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const { $from } = state.selection;
      const lineStart = $from.start();
      const lineEnd = $from.end();
      const lineText = state.doc.textBetween(lineStart, lineEnd);
      
      // Remove existing heading markers
      const cleanText = lineText.replace(/^#{1,6}\s*/, '');
      const newText = `${'#'.repeat(level)} ${cleanText}`;
      
      const tr = state.tr.replaceWith(
        lineStart,
        lineEnd,
        state.schema.text(newText)
      );
      dispatch(tr);
    });
  }, [loading, getEditor]);

  const insertLink = useCallback(() => {
    const url = window.prompt('Enter URL:');
    if (!url) return;
    runCommand(toggleLinkCommand.key, { href: url });
  }, [runCommand]);

  const insertImage = useCallback(() => {
    const url = window.prompt('Enter image URL:');
    if (!url) return;
    const alt = window.prompt('Enter alt text:', 'Image') || 'Image';
    runCommand(insertImageCommand.key, { src: url, alt });
  }, [runCommand]);

  const insertPostLink = useCallback(() => {
    setShowPostSearch(true);
  }, []);

  // Add keyboard shortcut listener for Ctrl/Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowPostSearch(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handlePostSelected = useCallback((post: SearchResult) => {
    const editor = getEditor();
    if (!editor) return;

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const { selection, schema } = state;
      const selectedText = selection.empty ? '' : state.doc.textBetween(selection.from, selection.to);

      const linkText = selectedText || post.title;
      const linkUrl = `/posts/${post.slug}`;

      if (selection.empty) {
        // No selection - create text node with link mark and insert it
        const linkMark = schema.marks.link.create({ href: linkUrl });
        const textNode = schema.text(linkText, [linkMark]);
        const tr = state.tr.replaceSelectionWith(textNode, false);
        dispatch(tr);
      } else {
        // Has selection - toggle link mark on selection
        const linkMark = schema.marks.link.create({ href: linkUrl });
        const tr = state.tr.addMark(selection.from, selection.to, linkMark);
        dispatch(tr);
      }
    });

    setShowPostSearch(false);
  }, [getEditor]);

  if (loading) return null;

  return (
    <>
      <div className="milkdown-toolbar">
        <div className="toolbar-group">
          <button onClick={() => insertHeading(1)} title="Heading 1">H1</button>
          <button onClick={() => insertHeading(2)} title="Heading 2">H2</button>
          <button onClick={() => insertHeading(3)} title="Heading 3">H3</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => runCommand(toggleStrongCommand.key)} title="Bold (Ctrl+B)">
            <strong>B</strong>
          </button>
          <button onClick={() => runCommand(toggleEmphasisCommand.key)} title="Italic (Ctrl+I)">
            <em>I</em>
          </button>
          <button onClick={() => runCommand(toggleStrikethroughCommand.key)} title="Strikethrough">
            <s>S</s>
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => runCommand(wrapInBulletListCommand.key)} title="Bullet List">•</button>
          <button onClick={() => runCommand(wrapInOrderedListCommand.key)} title="Numbered List">1.</button>
          <button onClick={() => runCommand(wrapInBlockquoteCommand.key)} title="Quote">❝</button>
          <button onClick={() => runCommand(toggleInlineCodeCommand.key)} title="Code">{'{}'}</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={insertLink} title="Insert Link">🔗</button>
          <button onClick={insertPostLink} title="Link to Post (Ctrl+K)">📝</button>
          <button onClick={insertImage} title="Insert Image">🖼</button>
          <button onClick={() => runCommand(insertHrCommand.key)} title="Horizontal Rule">―</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => runCommand(undoCommand.key)} title="Undo (Ctrl+Z)">↶</button>
          <button onClick={() => runCommand(redoCommand.key)} title="Redo (Ctrl+Y)">↷</button>
        </div>
      </div>

      {showPostSearch && (
        <PostSearchModal
          onSelect={handlePostSelected}
          onClose={() => setShowPostSearch(false)}
        />
      )}
    </>
  );
};

// Main component with provider wrapper
export const MilkdownEditor: React.FC<MilkdownEditorProps> = (props) => {
  return (
    <MilkdownProvider>
      <MilkdownProviderInner {...props} />
    </MilkdownProvider>
  );
};

// Separate component to use hooks within provider
const MilkdownProviderInner: React.FC<MilkdownEditorProps> = ({
  content,
  onChange,
  placeholder = 'Start writing your content...',
}) => {
  const [loading, getEditor] = useInstance();
  const lastExternalContent = useRef(content);
  const isInternalChange = useRef(false);
  const onChangeRef = useRef(onChange);
  const contentRef = useRef(content);
  // Store the normalized markdown after Milkdown's initial round-trip
  // Only trigger onChange if the markdown differs from this baseline
  const normalizedBaseline = useRef<string | null>(null);
  
  // Keep refs updated
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Initialize editor using useEditor hook
  useEditor((root) => {
    return Editor.make()
      .config((ctx: Ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, contentRef.current);
        // Configure remark-stringify to produce tight lists (no blank lines between list items)
        ctx.set(remarkStringifyOptionsCtx, {
          bullet: '-',
          listItemIndent: 'one',
        });
        // Add custom remark plugin to force tight lists
        ctx.set(remarkPluginsCtx, [remarkTightLists]);
        ctx.get(listenerCtx).markdownUpdated((_ctx: Ctx, markdown: string, prevMarkdown: string) => {
          // Unescape brackets and underscores to preserve macro syntax like [[photo_gallery]]
          const unescaped = unescapeMacroSyntax(markdown);
          const prevUnescaped = unescapeMacroSyntax(prevMarkdown);
          
          if (unescaped !== prevUnescaped) {
            // On first update after load, store the normalized baseline
            // This captures Milkdown's round-trip formatting
            if (normalizedBaseline.current === null) {
              normalizedBaseline.current = unescaped;
              return; // Don't trigger onChange for initial normalization
            }
            // Only trigger onChange if content differs from the baseline
            // (meaning the user actually edited something)
            if (unescaped !== normalizedBaseline.current) {
              isInternalChange.current = true;
              normalizedBaseline.current = unescaped; // Update baseline
              onChangeRef.current(unescaped);
            }
          }
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(macroPlugin)
      .use(history)
      .use(listener)
      .use(clipboard)
      .use(trailing)
      .use(indent)
      .use(cursor);
  }, []);

  // Handle external content changes
  useEffect(() => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;

    if (content !== lastExternalContent.current && !isInternalChange.current) {
      // Reset baseline so next markdownUpdated captures new normalized content
      normalizedBaseline.current = null;
      editor.action(replaceAll(content));
      lastExternalContent.current = content;
    } else if (isInternalChange.current) {
      // Update ref for internal changes to keep it in sync
      lastExternalContent.current = content;
    }
    isInternalChange.current = false;
  }, [content, loading, getEditor]);

  return (
    <div className="milkdown-editor">
      <EditorToolbar />
      <div className="milkdown-content" data-placeholder={placeholder}>
        <Milkdown />
      </div>
    </div>
  );
};

export default MilkdownEditor;

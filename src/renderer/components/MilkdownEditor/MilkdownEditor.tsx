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
import { imageResolverPlugin } from '../../plugins/imageResolverPlugin';
// Import macros module to register all macro definitions
import '../../macros';
import './MilkdownEditor.css';
import { InsertModal } from '../InsertModal';
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

type InsertModalMode = 'link' | 'image' | null;

interface MilkdownEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

// Toolbar component that uses the editor instance
const EditorToolbar: React.FC = () => {
  const [loading, getEditor] = useInstance();
  const [insertMode, setInsertMode] = useState<InsertModalMode>(null);
  const [selectedText, setSelectedText] = useState('');

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

  // Get current selection text from editor
  const getSelectionText = useCallback(() => {
    const editor = getEditor();
    if (!editor) return '';
    let text = '';
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const { selection } = state;
      if (!selection.empty) {
        text = state.doc.textBetween(selection.from, selection.to);
      }
    });
    return text;
  }, [getEditor]);

  const openLinkModal = useCallback(() => {
    const text = getSelectionText();
    setSelectedText(text);
    setInsertMode('link');
  }, [getSelectionText]);

  const openImageModal = useCallback(() => {
    setSelectedText('');
    setInsertMode('image');
  }, []);

  // Add keyboard shortcut listener for Ctrl/Cmd+K (link)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        openLinkModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openLinkModal]);

  // Handle link insertion from modal
  const handleInsertLink = useCallback((url: string, text?: string) => {
    const editor = getEditor();
    if (!editor) return;

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const { selection, schema } = state;
      const currentSelectedText = selection.empty ? '' : state.doc.textBetween(selection.from, selection.to);

      const linkText = currentSelectedText || text || url;
      const linkUrl = url;

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

    setInsertMode(null);
  }, [getEditor]);

  // Handle image insertion from modal
  const handleInsertImage = useCallback((url: string, alt: string) => {
    runCommand(insertImageCommand.key, { src: url, alt });
    setInsertMode(null);
  }, [runCommand]);

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
          <button onClick={openLinkModal} title="Insert Link (Ctrl+K)">🔗</button>
          <button onClick={openImageModal} title="Insert Image">🖼</button>
          <button onClick={() => runCommand(insertHrCommand.key)} title="Horizontal Rule">―</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => runCommand(undoCommand.key)} title="Undo (Ctrl+Z)">↶</button>
          <button onClick={() => runCommand(redoCommand.key)} title="Redo (Ctrl+Y)">↷</button>
        </div>
      </div>

      {insertMode && (
        <InsertModal
          mode={insertMode}
          onInsertLink={handleInsertLink}
          onInsertImage={handleInsertImage}
          onClose={() => setInsertMode(null)}
          initialText={selectedText}
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
      .use(imageResolverPlugin)
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

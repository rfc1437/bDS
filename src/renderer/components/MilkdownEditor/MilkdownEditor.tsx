import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, remarkStringifyOptionsCtx, remarkPluginsCtx } from '@milkdown/kit/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInOrderedListCommand, insertHrCommand, toggleInlineCodeCommand, insertImageCommand } from '@milkdown/kit/preset/commonmark';
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
import { dropImagePlugin } from '../../plugins/dropImagePlugin';
// Import macros module to register all macro definitions
import '../../macros';
import './MilkdownEditor.css';
import { InsertModal } from '../InsertModal';
import { normalizeMilkdownMarkdown } from '../../utils/markdownEscape';
import { useI18n } from '../../i18n';

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
  currentPostTags?: string[];
  currentPostCategories?: string[];
}

interface MilkdownChangePropagationInput {
  markdown: string;
  prevMarkdown: string;
  externalContent: string;
  hasUserInteracted: boolean;
}

export const shouldPropagateMilkdownChange = ({
  markdown,
  prevMarkdown,
  externalContent,
  hasUserInteracted,
}: MilkdownChangePropagationInput): boolean => {
  const normalized = normalizeMilkdownMarkdown(markdown);
  const prevNormalized = normalizeMilkdownMarkdown(prevMarkdown);
  const externalNormalized = normalizeMilkdownMarkdown(externalContent);

  if (normalized === prevNormalized) {
    return false;
  }

  if (!hasUserInteracted) {
    return false;
  }

  return normalized !== externalNormalized;
};

interface EditorToolbarProps {
  onUserInteraction: () => void;
  currentPostTags?: string[];
  currentPostCategories?: string[];
}

// Toolbar component that uses the editor instance
const EditorToolbar: React.FC<EditorToolbarProps> = ({ onUserInteraction, currentPostTags, currentPostCategories }) => {
  const { t: tr } = useI18n();
  const [loading, getEditor] = useInstance();
  const [insertMode, setInsertMode] = useState<InsertModalMode>(null);
  const [selectedText, setSelectedText] = useState('');

  const runCommand = useCallback((commandKey: any, payload?: unknown) => {
    if (loading) return;
    const editor = getEditor();
    if (editor) {
      onUserInteraction();
      editor.action(callCommand(commandKey, payload));
    }
  }, [loading, getEditor, onUserInteraction]);

  const insertHeading = useCallback((level: number) => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;
    onUserInteraction();
    
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
  }, [loading, getEditor, onUserInteraction]);

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
    onUserInteraction();
    const text = getSelectionText();
    setSelectedText(text);
    setInsertMode('link');
  }, [getSelectionText, onUserInteraction]);

  const openImageModal = useCallback(() => {
    onUserInteraction();
    setSelectedText('');
    setInsertMode('image');
  }, [onUserInteraction]);

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
    onUserInteraction();

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
  }, [getEditor, onUserInteraction]);

  // Handle image insertion from modal
  const handleInsertImage = useCallback((url: string, alt: string) => {
    onUserInteraction();
    runCommand(insertImageCommand.key, { src: url, alt });
    setInsertMode(null);
  }, [onUserInteraction, runCommand]);

  if (loading) return null;

  return (
    <>
      <div className="milkdown-toolbar">
        <div className="toolbar-group">
          <button onClick={() => insertHeading(1)} title={tr('milkdown.heading1')}>H1</button>
          <button onClick={() => insertHeading(2)} title={tr('milkdown.heading2')}>H2</button>
          <button onClick={() => insertHeading(3)} title={tr('milkdown.heading3')}>H3</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => runCommand(toggleStrongCommand.key)} title={tr('milkdown.bold')}>
            <strong>B</strong>
          </button>
          <button onClick={() => runCommand(toggleEmphasisCommand.key)} title={tr('milkdown.italic')}>
            <em>I</em>
          </button>
          <button onClick={() => runCommand(toggleStrikethroughCommand.key)} title={tr('milkdown.strikethrough')}>
            <s>S</s>
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => runCommand(wrapInBulletListCommand.key)} title={tr('milkdown.bulletList')}>•</button>
          <button onClick={() => runCommand(wrapInOrderedListCommand.key)} title={tr('milkdown.numberedList')}>1.</button>
          <button onClick={() => runCommand(wrapInBlockquoteCommand.key)} title={tr('milkdown.quote')}>❝</button>
          <button onClick={() => runCommand(toggleInlineCodeCommand.key)} title={tr('milkdown.code')}>{'{}'}</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={openLinkModal} title={tr('milkdown.insertLink')}>🔗</button>
          <button onClick={openImageModal} title={tr('milkdown.insertImage')}>🖼</button>
          <button onClick={() => runCommand(insertHrCommand.key)} title={tr('milkdown.horizontalRule')}>―</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={() => runCommand(undoCommand.key)} title={tr('milkdown.undo')}>↶</button>
          <button onClick={() => runCommand(redoCommand.key)} title={tr('milkdown.redo')}>↷</button>
        </div>
      </div>

      {insertMode && (
        <InsertModal
          mode={insertMode}
          onInsertLink={handleInsertLink}
          onInsertImage={handleInsertImage}
          onClose={() => setInsertMode(null)}
          initialText={selectedText}
          currentPostTags={currentPostTags}
          currentPostCategories={currentPostCategories}
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
  placeholder,
  currentPostTags,
  currentPostCategories,
}) => {
  const { t: tr } = useI18n();
  const resolvedPlaceholder = placeholder || tr('editor.placeholder');
  const [loading, getEditor] = useInstance();
  const lastExternalContent = useRef(content);
  const isInternalChange = useRef(false);
  const onChangeRef = useRef(onChange);
  const contentRef = useRef(content);
  const hasUserInteractedRef = useRef(false);
  
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
          const shouldEmit = shouldPropagateMilkdownChange({
            markdown,
            prevMarkdown,
            externalContent: contentRef.current,
            hasUserInteracted: hasUserInteractedRef.current,
          });

          if (shouldEmit) {
            isInternalChange.current = true;
            onChangeRef.current(normalizeMilkdownMarkdown(markdown));
          }
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(imageResolverPlugin)
      .use(dropImagePlugin)
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
      hasUserInteractedRef.current = false;
      editor.action(replaceAll(content));
      lastExternalContent.current = content;
    } else if (isInternalChange.current) {
      // Update ref for internal changes to keep it in sync
      lastExternalContent.current = content;
    }
    isInternalChange.current = false;
  }, [content, loading, getEditor]);

  const markUserInteraction = useCallback(() => {
    hasUserInteractedRef.current = true;
  }, []);

  return (
    <div
      className="milkdown-editor"
      onMouseDownCapture={markUserInteraction}
      onKeyDownCapture={markUserInteraction}
      onPasteCapture={markUserInteraction}
      onInputCapture={markUserInteraction}
    >
      <EditorToolbar onUserInteraction={markUserInteraction} currentPostTags={currentPostTags} currentPostCategories={currentPostCategories} />
      <div className="milkdown-content" data-placeholder={resolvedPlaceholder}>
        <Milkdown />
      </div>
    </div>
  );
};

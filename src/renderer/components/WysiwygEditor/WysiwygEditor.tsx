import React, { useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TurndownService from 'turndown';
import './WysiwygEditor.css';

// Convert HTML to Markdown
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Add custom rules for turndown
turndownService.addRule('strikethrough', {
  filter: ['del', 's', 'strike'],
  replacement: (content) => `~~${content}~~`,
});

interface WysiwygEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}

// Simple markdown to HTML converter for TipTap
function markdownToHtml(markdown: string): string {
  // Simple markdown parser - for production use a proper library
  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    // Blockquotes
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^\s*[-*+] (.+)$/gim, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gim, '<li>$1</li>')
    // Horizontal rule
    .replace(/^(?:---+|___+|\*\*\*+)$/gim, '<hr>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p>')
    // Single line breaks
    .replace(/\n/g, '<br>');

  // Wrap in paragraphs if not starting with a block element
  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }

  // Fix consecutive blockquotes
  html = html.replace(/<\/blockquote>\s*<blockquote>/g, '<br>');

  // Wrap list items in ul/ol
  html = html.replace(/(<li>.*<\/li>)+/g, (match) => {
    // Check if it's ordered (starts with number) or unordered
    return '<ul>' + match + '</ul>';
  });

  return html;
}

export const WysiwygEditor: React.FC<WysiwygEditorProps> = ({
  content,
  onChange,
  placeholder = 'Start writing your content...',
}) => {
  // Track if we're updating from internal changes vs external prop changes
  const isInternalChange = useRef(false);
  const lastExternalContent = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'editor-link',
        },
      }),
      Underline,
      Image.configure({
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: markdownToHtml(content),
    onUpdate: ({ editor }) => {
      isInternalChange.current = true;
      const html = editor.getHTML();
      const markdown = turndownService.turndown(html);
      onChange(markdown);
    },
    editable: true,
  });

  // Sync content from external changes only (e.g., post switch)
  useEffect(() => {
    if (editor && content !== lastExternalContent.current) {
      // This is an external change (e.g., switching posts)
      if (!isInternalChange.current) {
        const newHtml = markdownToHtml(content);
        editor.commands.setContent(newHtml);
      }
      lastExternalContent.current = content;
      isInternalChange.current = false;
    }
  }, [content, editor]);

  const addImage = useCallback(() => {
    const url = window.prompt('Enter image URL:');
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL:', previousUrl);

    if (url === null) return;

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="wysiwyg-editor">
      {/* Bubble menu appears when text is selected */}
      {editor && (
        <BubbleMenu className="bubble-menu" editor={editor}>
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'is-active' : ''}
            title="Bold"
          >
            <strong>B</strong>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'is-active' : ''}
            title="Italic"
          >
            <em>I</em>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={editor.isActive('underline') ? 'is-active' : ''}
            title="Underline"
          >
            <u>U</u>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive('strike') ? 'is-active' : ''}
            title="Strikethrough"
          >
            <s>S</s>
          </button>
          <div className="divider" />
          <button onClick={setLink} className={editor.isActive('link') ? 'is-active' : ''} title="Link">
            🔗
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive('code') ? 'is-active' : ''}
            title="Code"
          >
            {'</>'}
          </button>
        </BubbleMenu>
      )}

      {/* Floating menu appears on empty lines, but only when editor has content */}
      {editor && (
        <FloatingMenu 
          className="floating-menu" 
          editor={editor}
          shouldShow={({ editor }) => {
            // Only show floating menu if editor has real content (not just empty paragraph)
            const text = editor.state.doc.textContent;
            if (!text || text.trim().length === 0) {
              return false;
            }
            // Also check if we're on an empty line (default behavior)
            const { $from } = editor.state.selection;
            const isEmptyLine = $from.parent.content.size === 0;
            return isEmptyLine;
          }}
        >
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
          >
            H1
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
          >
            H2
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
          >
            H3
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'is-active' : ''}
          >
            • List
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive('blockquote') ? 'is-active' : ''}
          >
            ❝ Quote
          </button>
          <button onClick={addImage}>
            🖼 Image
          </button>
        </FloatingMenu>
      )}

      {/* Toolbar */}
      <div className="wysiwyg-toolbar">
        <div className="toolbar-group">
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
            title="Heading 1"
          >
            H1
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
            title="Heading 2"
          >
            H2
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
            title="Heading 3"
          >
            H3
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'is-active' : ''}
            title="Bold (Ctrl+B)"
          >
            <strong>B</strong>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'is-active' : ''}
            title="Italic (Ctrl+I)"
          >
            <em>I</em>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={editor.isActive('underline') ? 'is-active' : ''}
            title="Underline (Ctrl+U)"
          >
            <u>U</u>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive('strike') ? 'is-active' : ''}
            title="Strikethrough"
          >
            <s>S</s>
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'is-active' : ''}
            title="Bullet List"
          >
            •
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive('orderedList') ? 'is-active' : ''}
            title="Numbered List"
          >
            1.
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive('blockquote') ? 'is-active' : ''}
            title="Quote"
          >
            ❝
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive('codeBlock') ? 'is-active' : ''}
            title="Code Block"
          >
            {'{}'}
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button onClick={setLink} className={editor.isActive('link') ? 'is-active' : ''} title="Insert Link">
            🔗
          </button>
          <button onClick={addImage} title="Insert Image">
            🖼
          </button>
          <button
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            ―
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo (Ctrl+Y)"
          >
            ↷
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <EditorContent className="wysiwyg-content" editor={editor} />
    </div>
  );
};

export default WysiwygEditor;

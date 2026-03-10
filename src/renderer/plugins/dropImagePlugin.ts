/**
 * Milkdown Drop Image Plugin
 *
 * Handles drag-and-drop of image files from the filesystem into the editor.
 * Dropped images are imported into the media library, linked to the current
 * post, and inserted as markdown image nodes. AI analysis generates alt text,
 * title, and caption automatically.
 *
 * This plugin also handles paste events with image files (e.g. screenshots).
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

/** File extensions accepted for image drop/paste. */
export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
]);

/**
 * Returns true when every file in the list is a supported image type.
 * Returns false for empty lists.
 */
export function hasImageFiles(files: FileList | File[]): boolean {
  if (!files || files.length === 0) return false;
  return Array.from(files).every((f) => {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
  });
}

/**
 * Returns true when the drag event contains external files (from OS).
 * Internal editor drags (text, nodes) are ignored.
 */
function isDragWithFiles(event: DragEvent): boolean {
  return !!event.dataTransfer?.types?.includes('Files');
}

/**
 * Shared ref container so the PostEditor can set the postId and callbacks
 * that the plugin reads at event time.
 */
export interface DropImageContext {
  postId: string | null;
  onDropImport: ((postId: string, filePath: string) => Promise<{ mediaId: string; alt: string; relativePath: string } | null>) | null;
}

/** Module-level context ref updated by the PostEditor component. */
export const dropImageContext: DropImageContext = {
  postId: null,
  onDropImport: null,
};

const dropImagePluginKey = new PluginKey('dropImagePlugin');

/**
 * Insert a markdown image node at the given position (or cursor).
 */
function insertImageAtPos(view: EditorView, pos: number, src: string, alt: string): void {
  const { schema } = view.state;
  const imageType = schema.nodes.image;
  if (!imageType) return;

  const node = imageType.create({ src, alt, title: '' });
  const tr = view.state.tr.insert(pos, node);
  view.dispatch(tr);
}

/**
 * Process dropped / pasted image files: import each via IPC and insert into
 * the editor at the given document position.
 */
async function processImageFiles(view: EditorView, files: File[], pos: number): Promise<void> {
  const { postId, onDropImport } = dropImageContext;
  if (!postId || !onDropImport) return;

  for (const file of files) {
    // Electron exposes the native file path on the File object
    const filePath = (file as File & { path?: string }).path;
    if (!filePath) continue;

    const result = await onDropImport(postId, filePath);
    if (result) {
      insertImageAtPos(view, pos, result.relativePath, result.alt);
      // Shift position for subsequent images so they appear in order
      pos += 1;
    }
  }
}

/**
 * ProseMirror plugin that intercepts drag-and-drop and paste events
 * containing image files.
 */
export const dropImagePlugin = $prose(() => {
  return new Plugin({
    key: dropImagePluginKey,
    props: {
      handleDOMEvents: {
        dragover: (_view: EditorView, event: Event) => {
          const dragEvent = event as DragEvent;
          if (!isDragWithFiles(dragEvent)) return false;

          // Check for image files
          if (dragEvent.dataTransfer?.items) {
            const hasImages = Array.from(dragEvent.dataTransfer.items).some(
              (item) => item.kind === 'file' && item.type.startsWith('image/'),
            );
            if (hasImages) {
              dragEvent.preventDefault();
              // Add visual feedback class
              const editorEl = (event.target as HTMLElement).closest?.('.milkdown-content');
              editorEl?.classList.add('drop-target-active');
              return true;
            }
          }
          return false;
        },

        dragleave: (_view: EditorView, event: Event) => {
          const editorEl = (event.target as HTMLElement).closest?.('.milkdown-content');
          editorEl?.classList.remove('drop-target-active');
          return false;
        },

        drop: (view: EditorView, event: Event) => {
          const dragEvent = event as DragEvent;

          // Remove visual feedback
          const editorEl = (event.target as HTMLElement).closest?.('.milkdown-content');
          editorEl?.classList.remove('drop-target-active');

          if (!isDragWithFiles(dragEvent)) return false;

          const files = dragEvent.dataTransfer?.files;
          if (!files || files.length === 0) return false;
          if (!hasImageFiles(files)) return false;

          dragEvent.preventDefault();
          dragEvent.stopPropagation();

          // Determine drop position in the document
          const dropPos = view.posAtCoords({
            left: dragEvent.clientX,
            top: dragEvent.clientY,
          });
          const pos = dropPos ? dropPos.pos : view.state.selection.from;

          void processImageFiles(view, Array.from(files), pos);
          return true;
        },

        paste: (view: EditorView, event: Event) => {
          const clipboardEvent = event as ClipboardEvent;
          const files = clipboardEvent.clipboardData?.files;
          if (!files || files.length === 0) return false;
          if (!hasImageFiles(files)) return false;

          clipboardEvent.preventDefault();

          const pos = view.state.selection.from;
          void processImageFiles(view, Array.from(files), pos);
          return true;
        },
      },
    },
  });
});

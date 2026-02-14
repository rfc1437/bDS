/**
 * Milkdown Image Resolver Plugin
 * 
 * Resolves relative media paths (like media/2005/01/xxx.JPG) to bds-media:// 
 * protocol URLs at render time, so images display correctly in the Milkdown editor.
 * 
 * The underlying document model keeps the original relative paths, so saved
 * markdown files retain portable paths.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { NodeView, EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { useAppStore } from '../store';

/**
 * Resolves a relative media path to a bds-media:// URL
 * Matches images by:
 * 1. Media ID in the path (e.g., media/2025/01/{id}.jpg)
 * 2. Original filename
 * 3. Filename pattern
 */
function resolveImageSrc(src: string): string {
  // Skip if already using bds-media protocol or external URLs
  if (src.startsWith('bds-media://') || src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }

  // Get media list from store
  const media = useAppStore.getState().media;
  if (media.length === 0) {
    return src;
  }

  // Build lookup maps for efficient matching
  const byId = new Map<string, string>();
  const byOriginalName = new Map<string, string>();
  const byFilename = new Map<string, string>();

  for (const m of media) {
    byId.set(m.id, m.id);
    byOriginalName.set(m.originalName.toLowerCase(), m.id);
    byFilename.set(m.filename.toLowerCase(), m.id);
  }

  // Extract the filename from the path
  const filename = src.split('/').pop() || '';
  const filenameWithoutExt = filename.replace(/\.[^.]+$/, '');
  const filenameLower = filename.toLowerCase();

  // Try to match by:
  // 1. UUID in path (the file is named by ID)
  if (byId.has(filenameWithoutExt)) {
    return `bds-media://${filenameWithoutExt}`;
  }

  // 2. Filename lookup
  if (byFilename.has(filenameLower)) {
    return `bds-media://${byFilename.get(filenameLower)}`;
  }

  // 3. Original name lookup
  if (byOriginalName.has(filenameLower)) {
    return `bds-media://${byOriginalName.get(filenameLower)}`;
  }

  // No match found, return original
  return src;
}

/**
 * Custom node view for image nodes that resolves URLs at render time
 */
class ImageNodeView implements NodeView {
  dom: HTMLElement;
  img: HTMLImageElement;

  constructor(node: Node, _view: EditorView, _getPos: () => number | undefined) {
    // Create wrapper span
    this.dom = document.createElement('span');
    this.dom.className = 'milkdown-image-wrapper';
    
    // Create image element
    this.img = document.createElement('img');
    this.img.alt = node.attrs.alt || '';
    this.img.title = node.attrs.title || '';
    
    // Resolve the src URL
    const originalSrc = node.attrs.src || '';
    this.img.src = resolveImageSrc(originalSrc);
    
    // Store original src for debugging
    this.img.dataset.originalSrc = originalSrc;
    
    this.dom.appendChild(this.img);
  }

  update(node: Node): boolean {
    if (node.type.name !== 'image') {
      return false;
    }
    
    // Update image attributes
    this.img.alt = node.attrs.alt || '';
    this.img.title = node.attrs.title || '';
    
    const originalSrc = node.attrs.src || '';
    const resolvedSrc = resolveImageSrc(originalSrc);
    
    if (this.img.src !== resolvedSrc) {
      this.img.src = resolvedSrc;
      this.img.dataset.originalSrc = originalSrc;
    }
    
    return true;
  }

  destroy(): void {
    // Cleanup if needed
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/**
 * Plugin key for the image resolver plugin
 */
const imageResolverPluginKey = new PluginKey('imageResolverPlugin');

/**
 * ProseMirror plugin that provides custom image node views
 */
export const imageResolverPlugin = $prose(() => {
  return new Plugin({
    key: imageResolverPluginKey,
    props: {
      nodeViews: {
        image: (node, view, getPos) => new ImageNodeView(node, view, getPos),
      },
    },
  });
});

export default imageResolverPlugin;

/**
 * Gallery Macro
 * 
 * Renders an image gallery from linked media files for a post.
 * Uses the post-media linking system to display media attached to the current post.
 * Images are clickable to open in a lightbox.
 * 
 * Usage: 
 *   [[gallery]]                       - Shows all linked media for current post
 *   [[gallery columns="4"]]           - Custom column count
 *   [[gallery caption="My Photos"]]   - With caption
 * 
 * Parameters:
 * - columns: Number of columns (default: 3)
 * - caption: Gallery caption
 * - link: (deprecated, ignored) Accepted for backwards compatibility with old sites
 */

import { registerMacro } from '../registry';
import type { MacroDefinition, MacroParams, MacroRenderContext } from '../types';

const galleryMacro: MacroDefinition = {
  name: 'gallery',
  description: 'Renders an image gallery from linked media files with lightbox support',

  validate(params: MacroParams): string | undefined {
    if (params.columns) {
      const cols = parseInt(params.columns, 10);
      if (isNaN(cols) || cols < 1 || cols > 6) {
        return 'Gallery columns must be a number between 1 and 6';
      }
    }
    return undefined;
  },

  editorPreview(params: MacroParams): string {
    const cols = params.columns || '3';
    return `📷 Gallery (${cols} cols)`;
  },

  render(params: MacroParams, context: MacroRenderContext): string {
    const { columns = '3', caption } = params;
    const colCount = parseInt(columns, 10) || 3;
    
    // Build the gallery HTML with lightbox support
    const classes = ['macro-gallery', `gallery-cols-${colCount}`];
    
    // Data attributes for hydration - JS will load linked media and populate
    const dataAttrs = [
      `data-columns="${colCount}"`,
      `data-lightbox="true"`,
    ];
    if (context.postId) {
      dataAttrs.push(`data-post-id="${context.postId}"`);
    }
    
    let html = `<div class="${classes.join(' ')}" ${dataAttrs.join(' ')}>`;
    
    // Gallery container that will be populated by hydration script
    // The hydration script uses: window.electronAPI.postMedia.getMediaDataForPost(postId)
    // and renders images with bds-media:// protocol
    html += `<div class="gallery-container gallery-lightbox">`;
    html += `<div class="gallery-loading">Loading gallery...</div>`;
    html += `</div>`;
    
    if (caption) {
      html += `<figcaption class="gallery-caption">${caption}</figcaption>`;
    }
    
    html += `</div>`;
    return html;
  },
};

// Self-register
registerMacro(galleryMacro);

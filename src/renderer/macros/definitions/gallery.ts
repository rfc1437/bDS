/**
 * Gallery Macro
 * 
 * Renders an image gallery from a linked media file or folder.
 * 
 * Usage: [[gallery link="media/photos" columns="3" caption="My Photos"]]
 * 
 * Parameters:
 * - link (required): Path to media file or folder
 * - columns: Number of columns (default: 3)
 * - caption: Gallery caption
 */

import { registerMacro } from '../registry';
import type { MacroDefinition, MacroParams, MacroRenderContext } from '../types';

const galleryMacro: MacroDefinition = {
  name: 'gallery',
  description: 'Renders an image gallery from linked media',

  validate(params: MacroParams): string | undefined {
    if (!params.link) {
      return 'Gallery macro requires a "link" parameter';
    }
    if (params.columns) {
      const cols = parseInt(params.columns, 10);
      if (isNaN(cols) || cols < 1 || cols > 6) {
        return 'Gallery columns must be a number between 1 and 6';
      }
    }
    return undefined;
  },

  editorPreview(params: MacroParams): string {
    const link = params.link || '?';
    return `📷 Gallery: ${link}`;
  },

  render(params: MacroParams, context: MacroRenderContext): string {
    const { link, columns = '3', caption } = params;
    const colCount = parseInt(columns, 10) || 3;
    
    // Build the gallery HTML
    const classes = ['macro-gallery', `gallery-cols-${colCount}`];
    if (context.isPreview) {
      classes.push('gallery-preview');
    }
    
    let html = `<div class="${classes.join(' ')}" data-link="${link}">`;
    
    // In preview mode, show a placeholder
    // In production, this would load actual images
    if (context.isPreview) {
      html += `<div class="gallery-placeholder">`;
      html += `<span class="gallery-icon">🖼️</span>`;
      html += `<span class="gallery-info">Gallery: ${link}</span>`;
      if (caption) {
        html += `<span class="gallery-caption">${caption}</span>`;
      }
      html += `</div>`;
    } else {
      // Production render would load images here
      // For now, create a placeholder that frontend JS can hydrate
      html += `<div class="gallery-container" data-columns="${colCount}">`;
      html += `<!-- Gallery images loaded dynamically from: ${link} -->`;
      html += `</div>`;
      if (caption) {
        html += `<figcaption class="gallery-caption">${caption}</figcaption>`;
      }
    }
    
    html += `</div>`;
    return html;
  },
};

// Self-register
registerMacro(galleryMacro);

export default galleryMacro;

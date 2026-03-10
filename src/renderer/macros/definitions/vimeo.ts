/**
 * Vimeo Macro
 * 
 * Embeds a Vimeo video player.
 * 
 * Usage: [[vimeo id=12155835]]
 * 
 * Parameters:
 * - id (required): Vimeo video ID
 * - title: Accessible title for the iframe
 */

import { registerMacro } from '../registry';
import type { MacroDefinition, MacroParams, MacroRenderContext } from '../types';

const vimeoMacro: MacroDefinition = {
  name: 'vimeo',
  description: 'Embeds a Vimeo video player',

  validate(params: MacroParams): string | undefined {
    if (!params.id) {
      return 'Vimeo macro requires an "id" parameter (the video ID)';
    }
    // Vimeo IDs are numeric
    if (!/^\d+$/.test(params.id)) {
      return 'Invalid Vimeo video ID format (should be numeric)';
    }
    return undefined;
  },

  editorPreview(params: MacroParams): string {
    const id = params.id || '?';
    const title = params.title;
    return title ? `▶ Vimeo: ${title}` : `▶ Vimeo: ${id}`;
  },

  render(params: MacroParams, context: MacroRenderContext): string {
    const { id, title = 'Vimeo video' } = params;
    
    const embedUrl = `https://player.vimeo.com/video/${id}`;
    
    if (context.isPreview) {
      // In preview, show a placeholder with Vimeo branding
      return `
        <div class="macro-vimeo vimeo-preview">
          <div class="vimeo-thumbnail">
            <div class="vimeo-play-overlay">
              <span class="vimeo-play-button">▶</span>
            </div>
            <span class="vimeo-title">${title} (Vimeo: ${id})</span>
          </div>
        </div>
      `;
    }
    
    // Production render - full iframe embed
    return `
      <div class="macro-vimeo">
        <div class="vimeo-container">
          <iframe 
            src="${embedUrl}"
            title="${title}"
            frameborder="0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    `;
  },
};

// Self-register
registerMacro(vimeoMacro);

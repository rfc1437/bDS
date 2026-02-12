/**
 * YouTube Macro
 * 
 * Embeds a YouTube video player.
 * 
 * Usage: [[youtube id="dQw4w9WgXcQ" title="Video Title"]]
 * 
 * Parameters:
 * - id (required): YouTube video ID
 * - title: Accessible title for the iframe
 * - start: Start time in seconds
 * - autoplay: Whether to autoplay (default: false)
 */

import { registerMacro } from '../registry';
import type { MacroDefinition, MacroParams, MacroRenderContext } from '../types';

const youtubeMacro: MacroDefinition = {
  name: 'youtube',
  description: 'Embeds a YouTube video player',

  validate(params: MacroParams): string | undefined {
    if (!params.id) {
      return 'YouTube macro requires an "id" parameter (the video ID)';
    }
    // Basic validation of YouTube ID format
    if (!/^[\w-]{11}$/.test(params.id)) {
      return 'Invalid YouTube video ID format';
    }
    return undefined;
  },

  editorPreview(params: MacroParams): string {
    const id = params.id || '?';
    const title = params.title;
    return title ? `▶ YouTube: ${title}` : `▶ YouTube: ${id}`;
  },

  render(params: MacroParams, context: MacroRenderContext): string {
    const { id, title = 'YouTube video', start, autoplay } = params;
    
    // Build embed URL with parameters
    const embedParams = new URLSearchParams();
    if (start) {
      embedParams.set('start', start);
    }
    if (autoplay === 'true') {
      embedParams.set('autoplay', '1');
    }
    embedParams.set('rel', '0'); // Don't show related videos
    
    const queryString = embedParams.toString();
    const embedUrl = `https://www.youtube.com/embed/${id}${queryString ? '?' + queryString : ''}`;
    
    if (context.isPreview) {
      // In preview, show thumbnail with play button overlay
      return `
        <div class="macro-youtube youtube-preview">
          <div class="youtube-thumbnail" style="background-image: url('https://img.youtube.com/vi/${id}/maxresdefault.jpg')">
            <div class="youtube-play-overlay">
              <span class="youtube-play-button">▶</span>
            </div>
            <span class="youtube-title">${title}</span>
          </div>
        </div>
      `;
    }
    
    // Production render - full iframe embed
    return `
      <div class="macro-youtube">
        <div class="youtube-container">
          <iframe 
            src="${embedUrl}"
            title="${title}"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>
        </div>
      </div>
    `;
  },
};

// Self-register
registerMacro(youtubeMacro);

export default youtubeMacro;

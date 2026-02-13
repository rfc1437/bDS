/**
 * Photo Archive Macro
 * 
 * Creates a photo gallery organized by year and month.
 * Images are discovered dynamically from the media library based on their creation date.
 * When rendered, images are automatically linked to the post.
 * 
 * Usage:
 *   [[photo_archive year="2024"]]           - All months of 2024, each in its own lightbox
 *   [[photo_archive year="2024" month="6"]] - Only June 2024 photos
 * 
 * Parameters:
 * - year (required): The year to display photos from (e.g., 2024)
 * - month (optional): Specific month (1-12). If omitted, shows all months with photos.
 * 
 * Gallery Layout:
 * - Each month is in its own lightbox with the month name rotated 90° on the side
 * - Images are displayed in a grid and are clickable for lightbox viewing
 */

import { registerMacro } from '../registry';
import type { MacroDefinition, MacroParams, MacroRenderContext } from '../types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Get the full month name from a 1-based month number
 */
function getMonthName(month: number): string {
  return MONTH_NAMES[month - 1] || 'Unknown';
}

const photoArchiveMacro: MacroDefinition = {
  name: 'photo_archive',
  description: 'Creates a photo archive gallery organized by year and month, automatically linking discovered images to the post',

  validate(params: MacroParams): string | undefined {
    // Year is required
    if (!params.year) {
      return 'photo_archive macro requires a "year" parameter';
    }

    const year = parseInt(params.year, 10);
    if (isNaN(year) || year < 1000 || year > 9999) {
      return 'Year must be a valid 4-digit year (e.g., 2024)';
    }

    // Month is optional but must be valid if provided
    if (params.month) {
      const month = parseInt(params.month, 10);
      if (isNaN(month) || month < 1 || month > 12) {
        return 'Month must be a number between 1 and 12';
      }
    }

    return undefined;
  },

  editorPreview(params: MacroParams): string {
    const year = params.year || '????';
    if (params.month) {
      const monthNum = parseInt(params.month, 10);
      const monthName = getMonthName(monthNum);
      return `📅 Photo Archive: ${monthName} ${year}`;
    }
    return `📅 Photo Archive: ${year}`;
  },

  render(params: MacroParams, context: MacroRenderContext): string {
    const { year, month } = params;
    
    // Build data attributes for hydration
    const dataAttrs = [
      `data-year="${year}"`,
    ];
    
    if (month) {
      dataAttrs.push(`data-month="${month}"`);
    }
    
    if (context.postId) {
      dataAttrs.push(`data-post-id="${context.postId}"`);
    }

    // CSS classes
    const classes = ['macro-photo-archive'];
    if (month) {
      classes.push('photo-archive-single-month');
    } else {
      classes.push('photo-archive-full-year');
    }

    // Generate placeholder HTML - actual content is hydrated by Editor.tsx
    let html = `<div class="${classes.join(' ')}" ${dataAttrs.join(' ')}>`;
    html += `<div class="photo-archive-container">`;
    html += `<div class="photo-archive-loading">Loading photo archive for ${year}${month ? ` / ${getMonthName(parseInt(month, 10))}` : ''}...</div>`;
    html += `</div>`;
    html += `</div>`;

    return html;
  },
};

// Self-register
registerMacro(photoArchiveMacro);

export default photoArchiveMacro;
export { getMonthName, MONTH_NAMES };

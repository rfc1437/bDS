/**
 * Photo Archive Macro
 * 
 * Creates a photo gallery organized by year and month.
 * Images are discovered dynamically from the media library based on their creation date.
 * 
 * Usage:
 *   [[photo_archive]]                       - Newest 10 months with images (month + year label)
 *   [[photo_archive year="2024"]]           - All months of 2024, each in its own lightbox
 *   [[photo_archive year="2024" month="6"]] - Only June 2024 photos
 * 
 * Parameters:
 * - year (optional): The year to display photos from (e.g., 2024)
 * - month (optional): Specific month (1-12). Requires year. If omitted with year, shows all months.
 * 
 * Gallery Layout:
 * - Each month is in its own lightbox with the month name rotated 90° on the side
 * - When no year specified, shows "Month Year" label (e.g., "January 2024")
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
  description: 'Creates a photo archive gallery organized by year and month',

  validate(params: MacroParams): string | undefined {
    // Year is optional - if not provided, shows recent 10 months
    if (params.year) {
      const year = parseInt(params.year, 10);
      if (isNaN(year) || year < 1000 || year > 9999) {
        return 'Year must be a valid 4-digit year (e.g., 2024)';
      }
    }

    // Month is optional but must be valid if provided, and requires year
    if (params.month) {
      if (!params.year) {
        return 'Month parameter requires a year parameter';
      }
      const month = parseInt(params.month, 10);
      if (isNaN(month) || month < 1 || month > 12) {
        return 'Month must be a number between 1 and 12';
      }
    }

    return undefined;
  },

  editorPreview(params: MacroParams): string {
    // No year = recent mode
    if (!params.year) {
      return '📅 Photo Archive: Recent';
    }
    const year = params.year;
    if (params.month) {
      const monthNum = parseInt(params.month, 10);
      const monthName = getMonthName(monthNum);
      return `📅 Photo Archive: ${monthName} ${year}`;
    }
    return `📅 Photo Archive: ${year}`;
  },

  render(params: MacroParams, _context: MacroRenderContext): string {
    const { year, month } = params;
    
    // Build data attributes for hydration
    const dataAttrs: string[] = [];
    
    // If no year, use recent mode (newest 10 months with images)
    if (!year) {
      dataAttrs.push('data-recent="10"');
    } else {
      dataAttrs.push(`data-year="${year}"`);
      if (month) {
        dataAttrs.push(`data-month="${month}"`);
      }
    }
    
    // CSS classes
    const classes = ['macro-photo-archive'];
    if (!year) {
      classes.push('photo-archive-recent-months');
    } else if (month) {
      classes.push('photo-archive-single-month');
    } else {
      classes.push('photo-archive-full-year');
    }

    // Generate placeholder HTML - actual content is hydrated by Editor.tsx
    let html = `<div class="${classes.join(' ')}" ${dataAttrs.join(' ')}>`;
    html += `<div class="photo-archive-container">`;
    
    // Loading message based on mode
    let loadingMsg: string;
    if (!year) {
      loadingMsg = 'Loading recent photos...';
    } else if (month) {
      loadingMsg = `Loading photo archive for ${year} / ${getMonthName(parseInt(month, 10))}...`;
    } else {
      loadingMsg = `Loading photo archive for ${year}...`;
    }
    html += `<div class="photo-archive-loading">${loadingMsg}</div>`;
    html += `</div>`;
    html += `</div>`;

    return html;
  },
};

// Self-register
registerMacro(photoArchiveMacro);

export default photoArchiveMacro;
export { getMonthName, MONTH_NAMES };

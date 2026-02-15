/**
 * Shared Macro Configuration
 * 
 * This file defines the macro validation rules that can be used by both
 * renderer and main process (e.g., for import analysis validation).
 * 
 * The full macro implementations (with render functions) live in:
 * src/renderer/macros/definitions/
 */

export interface MacroConfig {
  /** The macro name (lowercase) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Required parameters that must be present */
  requiredParams?: string[];
  /** Optional parameter validation function */
  validate?: (params: Record<string, string>) => string | undefined;
}

/**
 * Registry of known macro configurations.
 * Add new macros here to enable validation during import analysis.
 */
export const macroConfigs: MacroConfig[] = [
  {
    name: 'youtube',
    description: 'Embeds a YouTube video player',
    requiredParams: ['id'],
    validate: (params) => {
      if (!params.id) {
        return 'YouTube macro requires an "id" parameter (the video ID)';
      }
      // Basic validation of YouTube ID format (11 characters)
      if (!/^[\w-]{11}$/.test(params.id)) {
        return 'Invalid YouTube video ID format';
      }
      return undefined;
    },
  },
  {
    name: 'vimeo',
    description: 'Embeds a Vimeo video player',
    requiredParams: ['id'],
    validate: (params) => {
      if (!params.id) {
        return 'Vimeo macro requires an "id" parameter (the video ID)';
      }
      // Vimeo IDs are numeric
      if (!/^\d+$/.test(params.id)) {
        return 'Invalid Vimeo video ID format (should be numeric)';
      }
      return undefined;
    },
  },
  {
    name: 'gallery',
    description: 'Renders an image gallery from linked media files',
    validate: (params) => {
      if (params.columns) {
        const cols = parseInt(params.columns, 10);
        if (isNaN(cols) || cols < 1 || cols > 6) {
          return 'Gallery columns must be a number between 1 and 6';
        }
      }
      // 'link' parameter is accepted for backwards compatibility but ignored
      return undefined;
    },
  },
  {
    name: 'photo_archive',
    description: 'Creates a photo archive gallery organized by year and month, or shows recent months',
    validate: (params) => {
      // Year is optional - if not provided, shows recent 10 months
      if (params.year) {
        const year = parseInt(params.year, 10);
        if (isNaN(year) || year < 1000 || year > 9999) {
          return 'Year must be a valid 4-digit year (e.g., 2024)';
        }
      }
      // Month requires year
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
  },
];

/**
 * Get a map of macro configs by name for quick lookup.
 */
export function getMacroConfigMap(): Map<string, MacroConfig> {
  const map = new Map<string, MacroConfig>();
  for (const config of macroConfigs) {
    map.set(config.name.toLowerCase(), config);
  }
  return map;
}

/**
 * Validate macro parameters against known configurations.
 * 
 * @param macroName - The macro name
 * @param params - The macro parameters
 * @returns Error message if invalid, undefined if valid or macro is unknown
 */
export function validateMacroParams(
  macroName: string,
  params: Record<string, string>
): { valid: boolean; error?: string; known: boolean } {
  const config = getMacroConfigMap().get(macroName.toLowerCase());
  
  if (!config) {
    return { valid: false, known: false };
  }
  
  // Check required parameters
  if (config.requiredParams) {
    for (const param of config.requiredParams) {
      if (!params[param]) {
        return { 
          valid: false, 
          known: true, 
          error: `Missing required parameter: ${param}` 
        };
      }
    }
  }
  
  // Run custom validation if provided
  if (config.validate) {
    const error = config.validate(params);
    if (error) {
      return { valid: false, known: true, error };
    }
  }
  
  return { valid: true, known: true };
}

export const PICO_THEME_NAMES = [
  'amber',
  'blue',
  'cyan',
  'fuchsia',
  'green',
  'grey',
  'indigo',
  'jade',
  'lime',
  'orange',
  'pink',
  'pumpkin',
  'purple',
  'red',
  'sand',
  'slate',
  'violet',
  'yellow',
  'zinc',
] as const;

export type PicoThemeName = (typeof PICO_THEME_NAMES)[number];
export type PicoThemeMode = 'auto' | 'light' | 'dark';

function isPicoThemeName(value: unknown): value is PicoThemeName {
  return typeof value === 'string' && (PICO_THEME_NAMES as readonly string[]).includes(value);
}

export function sanitizePicoTheme(value: unknown): PicoThemeName | undefined {
  return isPicoThemeName(value) ? value : undefined;
}

export function sanitizePicoThemeMode(value: unknown): PicoThemeMode | undefined {
  if (value === 'auto' || value === 'light' || value === 'dark') {
    return value;
  }
  return undefined;
}

function getPicoStylesheetAssetName(theme: PicoThemeName | undefined): string {
  if (!theme) {
    return 'pico.min.css';
  }
  return `pico.${theme}.min.css`;
}

export function getPicoStylesheetHref(theme: PicoThemeName | undefined): string {
  return `/assets/${getPicoStylesheetAssetName(theme)}`;
}

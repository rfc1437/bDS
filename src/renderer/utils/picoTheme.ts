import { PICO_THEME_NAMES, sanitizePicoTheme, type PicoThemeName } from '../../main/shared/picoThemes';

export { PICO_THEME_NAMES, type PicoThemeName };

export interface PicoThemePreviewToken {
  lightBackground: string;
  darkBackground: string;
  lightPrimary: string;
  darkPrimary: string;
}

export const PICO_THEME_PREVIEW_TOKENS: Record<PicoThemeName, PicoThemePreviewToken> = {
  amber: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#876400', darkPrimary: '#c79400' },
  blue: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#2060df', darkPrimary: '#8999f9' },
  cyan: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#047878', darkPrimary: '#0ab1b1' },
  fuchsia: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#c1208b', darkPrimary: '#f869bf' },
  green: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#33790f', darkPrimary: '#4eb31b' },
  grey: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#6a6a6a', darkPrimary: '#9e9e9e' },
  indigo: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#655cd6', darkPrimary: '#a294e5' },
  jade: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#007a50', darkPrimary: '#00b478' },
  lime: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#577400', darkPrimary: '#82ab00' },
  orange: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#bd3c13', darkPrimary: '#f56b3d' },
  pink: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#c72259', darkPrimary: '#f7708e' },
  pumpkin: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#9c5900', darkPrimary: '#e48500' },
  purple: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#aa40bf', darkPrimary: '#d47de4' },
  red: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#c52f21', darkPrimary: '#f17961' },
  sand: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#6e6a60', darkPrimary: '#a39e8f' },
  slate: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#5d6b89', darkPrimary: '#909ebe' },
  violet: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#8352c5', darkPrimary: '#b290d9' },
  yellow: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#756b00', darkPrimary: '#ad9f00' },
  zinc: { lightBackground: '#fff', darkBackground: 'rgb(19, 22.5, 30.5)', lightPrimary: '#646b79', darkPrimary: '#969eaf' },
};

const themeStylesheetLoaders: Record<PicoThemeName, () => Promise<unknown>> = {
  amber: () => import('@picocss/pico/css/pico.conditional.amber.min.css'),
  blue: () => import('@picocss/pico/css/pico.conditional.blue.min.css'),
  cyan: () => import('@picocss/pico/css/pico.conditional.cyan.min.css'),
  fuchsia: () => import('@picocss/pico/css/pico.conditional.fuchsia.min.css'),
  green: () => import('@picocss/pico/css/pico.conditional.green.min.css'),
  grey: () => import('@picocss/pico/css/pico.conditional.grey.min.css'),
  indigo: () => import('@picocss/pico/css/pico.conditional.indigo.min.css'),
  jade: () => import('@picocss/pico/css/pico.conditional.jade.min.css'),
  lime: () => import('@picocss/pico/css/pico.conditional.lime.min.css'),
  orange: () => import('@picocss/pico/css/pico.conditional.orange.min.css'),
  pink: () => import('@picocss/pico/css/pico.conditional.pink.min.css'),
  pumpkin: () => import('@picocss/pico/css/pico.conditional.pumpkin.min.css'),
  purple: () => import('@picocss/pico/css/pico.conditional.purple.min.css'),
  red: () => import('@picocss/pico/css/pico.conditional.red.min.css'),
  sand: () => import('@picocss/pico/css/pico.conditional.sand.min.css'),
  slate: () => import('@picocss/pico/css/pico.conditional.slate.min.css'),
  violet: () => import('@picocss/pico/css/pico.conditional.violet.min.css'),
  yellow: () => import('@picocss/pico/css/pico.conditional.yellow.min.css'),
  zinc: () => import('@picocss/pico/css/pico.conditional.zinc.min.css'),
};

const loadedThemes = new Set<PicoThemeName>();

export function getRendererPicoTheme(theme: unknown): PicoThemeName {
  return sanitizePicoTheme(theme) ?? 'slate';
}

export async function ensureRendererPicoThemeStylesheet(theme: PicoThemeName): Promise<void> {
  if (loadedThemes.has(theme)) {
    return;
  }

  const loader = themeStylesheetLoaders[theme];
  await loader();
  loadedThemes.add(theme);
}

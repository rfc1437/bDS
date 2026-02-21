import tsParser from '@typescript-eslint/parser';
import tsEslintPlugin from '@typescript-eslint/eslint-plugin';
import i18next from 'eslint-plugin-i18next';

export default [
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'drizzle/**',
      'node_modules/**',
    ],
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tsEslintPlugin,
      i18next,
    },
    rules: {
      'i18next/no-literal-string': ['error', {
        mode: 'jsx-text-only',
        'jsx-components': {
          exclude: ['Trans'],
        },
        'jsx-attributes': {
          exclude: [
            'className',
            'styleName',
            'style',
            'type',
            'key',
            'id',
            'width',
            'height',
            'viewBox',
            'd',
            'fill',
            'stroke',
            'xmlns',
            'data-testid',
            'role',
            'tabIndex',
            'aria-hidden',
            'mode',
            'theme',
            'lineNumbers',
            'cursorStyle',
            'cursorBlinking',
            'value',
          ],
        },
        callees: {
          exclude: [
            'i18n(ext)?',
            't',
            'tr',
            'require',
            'addEventListener',
            'removeEventListener',
            'postMessage',
            'getElementById',
            'dispatch',
            'commit',
            'includes',
            'indexOf',
            'endsWith',
            'startsWith',
          ],
        },
        words: {
          exclude: [
            '[0-9!-/:-@[-`{-~]+',
            '[A-Z_-]+',
            /^\p{Emoji}+$/u,
            /^[\s\p{Emoji}\uFE0F]+$/u,
            /^[\s0-9%—()\-+.]+$/,
            /^[\s+×•○●⊘→←↶↷―✕✖✔❝]+$/,
            /^H[1-6]$/,
            /^(DB\s*→\s*File|File\s*→\s*DB)$/,
            /^\/posts\/$/,
            'bDS',
            '[✓✗▼▶◀▲]+'
          ],
        },
        message: 'i18n literal string',
      }],
    },
  },
];

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('Phase 1 i18n hardcoded literals', () => {
  it('does not keep known hardcoded user-facing literals in renderer components', () => {
    const checks: Array<{ file: string; literals: string[] }> = [
      {
        file: 'src/renderer/components/PostSearchModal/PostSearchModal.tsx',
        literals: [
          'Search posts by title or content...',
          'Searching...',
          'Type at least 2 characters to search',
          'Use ↑↓ to navigate, Enter to select, Esc to close',
        ],
      },
      {
        file: 'src/renderer/components/StatusBar/StatusBar.tsx',
        literals: ['<span>{totalPosts} posts</span>', '<span>{media.length} media</span>', 'Theme: {activeTheme}', 'aria-label="UI language"'],
      },
      {
        file: 'src/renderer/components/WindowTitleBar/WindowTitleBar.tsx',
        literals: ['Toggle Sidebar', 'Toggle Panel'],
      },
      {
        file: 'src/renderer/components/Sidebar/Sidebar.tsx',
        literals: ['AI ASSISTANT', 'IMPORTS', 'No conversations yet', 'Create an import definition'],
      },
      {
        file: 'src/renderer/components/TagInput/TagInput.tsx',
        literals: ['Tag already added', 'Create {mode === \'category\' ? \'category\' : \'tag\'} "{inputValue.trim()}"'],
      },
      {
        file: 'src/renderer/components/Editor/Editor.tsx',
        literals: ['Save Failed', 'Post published', 'Media not found', 'title="Quick Actions"'],
      },
      {
        file: 'src/renderer/components/ImportAnalysisView/ImportAnalysisView.tsx',
        literals: ['Loading import definition...', 'Import name...', 'Select & Analyze', 'Import completed successfully!'],
      },
    ];

    for (const check of checks) {
      const source = read(check.file);
      for (const literal of check.literals) {
        expect(source).not.toContain(literal);
      }
    }
  });
});

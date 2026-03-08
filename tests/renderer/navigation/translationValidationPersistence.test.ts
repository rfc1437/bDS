import { describe, expect, it } from 'vitest';
import type { TranslationValidationReport } from '../../../src/main/shared/electronApi';
import {
  getPersistedTranslationValidationReport,
  persistTranslationValidationReport,
} from '../../../src/renderer/navigation/translationValidationPersistence';

const report: TranslationValidationReport = {
  checkedDatabaseRowCount: 2,
  checkedFilesystemFileCount: 3,
  invalidDatabaseRows: [
    {
      issue: 'same-language-as-canonical',
      translationId: 'translation-1',
      translationFor: 'post-1',
      canonicalLanguage: 'de',
      translationLanguage: 'de',
      title: 'Hallo Welt',
    },
  ],
  invalidFilesystemFiles: [
    {
      issue: 'missing-source-post',
      translationFor: 'missing-post',
      translationLanguage: 'it',
      filePath: '/tmp/project/posts/orphan.it.md',
      title: 'Ciao',
    },
  ],
};

describe('translationValidationPersistence', () => {
  it('persists and loads translation validation report by project', () => {
    persistTranslationValidationReport('project-1', report);

    expect(getPersistedTranslationValidationReport('project-1')).toEqual(report);
  });

  it('returns null when project has no persisted report', () => {
    expect(getPersistedTranslationValidationReport('missing-project')).toBeNull();
  });
});
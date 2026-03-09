import type { TranslationValidationReport } from '../../main/shared/electronApi';

const TRANSLATION_VALIDATION_REPORT_PREFIX = 'bds-translation-validation-report';

function buildStorageKey(projectId: string): string {
  return `${TRANSLATION_VALIDATION_REPORT_PREFIX}:${projectId}`;
}

export function persistTranslationValidationReport(projectId: string, report: TranslationValidationReport): void {
  localStorage.setItem(buildStorageKey(projectId), JSON.stringify(report));
}

export function getPersistedTranslationValidationReport(projectId: string): TranslationValidationReport | null {
  const raw = localStorage.getItem(buildStorageKey(projectId));
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as TranslationValidationReport;
  } catch {
    return null;
  }
}
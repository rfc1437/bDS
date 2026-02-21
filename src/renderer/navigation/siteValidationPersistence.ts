import type { SiteValidationReport } from '../../main/shared/electronApi';

const SITE_VALIDATION_REPORT_PREFIX = 'bds-site-validation-report';

function getStorageKey(projectId: string): string {
  return `${SITE_VALIDATION_REPORT_PREFIX}:${projectId}`;
}

export function persistSiteValidationReport(projectId: string, report: SiteValidationReport): void {
  try {
    localStorage.setItem(getStorageKey(projectId), JSON.stringify(report));
  } catch {
    // Ignore persistence failures.
  }
}

export function getPersistedSiteValidationReport(projectId: string): SiteValidationReport | null {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SiteValidationReport;
  } catch {
    return null;
  }
}

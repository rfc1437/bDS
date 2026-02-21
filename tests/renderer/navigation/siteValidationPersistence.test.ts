import { describe, expect, it } from 'vitest';
import type { SiteValidationReport } from '../../../src/main/shared/electronApi';
import {
  getPersistedSiteValidationReport,
  persistSiteValidationReport,
} from '../../../src/renderer/navigation/siteValidationPersistence';

const report: SiteValidationReport = {
  sitemapPath: '/tmp/sitemap.xml',
  sitemapChanged: false,
  missingUrlPaths: ['/foo'],
  extraUrlPaths: ['/bar'],
  expectedUrlCount: 10,
  existingHtmlUrlCount: 9,
};

describe('siteValidationPersistence', () => {
  it('persists and loads site validation report by project', () => {
    persistSiteValidationReport('project-1', report);

    expect(getPersistedSiteValidationReport('project-1')).toEqual(report);
  });

  it('returns null when project has no persisted report', () => {
    expect(getPersistedSiteValidationReport('missing-project')).toBeNull();
  });
});

import React, { useEffect, useMemo, useState } from 'react';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import './SiteValidationView.css';

type SiteValidationReport = {
  sitemapPath: string;
  sitemapChanged: boolean;
  missingUrlPaths: string[];
  extraUrlPaths: string[];
  expectedUrlCount: number;
  existingHtmlUrlCount: number;
};

type SiteValidationApplyResult = {
  renderedUrlCount: number;
  deletedUrlCount: number;
  removedEmptyDirCount: number;
};

export const SiteValidationView: React.FC = () => {
  const { t: tr } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [report, setReport] = useState<SiteValidationReport | null>(null);

  const loadReport = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.blog.validateSite();
      setReport(result as SiteValidationReport);
    } catch (error) {
      console.error('Site validation failed:', error);
      showToast.error(tr('siteValidation.error.validate'));
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, []);

  const canApply = useMemo(() => {
    if (!report) return false;
    return report.missingUrlPaths.length > 0 || report.extraUrlPaths.length > 0;
  }, [report]);

  const handleApply = async () => {
    if (!report || !canApply) {
      return;
    }

    setIsApplying(true);
    try {
      const result = await window.electronAPI.blog.applyValidation(report) as SiteValidationApplyResult;
      showToast.success(tr('siteValidation.toast.applySuccess', {
        rendered: result.renderedUrlCount,
        deleted: result.deletedUrlCount,
      }));
      await loadReport();
    } catch (error) {
      console.error('Applying site validation failed:', error);
      showToast.error(tr('siteValidation.error.apply'));
    } finally {
      setIsApplying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="site-validation-view">
        <p className="site-validation-status">{tr('siteValidation.loading')}</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="site-validation-view">
        <p className="site-validation-status">{tr('siteValidation.error.validate')}</p>
      </div>
    );
  }

  return (
    <div className="site-validation-view">
      <div className="site-validation-summary">
        <h2>{tr('siteValidation.title')}</h2>
        <p>{tr('siteValidation.summary', {
          expected: report.expectedUrlCount,
          existing: report.existingHtmlUrlCount,
          missing: report.missingUrlPaths.length,
          extra: report.extraUrlPaths.length,
        })}</p>
      </div>

      <section className="site-validation-section">
        <h3>{tr('siteValidation.missingTitle')}</h3>
        {report.missingUrlPaths.length === 0 ? (
          <p className="site-validation-empty">{tr('siteValidation.noneMissing')}</p>
        ) : (
          <ul className="site-validation-list site-validation-list-missing">
            {report.missingUrlPaths.map((urlPath) => (
              <li key={`missing:${urlPath}`}>{urlPath}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="site-validation-section">
        <h3>{tr('siteValidation.extraTitle')}</h3>
        {report.extraUrlPaths.length === 0 ? (
          <p className="site-validation-empty">{tr('siteValidation.noneExtra')}</p>
        ) : (
          <ul className="site-validation-list site-validation-list-extra">
            {report.extraUrlPaths.map((urlPath) => (
              <li key={`extra:${urlPath}`}>{urlPath}</li>
            ))}
          </ul>
        )}
      </section>

      <div className="site-validation-actions">
        <button
          type="button"
          className="site-validation-apply"
          onClick={handleApply}
          disabled={!canApply || isApplying}
        >
          {isApplying ? tr('siteValidation.applying') : tr('siteValidation.apply')}
        </button>
      </div>
    </div>
  );
};

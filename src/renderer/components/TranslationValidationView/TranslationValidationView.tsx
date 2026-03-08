import React, { useEffect, useMemo, useState } from 'react';
import type { TranslationValidationIssue, TranslationValidationReport, TranslationValidationFixResult } from '../../../main/shared/electronApi';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import { getPersistedTranslationValidationReport, persistTranslationValidationReport } from '../../navigation/translationValidationPersistence';
import './TranslationValidationView.css';

function getIssueLabel(
  issue: TranslationValidationIssue['issue'],
  tr: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (issue === 'same-language-as-canonical') {
    return tr('translationValidation.issue.sameLanguage');
  }

  return tr('translationValidation.issue.missingSource');
}

function ValidationIssueCard({
  issue,
  kind,
}: {
  issue: TranslationValidationIssue;
  kind: 'db' | 'file';
}): React.JSX.Element {
  const { t: tr } = useI18n();

  return (
    <article className={`translation-validation-card translation-validation-card-${kind}`}>
      <p className="translation-validation-card-title">{getIssueLabel(issue.issue, tr)}</p>
      <dl className="translation-validation-card-meta">
        <dt>{tr('translationValidation.field.translationFor')}</dt>
        <dd>{issue.translationFor}</dd>
        {issue.translationId ? (
          <>
            <dt>{tr('translationValidation.field.translationId')}</dt>
            <dd>{issue.translationId}</dd>
          </>
        ) : null}
        {issue.title ? (
          <>
            <dt>{tr('translationValidation.field.title')}</dt>
            <dd>{issue.title}</dd>
          </>
        ) : null}
        <dt>{tr('translationValidation.field.languages')}</dt>
        <dd>
          {issue.canonicalLanguage
            ? tr('translationValidation.languagesWithCanonical', {
              canonical: issue.canonicalLanguage,
              translation: issue.translationLanguage,
            })
            : issue.translationLanguage}
        </dd>
        {issue.filePath ? (
          <>
            <dt>{tr('translationValidation.field.filePath')}</dt>
            <dd>{issue.filePath}</dd>
          </>
        ) : null}
      </dl>
    </article>
  );
}

export const TranslationValidationView: React.FC = () => {
  const { t: tr } = useI18n();
  const { activeProject } = useAppStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [report, setReport] = useState<TranslationValidationReport | null>(null);

  const loadPersistedReport = () => {
    setIsLoading(true);
    try {
      const projectId = activeProject?.id;
      if (!projectId) {
        setReport(null);
        return;
      }

      setReport(getPersistedTranslationValidationReport(projectId));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevalidate = async () => {
    setIsRevalidating(true);
    try {
      const freshReport = await window.electronAPI?.blog.validateTranslations();
      const projectId = activeProject?.id;
      if (projectId && freshReport) {
        persistTranslationValidationReport(projectId, freshReport);
        window.dispatchEvent(new CustomEvent('bds:translation-validation-updated', {
          detail: { projectId },
        }));
      }
    } catch (error) {
      console.error('Translation revalidation failed:', error);
      showToast.error(tr('translationValidation.error.validate'));
    } finally {
      setIsRevalidating(false);
    }
  };

  const handleFix = async () => {
    if (!report) return;

    setIsFixing(true);
    try {
      const result = await window.electronAPI.blog.fixInvalidTranslations(report) as TranslationValidationFixResult;
      showToast.success(tr('translationValidation.toast.fixSuccess', {
        dbRows: result.deletedDatabaseRows,
        files: result.deletedFiles,
      }));
      // Re-validate after fixing to refresh the report
      await handleRevalidate();
    } catch (error) {
      console.error('Fixing invalid translations failed:', error);
      showToast.error(tr('translationValidation.error.fix'));
    } finally {
      setIsFixing(false);
    }
  };

  useEffect(() => {
    loadPersistedReport();
  }, [activeProject?.id]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (!activeProject?.id || detail?.projectId !== activeProject.id) {
        return;
      }
      loadPersistedReport();
    };

    window.addEventListener('bds:translation-validation-updated', handler);
    return () => window.removeEventListener('bds:translation-validation-updated', handler);
  }, [activeProject?.id]);

  const summary = useMemo(() => {
    if (!report) {
      return null;
    }

    return tr('translationValidation.summary', {
      dbRows: report.checkedDatabaseRowCount,
      files: report.checkedFilesystemFileCount,
      invalidDb: report.invalidDatabaseRows.length,
      invalidFiles: report.invalidFilesystemFiles.length,
    });
  }, [report, tr]);

  const canFix = useMemo(() => {
    if (!report) return false;
    return report.invalidDatabaseRows.length > 0 || report.invalidFilesystemFiles.length > 0;
  }, [report]);

  if (isLoading) {
    return (
      <div className="translation-validation-view">
        <p className="translation-validation-status">{tr('translationValidation.loading')}</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="translation-validation-view">
        <p className="translation-validation-status">{tr('translationValidation.empty')}</p>
      </div>
    );
  }

  return (
    <div className="translation-validation-view">
      <div className="translation-validation-summary">
        <h2>{tr('translationValidation.title')}</h2>
        <p>{summary}</p>
      </div>

      <section className="translation-validation-section">
        <h3>{tr('translationValidation.databaseTitle')}</h3>
        {report.invalidDatabaseRows.length === 0 ? (
          <p className="translation-validation-empty">{tr('translationValidation.noneDatabase')}</p>
        ) : (
          <div className="translation-validation-list">
            {report.invalidDatabaseRows.map((issue, index) => (
              <ValidationIssueCard key={`db:${issue.translationId || issue.translationFor}:${index}`} issue={issue} kind="db" />
            ))}
          </div>
        )}
      </section>

      <section className="translation-validation-section">
        <h3>{tr('translationValidation.filesystemTitle')}</h3>
        {report.invalidFilesystemFiles.length === 0 ? (
          <p className="translation-validation-empty">{tr('translationValidation.noneFilesystem')}</p>
        ) : (
          <div className="translation-validation-list">
            {report.invalidFilesystemFiles.map((issue, index) => (
              <ValidationIssueCard key={`file:${issue.filePath || issue.translationFor}:${index}`} issue={issue} kind="file" />
            ))}
          </div>
        )}
      </section>

      <div className="translation-validation-actions">
        <button
          type="button"
          className="translation-validation-revalidate"
          onClick={handleRevalidate}
          disabled={isRevalidating || isFixing}
        >
          {isRevalidating ? tr('translationValidation.revalidating') : tr('translationValidation.revalidate')}
        </button>
        <button
          type="button"
          className="translation-validation-fix"
          onClick={handleFix}
          disabled={!canFix || isFixing || isRevalidating}
        >
          {isFixing ? tr('translationValidation.fixing') : tr('translationValidation.fix')}
        </button>
      </div>
    </div>
  );
};
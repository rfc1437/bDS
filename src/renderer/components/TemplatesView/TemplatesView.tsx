import React, { useEffect, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { TemplateData, TemplateKind } from '../../../main/shared/electronApi';
import { useAppStore } from '../../store';
import { BDS_EVENT_TEMPLATES_CHANGED, dispatchWindowEvent } from '../../utils';
import { useI18n } from '../../i18n';
import { showToast } from '../Toast';
import './TemplatesView.css';

const UI_DATE_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
};

const toTemplateSlug = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'template';
};

interface TemplatesViewProps {
  templateId: string | null;
}

export const TemplatesView: React.FC<TemplatesViewProps> = ({ templateId }) => {
  const { t, language } = useI18n();
  const closeTab = useAppStore((state) => state.closeTab);
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<TemplateKind>('post');
  const [enabled, setEnabled] = useState(true);
  const [templateContent, setTemplateContent] = useState('');
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [monacoResetToken, setMonacoResetToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadTemplate = async () => {
      if (!templateId) {
        setTemplate(null);
        setTitle('');
        setSlug('');
        setKind('post');
        setEnabled(true);
        setTemplateContent('');
        setMonacoResetToken((prev) => prev + 1);
        setIsSlugManuallyEdited(false);
        return;
      }

      const item = await window.electronAPI?.templates.get(templateId);
      if (cancelled || !item) {
        setTemplate(null);
        setTitle('');
        setSlug('');
        setKind('post');
        setEnabled(true);
        setTemplateContent('');
        setMonacoResetToken((prev) => prev + 1);
        setIsSlugManuallyEdited(false);
        return;
      }

      setTemplate(item);
      setTitle(item.title || '');
      setSlug(item.slug || toTemplateSlug(item.title || ''));
      setKind(item.kind || 'post');
      setEnabled(item.enabled ?? true);
      setTemplateContent(item.content || '');
      setMonacoResetToken((prev) => prev + 1);
      const normalizedExisting = toTemplateSlug(item.slug || item.title || '');
      setIsSlugManuallyEdited(normalizedExisting !== toTemplateSlug(item.title || ''));
    };

    void loadTemplate();

    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const hasChanges =
    !!template &&
    (title !== template.title ||
      slug !== template.slug ||
      kind !== template.kind ||
      enabled !== template.enabled ||
      templateContent !== template.content);

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    if (!isSlugManuallyEdited) {
      setSlug(toTemplateSlug(nextTitle));
    }
  };

  const handleSlugChange = (nextSlug: string) => {
    setIsSlugManuallyEdited(true);
    setSlug(toTemplateSlug(nextSlug));
  };

  const handleValidate = async (options: { notify: boolean } = { notify: true }): Promise<boolean> => {
    if (!template || isValidating) {
      return false;
    }

    setIsValidating(true);
    try {
      const result = await window.electronAPI?.templates.validate(templateContent);
      if (!result) {
        return false;
      }

      if (!result.valid) {
        if (options.notify) {
          showToast.error(t('templates.validate.invalid', { count: result.errors.length }));
        }
        return false;
      }

      if (options.notify) {
        showToast.success(t('templates.validate.valid'));
      }
      return true;
    } catch {
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!template || isSaving || !hasChanges) {
      return;
    }

    setIsSaving(true);
    try {
      const isValid = await handleValidate({ notify: true });
      if (!isValid) {
        return;
      }

      const updated = await window.electronAPI?.templates.update(template.id, {
        title,
        slug,
        kind,
        enabled,
        content: templateContent,
      });

      if (!updated) {
        return;
      }

      setTemplate(updated);
      setTitle(updated.title || '');
      setSlug(updated.slug || toTemplateSlug(updated.title || ''));
      setKind(updated.kind || 'post');
      setEnabled(updated.enabled ?? true);
      setTemplateContent(updated.content || '');
      const normalizedExisting = toTemplateSlug(updated.slug || updated.title || '');
      setIsSlugManuallyEdited(normalizedExisting !== toTemplateSlug(updated.title || ''));
      dispatchWindowEvent(BDS_EVENT_TEMPLATES_CHANGED);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!template) {
      return;
    }

    try {
      const result = await window.electronAPI?.templates.delete(template.id);
      if (!result) {
        showToast.error(t('sidebar.templates.deleteFailed'));
        return;
      }

      if (!result.deleted && result.references) {
        const { postIds, tagIds } = result.references;
        const confirmed = window.confirm(
          t('sidebar.templates.deleteConfirmWithRefs', {
            postCount: String(postIds.length),
            tagCount: String(tagIds.length),
          }),
        );
        if (!confirmed) {
          return;
        }
        const forceResult = await window.electronAPI?.templates.delete(template.id, { force: true });
        if (!forceResult?.deleted) {
          showToast.error(t('sidebar.templates.deleteFailed'));
          return;
        }
      }

      closeTab(template.id);
      dispatchWindowEvent(BDS_EVENT_TEMPLATES_CHANGED);
    } catch (error) {
      console.error('Failed to delete template:', error);
      showToast.error(t('sidebar.templates.deleteFailed'));
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void handleSaveTemplate();
      }
    };

    if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') {
      return;
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveTemplate]);

  return (
    <div className="templates-view-shell">
      <div className="editor-header templates-header">
        <div className="editor-tabs">
          <div className="editor-tab active">
            <span className="editor-tab-title">{title || t('editor.untitled')}</span>
          </div>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="templates-save-button"
            onClick={handleSaveTemplate}
            disabled={!template || !hasChanges || isSaving}
          >
            {isSaving ? t('editor.saving') : t('templates.save')}
          </button>
          <button
            type="button"
            className="templates-validate-button"
            onClick={() => {
              void handleValidate({ notify: true });
            }}
            disabled={!template || isValidating || isSaving}
          >
            {isValidating ? t('templates.validate.checking') : t('templates.validate')}
          </button>
          <button
            type="button"
            className="secondary danger"
            onClick={handleDeleteTemplate}
            disabled={!template}
            title={t('templates.delete')}
          >
            {t('templates.delete')}
          </button>
        </div>
      </div>

      <div className="editor-content templates-view">
        <div className="editor-header-row templates-meta-row">
          <div className="editor-meta">
            <div className="editor-field-row">
              <div className="editor-field">
                <label htmlFor="template-title">{t('editor.field.title')}</label>
                <input
                  id="template-title"
                  type="text"
                  value={title}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  disabled={!template}
                />
              </div>
              <div className="editor-field">
                <label htmlFor="template-slug">{t('editor.field.slug')}</label>
                <input
                  id="template-slug"
                  type="text"
                  value={slug}
                  onChange={(event) => handleSlugChange(event.target.value)}
                  disabled={!template}
                />
              </div>
            </div>
            <div className="editor-field-row">
              <div className="editor-field">
                <label htmlFor="template-kind">{t('templates.field.kind')}</label>
                <select
                  id="template-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as TemplateKind)}
                  disabled={!template}
                >
                  <option value="post">{t('templates.kind.post')}</option>
                  <option value="list">{t('templates.kind.list')}</option>
                  <option value="not-found">{t('templates.kind.not_found')}</option>
                  <option value="partial">{t('templates.kind.partial')}</option>
                </select>
              </div>
              <div className="editor-field templates-enabled-field">
                <label htmlFor="template-enabled">
                  <input
                    id="template-enabled"
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                    disabled={!template}
                  />
                  {t('templates.field.enabled')}
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="editor-body templates-editor">
          <div className="editor-toolbar templates-toolbar">
            <div className="editor-toolbar-left">
              <label>{t('templates.content')}</label>
            </div>
            <div className="editor-toolbar-center" />
            <div className="editor-toolbar-right" />
          </div>

          <div className="templates-monaco">
            <MonacoEditor
              key={monacoResetToken}
              height="100%"
              language="html"
              theme="vs-dark"
              defaultValue={templateContent}
              onChange={(value) => setTemplateContent(value || '')}
              options={{
                minimap: { enabled: false },
                wordWrap: 'on',
                lineNumbers: 'on',
                fontSize: 14,
                fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
                padding: { top: 12, bottom: 12 },
                automaticLayout: true,
                scrollBeyondLastLine: false,
                renderLineHighlight: 'line',
                formatOnPaste: true,
                cursorStyle: 'line',
                cursorBlinking: 'smooth',
                readOnly: !template,
              }}
            />
          </div>
        </div>

        {template && (
          <div className="editor-footer">
            <span className="text-muted text-small">
              {t('editor.footer.created')}:{' '}
              {new Date(template.createdAt).toLocaleString(UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en)}
            </span>
            <span className="text-muted text-small">
              {t('editor.footer.updated')}:{' '}
              {new Date(template.updatedAt).toLocaleString(UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

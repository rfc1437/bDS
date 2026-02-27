import React, { useCallback, useEffect, useRef, useState } from 'react';
import MonacoEditor, { type Monaco } from '@monaco-editor/react';
import type { ScriptData } from '../../../main/shared/electronApi';
import { useAppStore } from '../../store';
import { BDS_EVENT_SCRIPTS_CHANGED, dispatchWindowEvent } from '../../utils';
import { getPythonRuntimeManager } from '../../python/runtimeManagerInstance';
import { useI18n } from '../../i18n';
import { showToast } from '../Toast';
import './ScriptsView.css';

type ScriptMonacoEditor = {
  getModel: () => unknown;
};

type ScriptMonacoRuntime = {
  editor: {
    setModelMarkers: (model: unknown, owner: string, markers: Array<{
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
      message: string;
      severity: number;
    }>) => void;
  };
  MarkerSeverity: {
    Error: number;
  };
};

const SCRIPT_SYNTAX_MARKER_OWNER = 'scripts-python-syntax';

const UI_DATE_LOCALE: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  es: 'es-ES',
};

interface ScriptsViewProps {
  scriptId: string | null;
}

export const ScriptsView: React.FC<ScriptsViewProps> = ({ scriptId }) => {
  const { t, language } = useI18n();
  const appendPanelOutputEntry = useAppStore((state) => state.appendPanelOutputEntry);
  const closeTab = useAppStore((state) => state.closeTab);
  const [script, setScript] = useState<ScriptData | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<ScriptData['kind']>('utility');
  const [entrypoint, setEntrypoint] = useState('render');
  const [availableEntrypoints, setAvailableEntrypoints] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [scriptContent, setScriptContent] = useState('');
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingSyntax, setIsCheckingSyntax] = useState(false);
  const editorRef = useRef<ScriptMonacoEditor | null>(null);
  const monacoRef = useRef<ScriptMonacoRuntime | null>(null);
  // Token incremented to signal Monaco to remount with fresh defaultValue.
  // Prevents controlled-mode cursor jumps during typing.
  const [monacoResetToken, setMonacoResetToken] = useState(0);

  const buildCacheKey = (scriptMeta: Pick<ScriptData, 'id' | 'version'>, content: string): string => {
    let hash = 0;
    for (let index = 0; index < content.length; index += 1) {
      hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
    }
    return `${scriptMeta.id}:${scriptMeta.version}:${Math.abs(hash).toString(36)}`;
  };

  const withMainEntrypoint = (entrypoints: string[]): string[] => {
    const filtered = entrypoints.filter((name) => name !== 'main');
    return ['main', ...filtered];
  };

  const toFunctionSlug = (value: string) => {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return normalized || 'script';
  };

  const applySyntaxMarkers = useCallback((errors: Array<{
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    message: string;
  }>) => {
    const model = editorRef.current?.getModel?.();
    const monacoRuntime = monacoRef.current;

    if (!model || !monacoRuntime) {
      return;
    }

    const markers = errors.map((error) => {
      const startLineNumber = Math.max(1, Math.floor(error.line || 1));
      const startColumn = Math.max(1, Math.floor(error.column || 1));
      const endLineNumber = Math.max(startLineNumber, Math.floor(error.endLine || startLineNumber));
      const fallbackEndColumn = startColumn + 1;
      const endColumn = Math.max(startColumn, Math.floor(error.endColumn || fallbackEndColumn));

      return {
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
        message: error.message,
        severity: monacoRuntime.MarkerSeverity.Error,
      };
    });

    monacoRuntime.editor.setModelMarkers(model, SCRIPT_SYNTAX_MARKER_OWNER, markers);
  }, []);

  const handleEditorDidMount = useCallback((editor: unknown, monaco: Monaco) => {
    editorRef.current = editor as ScriptMonacoEditor;
    monacoRef.current = monaco as unknown as ScriptMonacoRuntime;
  }, []);

  const handleCheckSyntax = useCallback(async (options: { notify: boolean } = { notify: true }): Promise<boolean> => {
    if (!script || isCheckingSyntax) {
      return false;
    }

    setIsCheckingSyntax(true);
    try {
      const runtimeManager = getPythonRuntimeManager();
      const syntax = await runtimeManager.syntaxCheck(scriptContent, {
        cacheKey: buildCacheKey(script, scriptContent),
      });

      applySyntaxMarkers(syntax.errors);

      if (syntax.errors.length > 0) {
        if (options.notify) {
          showToast.error(t('scripts.syntax.invalid', { count: syntax.errors.length }));
        }
        return false;
      }

      if (options.notify) {
        showToast.success(t('scripts.syntax.valid'));
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendPanelOutputEntry({
        id: `output-${Date.now()}-syntax-error`,
        message,
        createdAt: new Date().toISOString(),
        kind: 'error',
      });
      if (options.notify) {
        showToast.error(t('scripts.syntax.checkFailed'));
      }
      return false;
    } finally {
      setIsCheckingSyntax(false);
    }
  }, [appendPanelOutputEntry, applySyntaxMarkers, isCheckingSyntax, script, scriptContent, t]);

  useEffect(() => {
    let cancelled = false;

    const refreshEntrypoints = async (content: string, scriptMeta: ScriptData) => {
      try {
        const runtimeManager = getPythonRuntimeManager();
        const discoveredEntrypoints = await runtimeManager.inspectEntrypoints(content, {
          cacheKey: buildCacheKey(scriptMeta, content),
        });
        const available = withMainEntrypoint(discoveredEntrypoints);

        if (cancelled) {
          return;
        }

        setAvailableEntrypoints(available);

        const preferredEntrypoint = available.includes(scriptMeta.entrypoint)
          ? scriptMeta.entrypoint
          : 'main';
        setEntrypoint(preferredEntrypoint);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setAvailableEntrypoints(['main']);
        setEntrypoint('main');
      }
    };

    const loadScript = async () => {
      if (!scriptId) {
        setScript(null);
        setTitle('');
        setSlug('');
        setKind('utility');
        setEntrypoint('render');
        setAvailableEntrypoints(['main']);
        setEnabled(true);
        setScriptContent('');
        setMonacoResetToken(prev => prev + 1);
        setIsSlugManuallyEdited(false);
        return;
      }

      const item = await window.electronAPI?.scripts.get(scriptId);
      if (cancelled || !item) {
        setScript(null);
        setTitle('');
        setSlug('');
        setKind('utility');
        setEntrypoint('render');
        setAvailableEntrypoints(['main']);
        setEnabled(true);
        setScriptContent('');
        setMonacoResetToken(prev => prev + 1);
        setIsSlugManuallyEdited(false);
        return;
      }

      setScript(item);
      setTitle(item.title || '');
      setSlug(toFunctionSlug(item.slug || item.title || ''));
      setKind(item.kind || 'utility');
      setEntrypoint(item.entrypoint || 'render');
      setEnabled(item.enabled ?? true);
      setScriptContent(item.content || '');
      setMonacoResetToken(prev => prev + 1);
      const normalizedExisting = toFunctionSlug(item.slug || item.title || '');
      setIsSlugManuallyEdited(normalizedExisting !== toFunctionSlug(item.title || ''));
      await refreshEntrypoints(item.content || '', item);
    };

    void loadScript();

    return () => {
      cancelled = true;
    };
  }, [scriptId]);

  const hasChanges = !!script && (
    title !== script.title ||
    slug !== script.slug ||
    kind !== script.kind ||
    entrypoint !== script.entrypoint ||
    enabled !== script.enabled ||
    scriptContent !== script.content
  );

  const handleTitleChange = (nextTitle: string) => {
    setTitle(nextTitle);
    if (!isSlugManuallyEdited) {
      setSlug(toFunctionSlug(nextTitle));
    }
  };

  const handleSlugChange = (nextSlug: string) => {
    setIsSlugManuallyEdited(true);
    setSlug(toFunctionSlug(nextSlug));
  };

  const handleSaveScript = async () => {
    if (!script || isSaving || !hasChanges) {
      return;
    }

    setIsSaving(true);
    try {
      const isSyntaxValid = await handleCheckSyntax({ notify: true });
      if (!isSyntaxValid) {
        return;
      }

      const runtimeManager = getPythonRuntimeManager();
      const discoveredEntrypoints = await runtimeManager.inspectEntrypoints(scriptContent, {
        cacheKey: buildCacheKey(script, scriptContent),
      });
      const available = withMainEntrypoint(discoveredEntrypoints);

      const normalizedEntrypoint = available.includes(entrypoint)
        ? entrypoint
        : 'main';

      setAvailableEntrypoints(available);
      setEntrypoint(normalizedEntrypoint);

      const updated = await window.electronAPI?.scripts.update(script.id, {
        title,
        slug,
        kind,
        entrypoint: normalizedEntrypoint,
        enabled,
        content: scriptContent,
      });

      if (!updated) {
        return;
      }

      setScript(updated);
      setTitle(updated.title || '');
      setSlug(toFunctionSlug(updated.slug || updated.title || ''));
      setKind(updated.kind || 'utility');
      setEntrypoint(updated.entrypoint || 'render');
      setAvailableEntrypoints(available);
      setEnabled(updated.enabled ?? true);
      setScriptContent(updated.content || '');
      const normalizedExisting = toFunctionSlug(updated.slug || updated.title || '');
      setIsSlugManuallyEdited(normalizedExisting !== toFunctionSlug(updated.title || ''));
      dispatchWindowEvent(BDS_EVENT_SCRIPTS_CHANGED);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteScript = async () => {
    if (!script) {
      return;
    }

    try {
      const deleted = await window.electronAPI?.scripts.delete(script.id);
      if (!deleted) {
        showToast.error(t('sidebar.scripts.deleteFailed'));
        return;
      }
      closeTab(script.id);
      dispatchWindowEvent(BDS_EVENT_SCRIPTS_CHANGED);
    } catch (error) {
      console.error('Failed to delete script:', error);
      showToast.error(t('sidebar.scripts.deleteFailed'));
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void handleSaveScript();
      }
    };

    if (typeof window.addEventListener !== 'function' || typeof window.removeEventListener !== 'function') {
      return;
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveScript]);

  const handleRunScript = async () => {
    if (!script || isRunning) {
      return;
    }

    setIsRunning(true);

    try {
      const runtimeManager = getPythonRuntimeManager();
      const result = await runtimeManager.execute(scriptContent, {
        cacheKey: buildCacheKey(script, scriptContent),
        entrypoint,
      });

      const now = new Date().toISOString();
      if (result.result.trim().length > 0) {
        appendPanelOutputEntry({
          id: `output-${Date.now()}-result`,
          message: result.result,
          createdAt: now,
          kind: 'result',
        });
      }

      if (result.stdout.trim().length > 0) {
        appendPanelOutputEntry({
          id: `output-${Date.now()}-stdout`,
          message: result.stdout,
          createdAt: now,
          kind: 'stdout',
        });
      }
    } catch (error) {
      appendPanelOutputEntry({
        id: `output-${Date.now()}-error`,
        message: error instanceof Error ? error.message : String(error),
        createdAt: new Date().toISOString(),
        kind: 'error',
      });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="scripts-view-shell">
      <div className="editor-header scripts-header">
        <div className="editor-tabs">
          <div className="editor-tab active">
            <span className="editor-tab-title">{title || t('editor.untitled')}</span>
          </div>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="scripts-save-button"
            onClick={handleSaveScript}
            disabled={!script || !hasChanges || isSaving}
          >
            {isSaving ? t('editor.saving') : t('scripts.save')}
          </button>
          <button
            type="button"
            className="scripts-run-button"
            onClick={handleRunScript}
            disabled={!script || isRunning}
          >
            {t('scripts.run')}
          </button>
          <button
            type="button"
            className="scripts-check-button"
            onClick={() => {
              void handleCheckSyntax({ notify: true });
            }}
            disabled={!script || isCheckingSyntax || isSaving}
          >
            {isCheckingSyntax ? t('scripts.syntax.checking') : t('scripts.syntax.check')}
          </button>
          <button
            type="button"
            className="secondary danger"
            onClick={handleDeleteScript}
            disabled={!script}
            title={t('scripts.delete')}
          >
            {t('scripts.delete')}
          </button>
        </div>
      </div>

      <div className="editor-content scripts-view">
      <div className="editor-header-row scripts-meta-row">
        <div className="editor-meta">
          <div className="editor-field-row">
            <div className="editor-field">
              <label htmlFor="script-title">{t('editor.field.title')}</label>
              <input
                id="script-title"
                type="text"
                value={title}
                onChange={(event) => handleTitleChange(event.target.value)}
                disabled={!script}
              />
            </div>
            <div className="editor-field">
              <label htmlFor="script-slug">{t('editor.field.slug')}</label>
              <input
                id="script-slug"
                type="text"
                value={slug}
                onChange={(event) => handleSlugChange(event.target.value)}
                disabled={!script}
              />
            </div>
          </div>
          <div className="editor-field-row">
            <div className="editor-field">
              <label htmlFor="script-kind">{t('scripts.field.kind')}</label>
              <select
                id="script-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as ScriptData['kind'])}
                disabled={!script}
              >
                <option value="utility">{t('scripts.kind.utility')}</option>
                <option value="macro">{t('scripts.kind.macro')}</option>
                <option value="transform">{t('scripts.kind.transform')}</option>
              </select>
            </div>
            <div className="editor-field">
              <label htmlFor="script-entrypoint">{t('scripts.field.entrypoint')}</label>
              <select
                id="script-entrypoint"
                value={entrypoint}
                onChange={(event) => setEntrypoint(event.target.value)}
                disabled={!script}
              >
                {availableEntrypoints.map((name) => (
                  <option key={name} value={name}>{name === 'main' ? t('scripts.entrypoint.main') : name}</option>
                ))}
              </select>
            </div>
            <div className="editor-field scripts-enabled-field">
              <label htmlFor="script-enabled">
                <input
                  id="script-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  disabled={!script}
                />
                {t('scripts.field.enabled')}
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="editor-body scripts-editor">
        <div className="editor-toolbar scripts-toolbar">
          <div className="editor-toolbar-left">
            <label>{t('scripts.content')}</label>
          </div>
          <div className="editor-toolbar-center" />
          <div className="editor-toolbar-right" />
        </div>

        <div className="scripts-monaco">
          <MonacoEditor
            key={monacoResetToken}
            height="100%"
            language="python"
            theme="vs-dark"
            defaultValue={scriptContent}
            onChange={(value) => setScriptContent(value || '')}
            onMount={handleEditorDidMount}
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
              readOnly: !script,
            }}
          />
        </div>
      </div>

      {script && (
        <div className="editor-footer">
          <span className="text-muted text-small">
            {t('editor.footer.created')}: {new Date(script.createdAt).toLocaleString(UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en)}
          </span>
          <span className="text-muted text-small">
            {t('editor.footer.updated')}: {new Date(script.updatedAt).toLocaleString(UI_DATE_LOCALE[language] || UI_DATE_LOCALE.en)}
          </span>
        </div>
      )}

      </div>
    </div>
  );
};

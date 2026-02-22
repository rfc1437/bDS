import React, { useEffect, useState } from 'react';
import type { ScriptData } from '../../../main/shared/electronApi';
import { useAppStore } from '../../store';
import { getPythonRuntimeManager } from '../../python/runtimeManagerInstance';
import { useI18n } from '../../i18n';
import './ScriptsView.css';

interface ScriptsViewProps {
  scriptId: string | null;
}

export const ScriptsView: React.FC<ScriptsViewProps> = ({ scriptId }) => {
  const { t } = useI18n();
  const appendPanelOutputEntry = useAppStore((state) => state.appendPanelOutputEntry);
  const [script, setScript] = useState<ScriptData | null>(null);
  const [scriptContent, setScriptContent] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadScript = async () => {
      if (!scriptId) {
        setScript(null);
        setScriptContent('');
        return;
      }

      const item = await window.electronAPI?.scripts.get(scriptId);
      if (cancelled || !item) {
        setScript(null);
        setScriptContent('');
        return;
      }

      setScript(item);
      setScriptContent(item.content || '');
    };

    void loadScript();

    return () => {
      cancelled = true;
    };
  }, [scriptId]);

  const handleRunScript = async () => {
    if (!script || isRunning) {
      return;
    }

    setIsRunning(true);

    try {
      const runtimeManager = getPythonRuntimeManager();
      const result = await runtimeManager.execute(scriptContent);

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
      useAppStore.setState({
        panelVisible: true,
        panelActiveTab: 'output',
      });
      setIsRunning(false);
    }
  };

  return (
    <div className="scripts-view">
      <div className="scripts-editor">
        <div className="scripts-toolbar">
          <button type="button" onClick={handleRunScript} disabled={!script || isRunning}>
            {t('scripts.run')}
          </button>
        </div>

        <label className="scripts-label" htmlFor="scripts-content">
          {t('scripts.content')}
        </label>
        <textarea
          id="scripts-content"
          className="scripts-textarea"
          value={scriptContent}
          onChange={(event) => setScriptContent(event.target.value)}
          disabled={!script}
        />
      </div>
    </div>
  );
};

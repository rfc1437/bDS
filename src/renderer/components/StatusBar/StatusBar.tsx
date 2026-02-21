import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { ProjectSelector } from '../ProjectSelector';
import { getRendererPicoTheme } from '../../utils/picoTheme';
import { useI18n, type UiLanguage } from '../../i18n';
import './StatusBar.css';

const UI_LANGUAGE_LABEL_KEYS: Record<UiLanguage, string> = {
  en: 'settings.language.english',
  de: 'settings.language.german',
  fr: 'settings.language.french',
  it: 'settings.language.italian',
  es: 'settings.language.spanish',
};

export const StatusBar: React.FC = () => {
  const { language, setLanguage, supportedLanguages, t } = useI18n();
  const {
    media,
    tasks,
    selectedPostId,
    totalPosts,
    picoTheme,
  } = useAppStore();

  const [selectedPostStatus, setSelectedPostStatus] = useState<string | null>(null);

  // Fetch selected post status from database
  useEffect(() => {
    if (!selectedPostId) {
      setSelectedPostStatus(null);
      return;
    }
    window.electronAPI?.posts.get(selectedPostId).then(post => {
      setSelectedPostStatus(post?.status || null);
    });
  }, [selectedPostId]);

  const runningTasks = tasks.filter(t => t.status === 'running');
  const activeTheme = getRendererPicoTheme(picoTheme);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {/* Project Selector */}
        <ProjectSelector />

        {/* Running Tasks */}
        {runningTasks.length > 0 && (
          <div className="status-bar-item">
            <span className="task-spinner" />
            <span>{runningTasks[0].message}</span>
            {runningTasks.length > 1 && (
              <span className="text-muted">{t('statusBar.more', { count: runningTasks.length - 1 })}</span>
            )}
          </div>
        )}
      </div>

      <div className="status-bar-right">
        {/* Current Post Info */}
        {selectedPostStatus && (
          <div className="status-bar-item">
            <span className={`status-dot status-${selectedPostStatus}`} />
            <span>{selectedPostStatus}</span>
          </div>
        )}

        {/* Stats */}
        <div className="status-bar-item">
          <span>{t('statusBar.posts', { count: totalPosts })}</span>
        </div>
        <div className="status-bar-item">
          <span>{t('statusBar.media', { count: media.length })}</span>
        </div>

        <div className="status-bar-item theme-badge">
          <span>{t('statusBar.theme', { theme: activeTheme })}</span>
        </div>

        <div className="status-bar-item language-badge">
          <span>{t('statusBar.ui')}</span>
          <select
            className="status-bar-language-select"
            data-testid="statusbar-language-select"
            aria-label={t('statusBar.uiLanguage')}
            value={language}
            onChange={(event) => setLanguage(event.target.value as UiLanguage)}
          >
            {supportedLanguages.map((supportedLanguage) => (
              <option key={supportedLanguage} value={supportedLanguage}>
                {t(UI_LANGUAGE_LABEL_KEYS[supportedLanguage])}
              </option>
            ))}
          </select>
        </div>

        {/* App Name */}
        <div className="status-bar-item brand">
          <span>bDS</span>
        </div>
      </div>
    </div>
  );
};

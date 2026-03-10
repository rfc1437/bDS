import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import { useI18n } from '../../i18n';
import { PICO_THEME_NAMES, PICO_THEME_PREVIEW_TOKENS, getRendererPicoTheme, ensureRendererPicoThemeStylesheet, type PicoThemeName } from '../../utils/picoTheme';
import './StyleView.css';

const PREVIEW_SERVER_BASE_URL = 'http://127.0.0.1:4123';
type PreviewMode = 'auto' | 'light' | 'dark';

function toDisplayName(theme: PicoThemeName): string {
  return `${theme.charAt(0).toUpperCase()}${theme.slice(1)}`;
}

export const StyleView: React.FC = () => {
  const { t } = useI18n();
  const { activeProject, picoTheme, setPicoTheme } = useAppStore();
  const [selectedTheme, setSelectedTheme] = useState<PicoThemeName>(getRendererPicoTheme(picoTheme));
  const [previewMode, setPreviewMode] = useState<PreviewMode>('auto');
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    setSelectedTheme(getRendererPicoTheme(picoTheme));
  }, [picoTheme]);

  useEffect(() => {
    ensureRendererPicoThemeStylesheet(selectedTheme).catch((error) => {
      console.error('Failed to load selected renderer theme stylesheet:', error);
    });
  }, [selectedTheme]);

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const metadata = await window.electronAPI?.meta.getProjectMetadata();
        const nextTheme = getRendererPicoTheme(metadata?.picoTheme);
        setPicoTheme(metadata?.picoTheme);
        setSelectedTheme(nextTheme);
      } catch (error) {
        console.error('Failed to load project style settings:', error);
      }
    };

    loadTheme();
  }, [activeProject?.id, setPicoTheme]);

  const previewUrl = useMemo(() => {
    return `${PREVIEW_SERVER_BASE_URL}/__style-preview?theme=${encodeURIComponent(selectedTheme)}&mode=${encodeURIComponent(previewMode)}`;
  }, [selectedTheme, previewMode]);

  const handleApplyTheme = async () => {
    try {
      setIsApplying(true);
      await window.electronAPI?.meta.updateProjectMetadata({ picoTheme: selectedTheme });
      setPicoTheme(selectedTheme);
      showToast.success(t('styleView.toast.appliedTheme', { theme: toDisplayName(selectedTheme) }));
    } catch (error) {
      console.error('Failed to apply style theme:', error);
      showToast.error(t('styleView.toast.applyThemeFailed'));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="style-view">
      <div className="style-view-header">
        <h2>{t('styleView.title')}</h2>
        <p>{t('styleView.subtitle')}</p>
      </div>

      <div className="style-theme-picker" role="group" aria-label={t('styleView.themePickerAria')}>
        {PICO_THEME_NAMES.map((theme) => {
          const isSelected = selectedTheme === theme;
          const preview = PICO_THEME_PREVIEW_TOKENS[theme];
          return (
            <button
              key={theme}
              type="button"
              className={`style-theme-option ${isSelected ? 'selected' : ''}`}
              onClick={() => setSelectedTheme(theme)}
              aria-pressed={isSelected}
              aria-label={toDisplayName(theme)}
            >
              <span className={`style-theme-swatch style-theme-swatch-${theme}`}>
                <span className="style-theme-tones" aria-hidden="true">
                  <span
                    className="style-theme-tone style-theme-tone-accent"
                    style={{ background: `linear-gradient(135deg, ${preview.lightPrimary}, ${preview.darkPrimary})` }}
                  />
                  <span
                    className="style-theme-tone style-theme-tone-light"
                    style={{ backgroundColor: preview.lightBackground }}
                  />
                  <span
                    className="style-theme-tone style-theme-tone-dark"
                    style={{ backgroundColor: preview.darkBackground }}
                  />
                </span>
                <span className="style-theme-name">{toDisplayName(theme)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="style-apply-row">
        <label className="style-preview-mode-control">
          <span>{t('styleView.previewMode')}</span>
          <select
            aria-label={t('styleView.previewMode')}
            value={previewMode}
            onChange={(event) => setPreviewMode(event.target.value as PreviewMode)}
          >
            <option value="auto">{t('styleView.mode.auto')}</option>
            <option value="light">{t('styleView.mode.light')}</option>
            <option value="dark">{t('styleView.mode.dark')}</option>
          </select>
        </label>
        <button
          className="primary"
          onClick={handleApplyTheme}
          disabled={isApplying || picoTheme === selectedTheme}
        >
          {t('styleView.applyTheme')}
        </button>
      </div>

      <div className="style-preview-container">
        <iframe
          title={t('styleView.themePreviewTitle')}
          className="style-preview-frame"
          src={previewUrl}
        />
      </div>
    </div>
  );
};

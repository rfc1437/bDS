import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../i18n';
import './AISuggestionsModal.css';

export interface AISuggestions {
  title?: string;
  alt?: string;
  caption?: string;
}

export interface CurrentValues {
  title: string;
  alt: string;
  caption: string;
}

type SuggestionFieldKey = 'title' | 'alt' | 'caption';

interface SuggestionFieldConfig {
  key: SuggestionFieldKey;
  label: string;
}

const SUGGESTION_FIELDS: SuggestionFieldConfig[] = [
  { key: 'title', label: 'aiSuggestions.titleField' },
  { key: 'alt', label: 'aiSuggestions.altField' },
  { key: 'caption', label: 'aiSuggestions.captionField' },
];

interface AISuggestionsModalProps {
  isOpen: boolean;
  isLoading: boolean;
  suggestions: AISuggestions | null;
  currentValues: CurrentValues;
  error?: string;
  onConfirm: (values: Partial<AISuggestions>) => void;
  onClose: () => void;
}

export const AISuggestionsModal: React.FC<AISuggestionsModalProps> = ({
  isOpen,
  isLoading,
  suggestions,
  currentValues,
  error,
  onConfirm,
  onClose,
}) => {
  const { t: tr } = useI18n();
  // Checkbox state - initialized based on whether current values are empty
  const [useTitle, setUseTitle] = useState(false);
  const [useAlt, setUseAlt] = useState(false);
  const [useCaption, setUseCaption] = useState(false);

  // Update checkbox state when suggestions arrive, based on whether current fields are empty
  useEffect(() => {
    if (suggestions) {
      setUseTitle(suggestions.title ? !currentValues.title : false);
      setUseAlt(suggestions.alt ? !currentValues.alt : false);
      setUseCaption(suggestions.caption ? !currentValues.caption : false);
    }
  }, [suggestions, currentValues]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      onClose();
    }
  }, [isLoading, onClose]);

  const handleConfirm = useCallback(() => {
    const valuesToApply: Partial<AISuggestions> = {};
    if (useTitle && suggestions?.title) valuesToApply.title = suggestions.title;
    if (useAlt && suggestions?.alt) valuesToApply.alt = suggestions.alt;
    if (useCaption && suggestions?.caption) valuesToApply.caption = suggestions.caption;
    onConfirm(valuesToApply);
  }, [useTitle, useAlt, useCaption, suggestions, onConfirm]);

  if (!isOpen) return null;

  const hasAnySuggestion = suggestions && (suggestions.title || suggestions.alt || suggestions.caption);
  const hasAnySelected = useTitle || useAlt || useCaption;

  const fieldSelection: Record<SuggestionFieldKey, [boolean, (checked: boolean) => void]> = {
    title: [useTitle, setUseTitle],
    alt: [useAlt, setUseAlt],
    caption: [useCaption, setUseCaption],
  };

  const renderSuggestionField = (field: SuggestionFieldConfig) => {
    if (!suggestions?.[field.key]) {
      return null;
    }

    const [isChecked, setChecked] = fieldSelection[field.key];
    const currentValue = currentValues[field.key];
    const suggestedValue = suggestions[field.key];

    return (
      <div key={field.key} className="ai-suggestion-item">
        <label className="ai-suggestion-checkbox">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span className="checkmark"></span>
        </label>
        <div className="ai-suggestion-content">
          <div className="ai-suggestion-label">
            {field.label}
            {currentValue && (
              <span className="ai-suggestion-has-value" title={tr('aiSuggestions.hasExisting')}>
                {tr('aiSuggestions.hasExisting')}
              </span>
            )}
          </div>
          <div className="ai-suggestion-value">{suggestedValue}</div>
          {currentValue && (
            <div className="ai-suggestion-current">
              {tr('aiSuggestions.current')}: <em>{currentValue}</em>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ai-suggestions-modal-backdrop" onClick={handleBackdropClick}>
      <div className="ai-suggestions-modal">
        <div className="ai-suggestions-modal-header">
          <h2>{tr('aiSuggestions.title')}</h2>
          {!isLoading && (
            <button className="ai-suggestions-modal-close" onClick={onClose} title={tr('aiSuggestions.close')}>
              ✕
            </button>
          )}
        </div>

        <div className="ai-suggestions-modal-body">
          {isLoading && (
            <div className="ai-suggestions-loading">
              <div className="ai-suggestions-spinner"></div>
              <p>{tr('aiSuggestions.analyzing')}</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="ai-suggestions-error">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {!isLoading && !error && hasAnySuggestion && (
            <div className="ai-suggestions-list">
              <p className="ai-suggestions-intro">
                {tr('aiSuggestions.intro')}
              </p>
              {SUGGESTION_FIELDS.map((field) => renderSuggestionField({ ...field, label: tr(field.label) }))}
            </div>
          )}

          {!isLoading && !error && !hasAnySuggestion && suggestions && (
            <div className="ai-suggestions-empty">
              {tr('aiSuggestions.empty')}
            </div>
          )}
        </div>

        <div className="ai-suggestions-modal-footer">
          {isLoading ? (
            <button className="button-cancel" disabled>
              {tr('aiSuggestions.wait')}
            </button>
          ) : (
            <>
              <button className="button-cancel" onClick={onClose}>
                {tr('common.cancel')}
              </button>
              {hasAnySuggestion && (
                <button
                  className="button-apply"
                  onClick={handleConfirm}
                  disabled={!hasAnySelected}
                >
                  {tr('aiSuggestions.applySelected')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

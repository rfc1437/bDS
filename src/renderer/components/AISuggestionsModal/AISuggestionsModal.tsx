import React, { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../../i18n';
import './AISuggestionsModal.css';

// Keep legacy types for backward-compatible re-export
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

/**
 * Generic field definition for the AI suggestions modal.
 * Each field represents one suggestion the user can accept or reject.
 */
export interface SuggestionField {
  key: string;
  label: string;
  currentValue: string;
  suggestedValue?: string;
  disabled?: boolean;
  warning?: string;
}

interface AISuggestionsModalProps {
  isOpen: boolean;
  isLoading: boolean;
  fields: SuggestionField[];
  error?: string;
  modalTitle: string;
  loadingText: string;
  emptyText: string;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}

export const AISuggestionsModal: React.FC<AISuggestionsModalProps> = ({
  isOpen,
  isLoading,
  fields,
  error,
  modalTitle,
  loadingText,
  emptyText,
  onConfirm,
  onClose,
}) => {
  const { t: tr } = useI18n();
  // Dynamic checkbox state keyed by field key
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Auto-check fields when suggestions arrive:
  // checked only when there IS a suggestion AND current value is empty
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const field of fields) {
      initial[field.key] = !field.disabled && !!field.suggestedValue && !field.currentValue;
    }
    setChecked(initial);
  }, [fields]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      onClose();
    }
  }, [isLoading, onClose]);

  const handleConfirm = useCallback(() => {
    const valuesToApply: Record<string, string> = {};
    for (const field of fields) {
      if (checked[field.key] && field.suggestedValue) {
        valuesToApply[field.key] = field.suggestedValue;
      }
    }
    onConfirm(valuesToApply);
  }, [checked, fields, onConfirm]);

  const setFieldChecked = useCallback((key: string, value: boolean) => {
    setChecked(prev => ({ ...prev, [key]: value }));
  }, []);

  if (!isOpen) return null;

  const fieldsWithSuggestions = fields.filter(f => !!f.suggestedValue);
  const hasAnySuggestion = fieldsWithSuggestions.length > 0;
  const hasAnySelected = Object.values(checked).some(v => v);

  return (
    <div className="ai-suggestions-modal-backdrop" onClick={handleBackdropClick}>
      <div className="ai-suggestions-modal">
        <div className="ai-suggestions-modal-header">
          <h2>{modalTitle}</h2>
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
              <p>{loadingText}</p>
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
              {fieldsWithSuggestions.map((field) => (
                <div key={field.key} className="ai-suggestion-item">
                  <label className="ai-suggestion-checkbox">
                    <input
                      type="checkbox"
                      checked={!!checked[field.key]}
                      disabled={field.disabled}
                      onChange={(e) => setFieldChecked(field.key, e.target.checked)}
                    />
                    <span className="checkmark"></span>
                  </label>
                  <div className="ai-suggestion-content">
                    <div className="ai-suggestion-label">
                      {field.label}
                      {field.currentValue && (
                        <span className="ai-suggestion-has-value" title={tr('aiSuggestions.hasExisting')}>
                          {tr('aiSuggestions.hasExisting')}
                        </span>
                      )}
                    </div>
                    <div className="ai-suggestion-value">{field.suggestedValue}</div>
                    {field.warning && (
                      <div className="ai-suggestion-current">{field.warning}</div>
                    )}
                    {field.currentValue && (
                      <div className="ai-suggestion-current">
                        {tr('aiSuggestions.current')}: <em>{field.currentValue}</em>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && !error && !hasAnySuggestion && fields.length > 0 && (
            <div className="ai-suggestions-empty">
              {emptyText}
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

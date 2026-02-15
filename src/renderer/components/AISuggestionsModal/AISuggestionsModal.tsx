import React, { useState, useEffect, useCallback } from 'react';
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

  return (
    <div className="ai-suggestions-modal-backdrop" onClick={handleBackdropClick}>
      <div className="ai-suggestions-modal">
        <div className="ai-suggestions-modal-header">
          <h2>AI Image Analysis</h2>
          {!isLoading && (
            <button className="ai-suggestions-modal-close" onClick={onClose} title="Close">
              ✕
            </button>
          )}
        </div>

        <div className="ai-suggestions-modal-body">
          {isLoading && (
            <div className="ai-suggestions-loading">
              <div className="ai-suggestions-spinner"></div>
              <p>Analyzing image...</p>
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
                Select which AI-generated values to apply. Existing values are preserved by default.
              </p>

              {suggestions?.title && (
                <div className="ai-suggestion-item">
                  <label className="ai-suggestion-checkbox">
                    <input
                      type="checkbox"
                      checked={useTitle}
                      onChange={(e) => setUseTitle(e.target.checked)}
                    />
                    <span className="checkmark"></span>
                  </label>
                  <div className="ai-suggestion-content">
                    <div className="ai-suggestion-label">
                      Title
                      {currentValues.title && (
                        <span className="ai-suggestion-has-value" title="This field already has a value">
                          (has existing value)
                        </span>
                      )}
                    </div>
                    <div className="ai-suggestion-value">{suggestions.title}</div>
                    {currentValues.title && (
                      <div className="ai-suggestion-current">
                        Current: <em>{currentValues.title}</em>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {suggestions?.alt && (
                <div className="ai-suggestion-item">
                  <label className="ai-suggestion-checkbox">
                    <input
                      type="checkbox"
                      checked={useAlt}
                      onChange={(e) => setUseAlt(e.target.checked)}
                    />
                    <span className="checkmark"></span>
                  </label>
                  <div className="ai-suggestion-content">
                    <div className="ai-suggestion-label">
                      Alt Text
                      {currentValues.alt && (
                        <span className="ai-suggestion-has-value" title="This field already has a value">
                          (has existing value)
                        </span>
                      )}
                    </div>
                    <div className="ai-suggestion-value">{suggestions.alt}</div>
                    {currentValues.alt && (
                      <div className="ai-suggestion-current">
                        Current: <em>{currentValues.alt}</em>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {suggestions?.caption && (
                <div className="ai-suggestion-item">
                  <label className="ai-suggestion-checkbox">
                    <input
                      type="checkbox"
                      checked={useCaption}
                      onChange={(e) => setUseCaption(e.target.checked)}
                    />
                    <span className="checkmark"></span>
                  </label>
                  <div className="ai-suggestion-content">
                    <div className="ai-suggestion-label">
                      Caption
                      {currentValues.caption && (
                        <span className="ai-suggestion-has-value" title="This field already has a value">
                          (has existing value)
                        </span>
                      )}
                    </div>
                    <div className="ai-suggestion-value">{suggestions.caption}</div>
                    {currentValues.caption && (
                      <div className="ai-suggestion-current">
                        Current: <em>{currentValues.caption}</em>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isLoading && !error && !hasAnySuggestion && suggestions && (
            <div className="ai-suggestions-empty">
              No suggestions were generated for this image.
            </div>
          )}
        </div>

        <div className="ai-suggestions-modal-footer">
          {isLoading ? (
            <button className="button-cancel" disabled>
              Please wait...
            </button>
          ) : (
            <>
              <button className="button-cancel" onClick={onClose}>
                Cancel
              </button>
              {hasAnySuggestion && (
                <button
                  className="button-apply"
                  onClick={handleConfirm}
                  disabled={!hasAnySelected}
                >
                  Apply Selected
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

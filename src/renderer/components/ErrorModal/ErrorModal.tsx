import React, { useCallback } from 'react';
import { useI18n } from '../../i18n';
import './ErrorModal.css';

export interface ErrorDetails {
  message: string;
  title?: string;
  stack?: string;
}

interface ErrorModalProps {
  error: ErrorDetails | null;
  onClose: () => void;
}

export const ErrorModal: React.FC<ErrorModalProps> = ({ error, onClose }) => {
  const { t: tr } = useI18n();

  const handleCopyStack = useCallback(async () => {
    if (!error) return;
    const textToCopy = `${error.title || tr('errorModal.error')}\n${error.message}\n\n${tr('errorModal.stackTrace')}:\n${error.stack || tr('errorModal.noStack')}`;
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [error, tr]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!error) return null;

  return (
    <div className="error-modal-backdrop" onClick={handleBackdropClick}>
      <div className="error-modal">
        <div className="error-modal-header">
          <h2>{error.title || tr('errorModal.error')}</h2>
          <button className="error-modal-close" onClick={onClose} title={tr('aiSuggestions.close')}>
            ✕
          </button>
        </div>
        <div className="error-modal-body">
          <div className="error-message">{error.message}</div>
          {error.stack && (
            <div className="error-stack-section">
              <div className="error-stack-header">
                <span>{tr('errorModal.stackTrace')}</span>
                <button className="copy-button" onClick={handleCopyStack} title={tr('errorModal.copyClipboard')}>
                  📋 {tr('errorModal.copy')}
                </button>
              </div>
              <pre className="error-stack">{error.stack}</pre>
            </div>
          )}
        </div>
        <div className="error-modal-footer">
          <button onClick={onClose}>{tr('aiSuggestions.close')}</button>
        </div>
      </div>
    </div>
  );
};

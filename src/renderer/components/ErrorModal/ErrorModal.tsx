import React, { useCallback } from 'react';
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
  if (!error) return null;

  const handleCopyStack = useCallback(async () => {
    const textToCopy = `${error.title || 'Error'}\n${error.message}\n\nStack Trace:\n${error.stack || 'No stack trace available'}`;
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [error]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <div className="error-modal-backdrop" onClick={handleBackdropClick}>
      <div className="error-modal">
        <div className="error-modal-header">
          <h2>{error.title || 'Error'}</h2>
          <button className="error-modal-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="error-modal-body">
          <div className="error-message">{error.message}</div>
          {error.stack && (
            <div className="error-stack-section">
              <div className="error-stack-header">
                <span>Stack Trace</span>
                <button className="copy-button" onClick={handleCopyStack} title="Copy to clipboard">
                  📋 Copy
                </button>
              </div>
              <pre className="error-stack">{error.stack}</pre>
            </div>
          )}
        </div>
        <div className="error-modal-footer">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

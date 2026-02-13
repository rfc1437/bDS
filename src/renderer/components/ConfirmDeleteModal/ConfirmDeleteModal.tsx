import React, { useCallback } from 'react';
import './ConfirmDeleteModal.css';

export interface DeleteReference {
  id: string;
  title: string;
  type: 'post' | 'media' | 'link';
}

export interface ConfirmDeleteDetails {
  itemType: 'post' | 'media';
  itemTitle: string;
  references: DeleteReference[];
  onConfirm: () => void | Promise<void>;
}

interface ConfirmDeleteModalProps {
  details: ConfirmDeleteDetails | null;
  onClose: () => void;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({ details, onClose }) => {
  if (!details) return null;

  const handleConfirm = useCallback(async () => {
    await details.onConfirm();
    onClose();
  }, [details, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  const hasReferences = details.references.length > 0;

  return (
    <div className="confirm-delete-modal-backdrop" onClick={handleBackdropClick}>
      <div className="confirm-delete-modal">
        <div className="confirm-delete-modal-header">
          <h2>Confirm Deletion</h2>
          <button className="confirm-delete-modal-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="confirm-delete-modal-body">
          <div className="confirm-delete-message">
            Are you sure you want to delete {details.itemType === 'post' ? 'the post' : 'the media file'}{' '}
            <strong>{details.itemTitle}</strong>?
          </div>

          {hasReferences && (
            <div className="confirm-delete-warning">
              <div className="warning-icon">⚠️</div>
              <div className="warning-content">
                <strong>Warning:</strong> This {details.itemType} is referenced by the following items:
                <ul className="reference-list">
                  {details.references.map((ref) => (
                    <li key={ref.id}>
                      <span className="reference-type">
                        {ref.type === 'post' ? '📄' : ref.type === 'media' ? '🖼️' : '🔗'}
                      </span>
                      <span className="reference-title">{ref.title}</span>
                    </li>
                  ))}
                </ul>
                <p className="warning-note">
                  Deleting this {details.itemType} will remove all these references.
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="confirm-delete-modal-footer">
          <button className="button-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="button-delete" onClick={handleConfirm}>
            Delete {details.itemType === 'post' ? 'Post' : 'Media'}
          </button>
        </div>
      </div>
    </div>
  );
};

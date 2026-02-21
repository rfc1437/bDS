import React, { useCallback } from 'react';
import { useI18n } from '../../i18n';
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
  const { t: tr } = useI18n();
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
          <h2>{tr('confirmDelete.title')}</h2>
          <button className="confirm-delete-modal-close" onClick={onClose} title={tr('aiSuggestions.close')}>
            ✕
          </button>
        </div>
        <div className="confirm-delete-modal-body">
          <div className="confirm-delete-message">
            {details.itemType === 'post' ? tr('confirmDelete.promptPost') : tr('confirmDelete.promptMedia')}{' '}
            <strong>{details.itemTitle}</strong>?
          </div>

          {hasReferences && (
            <div className="confirm-delete-warning">
              <div className="warning-icon">⚠️</div>
              <div className="warning-content">
                <strong>{tr('confirmDelete.warning')}</strong> {tr('confirmDelete.referencedBy', { itemType: tr(`confirmDelete.itemType.${details.itemType}`) })}
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
                  {tr('confirmDelete.note', { itemType: tr(`confirmDelete.itemType.${details.itemType}`) })}
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="confirm-delete-modal-footer">
          <button className="button-cancel" onClick={onClose}>
            {tr('confirmDelete.cancel')}
          </button>
          <button className="button-delete" onClick={handleConfirm}>
            {details.itemType === 'post' ? tr('confirmDelete.deletePost') : tr('confirmDelete.deleteMedia')}
          </button>
        </div>
      </div>
    </div>
  );
};

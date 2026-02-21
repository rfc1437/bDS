import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
import { getContrastColor } from '../../utils/color';
import { subscribeToTagEvents } from '../../utils/tagEventSubscriptions';
import { useI18n } from '../../i18n';
import './TagsView.css';

// Types
interface TagWithCount {
  name: string;
  color: string | null;
  count: number;
}

interface TagData {
  id: string;
  projectId: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

// Export category IDs for sidebar navigation
export type TagsCategory = 'cloud' | 'manage' | 'merge';

// Scroll to a tags section by category ID
export const scrollToTagsSection = (category: TagsCategory) => {
  const element = document.getElementById(`tags-section-${category}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

// Color picker presets
const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e',
];

// Tag Cloud Item
const TagCloudItem: React.FC<{
  tag: TagWithCount;
  isSelected: boolean;
  onSelect: (name: string) => void;
  maxCount: number;
  title: string;
}> = ({ tag, isSelected, onSelect, maxCount, title }) => {
  // Calculate font size based on count (range: 0.8rem to 2rem)
  const minSize = 0.85;
  const maxSize = 1.8;
  const ratio = maxCount > 1 ? (tag.count - 1) / (maxCount - 1) : 0;
  const fontSize = minSize + (maxSize - minSize) * ratio;

  const hasColor = !!tag.color;
  const style: React.CSSProperties = hasColor
    ? {
        backgroundColor: tag.color!,
        color: getContrastColor(tag.color!),
        fontSize: `${fontSize}rem`,
      }
    : {
        fontSize: `${fontSize}rem`,
      };

  return (
    <button
      className={`tag-cloud-item ${isSelected ? 'selected' : ''} ${hasColor ? 'has-color' : ''}`}
      style={style}
      onClick={() => onSelect(tag.name)}
      title={title}
    >
      {tag.name}
      <span className="tag-count">{tag.count}</span>
    </button>
  );
};

// Confirm Dialog for destructive actions
const ConfirmDialog: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ isOpen, title, message, confirmText, cancelText = 'Cancel', isDestructive, onConfirm, onCancel }) => {
  if (!isOpen) return null;

  return (
    <div className="confirm-dialog-overlay">
      <div className="confirm-dialog">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button onClick={onCancel}>{cancelText}</button>
          <button 
            className={isDestructive ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// Section Header
const SectionHeader: React.FC<{
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ id, title, description, children }) => (
  <div className="tags-section" id={id}>
    <div className="tags-section-header">
      <h3>{title}</h3>
      {description && <p className="tags-section-description">{description}</p>}
    </div>
    <div className="tags-section-content">
      {children}
    </div>
  </div>
);

export const TagsView: React.FC = () => {
  const { t } = useI18n();
  const { showErrorModal } = useAppStore();
  
  // State
  const [tagsWithCounts, setTagsWithCounts] = useState<TagWithCount[]>([]);
  const [allTags, setAllTags] = useState<TagData[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Create tag form
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('');
  
  // Edit tag state
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagColor, setEditTagColor] = useState<string>('');
  const [editTagName, setEditTagName] = useState('');
  
  // Merge tags state
  const [mergeTargetName, setMergeTargetName] = useState('');
  
  // Confirm dialogs
  const [deleteConfirm, setDeleteConfirm] = useState<{ tagId: string; tagName: string } | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState<{ sourceNames: string[]; targetName: string } | null>(null);

  // Load tags
  const loadTags = useCallback(async () => {
    try {
      setIsLoading(true);
      const [tagsWithCountsResult, allTagsResult] = await Promise.all([
        window.electronAPI?.tags.getWithCounts(),
        window.electronAPI?.tags.getAll(),
      ]);
      
      if (tagsWithCountsResult) {
        setTagsWithCounts(tagsWithCountsResult as TagWithCount[]);
      }
      if (allTagsResult) {
        setAllTags(allTagsResult as TagData[]);
      }
    } catch (error) {
      console.error('Failed to load tags:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Listen for tag events
  useEffect(() => {
    return subscribeToTagEvents(window.electronAPI?.on, loadTags, {
      includeUpdated: true,
    });
  }, [loadTags]);

  // Handle tag selection
  const handleTagSelect = (name: string) => {
    setSelectedTags(prev => {
      if (prev.includes(name)) {
        return prev.filter(n => n !== name);
      }
      return [...prev, name];
    });
  };

  // Create tag
  const handleCreateTag = async () => {
    if (!newTagName.trim()) {
      showToast.error(t('tagsView.toast.tagNameRequired'));
      return;
    }

    try {
      await window.electronAPI?.tags.create({
        name: newTagName.trim(),
        color: newTagColor || undefined,
      });
      setNewTagName('');
      setNewTagColor('');
      showToast.success(t('tagsView.toast.tagCreated'));
      loadTags();
    } catch (error) {
      const err = error as Error;
      showToast.error(err.message);
    }
  };

  // Delete tag (with confirmation)
  const handleDeleteTag = async () => {
    if (!deleteConfirm) return;

    try {
      const result = await window.electronAPI?.tags.delete(deleteConfirm.tagId);
      if (result?.success) {
        showToast.success(t('tagsView.toast.tagDeleted', { postsUpdated: result.postsUpdated }));
        setSelectedTags(prev => prev.filter(n => n !== deleteConfirm.tagName));
        loadTags();
      }
    } catch (error) {
      const err = error as Error;
      showErrorModal({
        title: t('tagsView.error.deleteFailedTitle'),
        message: err.message,
      });
    } finally {
      setDeleteConfirm(null);
    }
  };

  // Start editing tag
  const handleStartEdit = (tag: TagData) => {
    setEditingTagId(tag.id);
    setEditTagColor(tag.color || '');
    setEditTagName(tag.name);
  };

  // Save tag edit
  const handleSaveEdit = async () => {
    if (!editingTagId) return;

    try {
      // Update color
      await window.electronAPI?.tags.update(editingTagId, {
        color: editTagColor || null,
      });

      // If name changed, rename the tag
      const originalTag = allTags.find(t => t.id === editingTagId);
      if (originalTag && originalTag.name !== editTagName.trim().toLowerCase()) {
        await window.electronAPI?.tags.rename(editingTagId, editTagName.trim());
      }

      showToast.success(t('tagsView.toast.tagUpdated'));
      setEditingTagId(null);
      loadTags();
    } catch (error) {
      const err = error as Error;
      showToast.error(err.message);
    }
  };

  // Merge tags (with confirmation)
  const handleMergeTags = async () => {
    if (!mergeConfirm) return;

    try {
      // Find target tag
      const targetTag = allTags.find(t => t.name === mergeConfirm.targetName);
      if (!targetTag) {
        showToast.error(t('tagsView.toast.targetTagNotFound'));
        return;
      }

      // Find source tag IDs
      const sourceTags = allTags.filter(t => 
        mergeConfirm.sourceNames.includes(t.name) && t.id !== targetTag.id
      );

      if (sourceTags.length === 0) {
        showToast.error(t('tagsView.toast.noSourceTagsToMerge'));
        return;
      }

      const result = await window.electronAPI?.tags.merge(
        sourceTags.map(t => t.id),
        targetTag.id
      );

      if (result?.success) {
        showToast.success(
          t('tagsView.toast.tagsMerged', {
            tagsDeleted: result.tagsDeleted,
            targetTag: result.targetTag,
            postsUpdated: result.postsUpdated,
          })
        );
        setSelectedTags([]);
        setMergeTargetName('');
        loadTags();
      }
    } catch (error) {
      const err = error as Error;
      showErrorModal({
        title: t('tagsView.error.mergeFailedTitle'),
        message: err.message,
      });
    } finally {
      setMergeConfirm(null);
    }
  };

  // Sync tags from posts
  const handleSyncFromPosts = async () => {
    try {
      const result = await window.electronAPI?.tags.syncFromPosts();
      if (result) {
        if (result.added.length > 0) {
          showToast.success(t('tagsView.toast.discoveredTags', { count: result.added.length }));
        } else {
          showToast.info(t('tagsView.toast.alreadySynced'));
        }
        loadTags();
      }
    } catch (error) {
      const err = error as Error;
      showToast.error(err.message);
    }
  };

  // Clear selection
  const handleClearSelection = () => {
    setSelectedTags([]);
  };

  // Get max count for sizing
  const maxCount = Math.max(...tagsWithCounts.map(t => t.count), 1);

  // Selected tag objects
  const selectedTagObjects = allTags.filter(t => selectedTags.includes(t.name));

  return (
    <div className="tags-view">
      <div className="tags-view-header">
        <h2>{t('tagsView.title')}</h2>
        <p className="text-muted">{t('tagsView.subtitle')}</p>
      </div>

      <div className="tags-view-content">
        {/* Tag Cloud Section */}
        <SectionHeader
          id="tags-section-cloud"
          title={t('tagsView.cloud.title')}
          description={t('tagsView.cloud.description')}
        >
          {isLoading ? (
            <div className="tags-loading">{t('tagsView.loadingTags')}</div>
          ) : tagsWithCounts.length === 0 ? (
            <div className="tags-empty">
              <p>{t('tagsView.noTagsFound')}</p>
              <button onClick={handleSyncFromPosts}>{t('tagsView.discoverFromPosts')}</button>
            </div>
          ) : (
            <>
              <div className="tag-cloud">
                {tagsWithCounts.map(tag => (
                  <TagCloudItem
                    key={tag.name}
                    tag={tag}
                    isSelected={selectedTags.includes(tag.name)}
                    onSelect={handleTagSelect}
                    maxCount={maxCount}
                    title={t('tagsView.tagCountTitle', {
                      count: tag.count,
                      item: tag.count === 1 ? t('tagsView.postsSingular') : t('tagsView.postsPlural'),
                    })}
                  />
                ))}
              </div>
              {selectedTags.length > 0 && (
                <div className="tag-selection-info">
                  <span>{t('tagsView.selectedCount', { count: selectedTags.length })}</span>
                  <button onClick={handleClearSelection}>{t('tagsView.clearSelection')}</button>
                </div>
              )}
            </>
          )}
        </SectionHeader>

        {/* Tag Management Section */}
        <SectionHeader
          id="tags-section-manage"
          title={t('tagsView.manage.title')}
          description={t('tagsView.manage.description')}
        >
          {/* Create new tag */}
          <div className="tag-create-form">
            <h4>{t('tagsView.create.title')}</h4>
            <div className="tag-form-row">
              <input
                type="text"
                placeholder={t('tagsView.tagNamePlaceholder')}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              />
              <div className="color-picker-group">
                <input
                  type="color"
                  value={newTagColor || '#808080'}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  title={t('tagsView.chooseColor')}
                />
                {newTagColor && (
                  <button 
                    className="clear-color" 
                    onClick={() => setNewTagColor('')}
                    title={t('tagsView.removeColor')}
                  >
                    ✕
                  </button>
                )}
              </div>
              <button onClick={handleCreateTag} className="primary">{t('tagsView.create.action')}</button>
            </div>
            <div className="color-presets">
              {COLOR_PRESETS.map(color => (
                <button
                  key={color}
                  className="color-preset"
                  style={{ backgroundColor: color }}
                  onClick={() => setNewTagColor(color)}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Selected tag editor */}
          {selectedTagObjects.length === 1 && (
            <div className="tag-edit-form">
              <h4>{t('tagsView.edit.title', { name: selectedTagObjects[0].name })}</h4>
              {editingTagId === selectedTagObjects[0].id ? (
                <div className="tag-form-row">
                  <input
                    type="text"
                    value={editTagName}
                    onChange={(e) => setEditTagName(e.target.value)}
                    placeholder={t('tagsView.tagNamePlaceholder')}
                  />
                  <div className="color-picker-group">
                    <input
                      type="color"
                      value={editTagColor || '#808080'}
                      onChange={(e) => setEditTagColor(e.target.value)}
                    />
                    {editTagColor && (
                      <button 
                        className="clear-color" 
                        onClick={() => setEditTagColor('')}
                        title={t('tagsView.removeColor')}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button onClick={handleSaveEdit} className="primary">{t('common.save')}</button>
                  <button onClick={() => setEditingTagId(null)}>{t('common.cancel')}</button>
                </div>
              ) : (
                <div className="tag-form-row">
                  <span className="tag-preview" style={
                    selectedTagObjects[0].color 
                      ? { backgroundColor: selectedTagObjects[0].color, color: getContrastColor(selectedTagObjects[0].color) }
                      : {}
                  }>
                    {selectedTagObjects[0].name}
                  </span>
                  <button onClick={() => handleStartEdit(selectedTagObjects[0])}>
                    {t('tagsView.edit.action')}
                  </button>
                  <button 
                    className="danger"
                    onClick={() => setDeleteConfirm({ 
                      tagId: selectedTagObjects[0].id, 
                      tagName: selectedTagObjects[0].name 
                    })}
                  >
                    {t('tagsView.deleteAction')}
                  </button>
                </div>
              )}
            </div>
          )}
        </SectionHeader>

        {/* Merge Tags Section */}
        <SectionHeader
          id="tags-section-merge"
          title={t('tagsView.merge.title')}
          description={t('tagsView.merge.description')}
        >
          {selectedTags.length < 2 ? (
            <p className="text-muted">{t('tagsView.merge.selectAtLeastTwo')}</p>
          ) : (
            <div className="merge-form">
              <p>{t('tagsView.merge.countInto', { count: selectedTags.length })}</p>
              <div className="tag-form-row">
                <select
                  value={mergeTargetName}
                  onChange={(e) => setMergeTargetName(e.target.value)}
                >
                  <option value="">{t('tagsView.merge.selectTarget')}</option>
                  {selectedTags.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button
                  className="primary"
                  disabled={!mergeTargetName}
                  onClick={() => {
                    if (mergeTargetName) {
                      setMergeConfirm({
                        sourceNames: selectedTags.filter(n => n !== mergeTargetName),
                        targetName: mergeTargetName,
                      });
                    }
                  }}
                >
                  {t('tagsView.merge.action')}
                </button>
              </div>
              <p className="text-muted text-small">
                {t('tagsView.merge.tagsToDelete', {
                  tags: selectedTags.filter(n => n !== mergeTargetName).join(', ') || t('tagsView.none'),
                })}
              </p>
            </div>
          )}
        </SectionHeader>

        {/* Sync Section */}
        <SectionHeader
          id="tags-section-sync"
          title={t('tagsView.sync.title')}
          description={t('tagsView.sync.description')}
        >
          <button onClick={handleSyncFromPosts}>
            {t('tagsView.sync.action')}
          </button>
        </SectionHeader>
      </div>

      {/* Confirm Dialogs */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title={t('tagsView.confirmDelete.title')}
        message={t('tagsView.confirmDelete.message', { tagName: deleteConfirm?.tagName || '' })}
        confirmText={t('tagsView.confirmDelete.action')}
        cancelText={t('common.cancel')}
        isDestructive
        onConfirm={handleDeleteTag}
        onCancel={() => setDeleteConfirm(null)}
      />

      <ConfirmDialog
        isOpen={!!mergeConfirm}
        title={t('tagsView.confirmMerge.title')}
        message={t('tagsView.confirmMerge.message', {
          count: mergeConfirm?.sourceNames.length || 0,
          target: mergeConfirm?.targetName || '',
        })}
        confirmText={t('tagsView.confirmMerge.action')}
        cancelText={t('common.cancel')}
        onConfirm={handleMergeTags}
        onCancel={() => setMergeConfirm(null)}
      />
    </div>
  );
};

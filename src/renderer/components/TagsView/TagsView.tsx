import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../store';
import { showToast } from '../Toast';
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

// Get contrasting text color for background
const getContrastColor = (hex: string): string => {
  // Remove # if present
  const color = hex.replace('#', '');
  
  // Parse hex to RGB
  let r: number, g: number, b: number;
  if (color.length === 3) {
    r = parseInt(color[0] + color[0], 16);
    g = parseInt(color[1] + color[1], 16);
    b = parseInt(color[2] + color[2], 16);
  } else {
    r = parseInt(color.substring(0, 2), 16);
    g = parseInt(color.substring(2, 4), 16);
    b = parseInt(color.substring(4, 6), 16);
  }
  
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  return luminance > 0.5 ? '#000000' : '#ffffff';
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
}> = ({ tag, isSelected, onSelect, maxCount }) => {
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
      title={`${tag.count} post${tag.count !== 1 ? 's' : ''}`}
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
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      window.electronAPI?.on('tag:created', () => loadTags()) || (() => {})
    );
    unsubscribers.push(
      window.electronAPI?.on('tag:updated', () => loadTags()) || (() => {})
    );
    unsubscribers.push(
      window.electronAPI?.on('tag:deleted', () => loadTags()) || (() => {})
    );
    unsubscribers.push(
      window.electronAPI?.on('tag:renamed', () => loadTags()) || (() => {})
    );
    unsubscribers.push(
      window.electronAPI?.on('tags:merged', () => loadTags()) || (() => {})
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
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
      showToast.error('Tag name is required');
      return;
    }

    try {
      await window.electronAPI?.tags.create({
        name: newTagName.trim(),
        color: newTagColor || undefined,
      });
      setNewTagName('');
      setNewTagColor('');
      showToast.success('Tag created');
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
        showToast.success(`Tag deleted. ${result.postsUpdated} post(s) updated.`);
        setSelectedTags(prev => prev.filter(n => n !== deleteConfirm.tagName));
        loadTags();
      }
    } catch (error) {
      const err = error as Error;
      showErrorModal({
        title: 'Delete Failed',
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

      showToast.success('Tag updated');
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
        showToast.error('Target tag not found');
        return;
      }

      // Find source tag IDs
      const sourceTags = allTags.filter(t => 
        mergeConfirm.sourceNames.includes(t.name) && t.id !== targetTag.id
      );

      if (sourceTags.length === 0) {
        showToast.error('No source tags to merge');
        return;
      }

      const result = await window.electronAPI?.tags.merge(
        sourceTags.map(t => t.id),
        targetTag.id
      );

      if (result?.success) {
        showToast.success(
          `Merged ${result.tagsDeleted} tag(s) into "${result.targetTag}". ${result.postsUpdated} post(s) updated.`
        );
        setSelectedTags([]);
        setMergeTargetName('');
        loadTags();
      }
    } catch (error) {
      const err = error as Error;
      showErrorModal({
        title: 'Merge Failed',
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
          showToast.success(`Discovered ${result.added.length} new tag(s)`);
        } else {
          showToast.info('All tags are already synced');
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
        <h2>Tag Management</h2>
        <p className="text-muted">Manage your blog's tags, assign colors, and perform bulk operations.</p>
      </div>

      <div className="tags-view-content">
        {/* Tag Cloud Section */}
        <SectionHeader
          id="tags-section-cloud"
          title="Tag Cloud"
          description="Click tags to select them for bulk operations. Hover to see post counts."
        >
          {isLoading ? (
            <div className="tags-loading">Loading tags...</div>
          ) : tagsWithCounts.length === 0 ? (
            <div className="tags-empty">
              <p>No tags found</p>
              <button onClick={handleSyncFromPosts}>Discover tags from posts</button>
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
                  />
                ))}
              </div>
              {selectedTags.length > 0 && (
                <div className="tag-selection-info">
                  <span>{selectedTags.length} tag(s) selected</span>
                  <button onClick={handleClearSelection}>Clear selection</button>
                </div>
              )}
            </>
          )}
        </SectionHeader>

        {/* Tag Management Section */}
        <SectionHeader
          id="tags-section-manage"
          title="Create & Edit Tags"
          description="Create new tags or edit existing ones. Assign colors to make tags visually distinct."
        >
          {/* Create new tag */}
          <div className="tag-create-form">
            <h4>Create New Tag</h4>
            <div className="tag-form-row">
              <input
                type="text"
                placeholder="Tag name"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              />
              <div className="color-picker-group">
                <input
                  type="color"
                  value={newTagColor || '#808080'}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  title="Choose color"
                />
                {newTagColor && (
                  <button 
                    className="clear-color" 
                    onClick={() => setNewTagColor('')}
                    title="Remove color"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button onClick={handleCreateTag} className="primary">Create</button>
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
              <h4>Edit Tag: {selectedTagObjects[0].name}</h4>
              {editingTagId === selectedTagObjects[0].id ? (
                <div className="tag-form-row">
                  <input
                    type="text"
                    value={editTagName}
                    onChange={(e) => setEditTagName(e.target.value)}
                    placeholder="Tag name"
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
                        title="Remove color"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button onClick={handleSaveEdit} className="primary">Save</button>
                  <button onClick={() => setEditingTagId(null)}>Cancel</button>
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
                    Edit
                  </button>
                  <button 
                    className="danger"
                    onClick={() => setDeleteConfirm({ 
                      tagId: selectedTagObjects[0].id, 
                      tagName: selectedTagObjects[0].name 
                    })}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </SectionHeader>

        {/* Merge Tags Section */}
        <SectionHeader
          id="tags-section-merge"
          title="Merge Tags"
          description="Select multiple tags above, then merge them into a single tag. All posts will be updated."
        >
          {selectedTags.length < 2 ? (
            <p className="text-muted">Select 2 or more tags from the cloud above to merge them.</p>
          ) : (
            <div className="merge-form">
              <p>Merge <strong>{selectedTags.length}</strong> tags into:</p>
              <div className="tag-form-row">
                <select
                  value={mergeTargetName}
                  onChange={(e) => setMergeTargetName(e.target.value)}
                >
                  <option value="">Select target tag...</option>
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
                  Merge Tags
                </button>
              </div>
              <p className="text-muted text-small">
                Tags to be deleted: {selectedTags.filter(n => n !== mergeTargetName).join(', ') || '(none)'}
              </p>
            </div>
          )}
        </SectionHeader>

        {/* Sync Section */}
        <SectionHeader
          id="tags-section-sync"
          title="Sync Tags"
          description="Discover tags that exist in posts but not in the tag database."
        >
          <button onClick={handleSyncFromPosts}>
            Sync Tags from Posts
          </button>
        </SectionHeader>
      </div>

      {/* Confirm Dialogs */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title="Delete Tag"
        message={`Are you sure you want to delete the tag "${deleteConfirm?.tagName}"? This will remove it from all posts. This action runs as a background task.`}
        confirmText="Delete Tag"
        isDestructive
        onConfirm={handleDeleteTag}
        onCancel={() => setDeleteConfirm(null)}
      />

      <ConfirmDialog
        isOpen={!!mergeConfirm}
        title="Merge Tags"
        message={`Are you sure you want to merge ${mergeConfirm?.sourceNames.length} tag(s) into "${mergeConfirm?.targetName}"? The source tags will be deleted and all posts will be updated. This runs as a background task.`}
        confirmText="Merge Tags"
        onConfirm={handleMergeTags}
        onCancel={() => setMergeConfirm(null)}
      />
    </div>
  );
};

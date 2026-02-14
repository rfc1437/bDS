/**
 * LinkedMediaPanel Component
 * 
 * Displays media files linked to a post with the ability to:
 * - View linked media in a grid/list
 * - Import new media files (automatically linked to post)
 * - Unlink media files from post
 * - Reorder media files via drag and drop
 * - Link existing media to the post
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAppStore, MediaData } from '../../store';
import { showToast } from '../Toast';
import './LinkedMediaPanel.css';

/** Get display name for media: caption (truncated to 60 chars) or fallback to filename */
function getMediaDisplayName(media: MediaData): string {
  if (media.caption) {
    return media.caption.length > 60 
      ? media.caption.substring(0, 60) + '...' 
      : media.caption;
  }
  return media.originalName;
}

interface LinkedMediaPanelProps {
  postId: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const LinkedMediaPanel: React.FC<LinkedMediaPanelProps> = ({
  postId,
  collapsed = false,
  onToggleCollapse,
}) => {
  const [linkedMedia, setLinkedMedia] = useState<MediaData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaSearchQuery, setMediaSearchQuery] = useState('');
  const { media: allMedia } = useAppStore();

  // Load linked media for this post
  const loadLinkedMedia = useCallback(async () => {
    if (!postId) return;
    
    try {
      setIsLoading(true);
      const linkedData = await window.electronAPI?.postMedia.getMediaDataForPost(postId);
      // Extract media objects from link data
      setLinkedMedia((linkedData || []).map(link => link.media));
    } catch (error) {
      console.error('Failed to load linked media:', error);
    } finally {
      setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    loadLinkedMedia();
  }, [loadLinkedMedia]);

  // Listen for media link/unlink events to refresh the panel
  useEffect(() => {
    const handleLinked = (...args: unknown[]) => {
      const data = args[0] as { postId: string } | undefined;
      if (data?.postId === postId) {
        loadLinkedMedia();
      }
    };
    
    const handleUnlinked = (...args: unknown[]) => {
      const data = args[0] as { postId: string } | undefined;
      if (data?.postId === postId) {
        loadLinkedMedia();
      }
    };
    
    const unsubLinked = window.electronAPI?.on('postMedia:linked', handleLinked);
    const unsubUnlinked = window.electronAPI?.on('postMedia:unlinked', handleUnlinked);
    
    return () => {
      unsubLinked?.();
      unsubUnlinked?.();
    };
  }, [postId, loadLinkedMedia]);

  // Handle importing new media with auto-link
  const handleImportMedia = async () => {
    try {
      // Get imported media using the standard dialog
      const imported = await window.electronAPI?.media.importDialog();
      if (!imported || imported.length === 0) return;

      // Link each imported media to this post
      for (const media of imported) {
        await window.electronAPI?.postMedia.link(postId, media.id);
      }

      showToast.success(`Imported and linked ${imported.length} file(s)`);

      // Refresh the linked media list
      loadLinkedMedia();
    } catch (error) {
      console.error('Failed to import media:', error);
      showToast.error('Failed to import media');
    }
  };

  // Handle unlinking media
  const handleUnlink = async (mediaId: string) => {
    try {
      await window.electronAPI?.postMedia.unlink(postId, mediaId);
      showToast.success('Media unlinked from post');
      loadLinkedMedia();
    } catch (error) {
      console.error('Failed to unlink media:', error);
      showToast.error('Failed to unlink media');
    }
  };

  // Handle linking existing media
  const handleLinkExisting = async (mediaId: string) => {
    try {
      await window.electronAPI?.postMedia.link(postId, mediaId);
      showToast.success('Media linked to post');
      setShowMediaPicker(false);
      setMediaSearchQuery('');
      loadLinkedMedia();
    } catch (error) {
      console.error('Failed to link media:', error);
      showToast.error('Failed to link media');
    }
  };

  // Drag and drop reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    setDragOverIndex(null);

    const sourceIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (sourceIndex === targetIndex) return;

    // Build new order
    const newOrder = [...linkedMedia];
    const [removed] = newOrder.splice(sourceIndex, 1);
    newOrder.splice(targetIndex, 0, removed);

    const mediaIds = newOrder.map(m => m.id);

    try {
      await window.electronAPI?.postMedia.reorder(postId, mediaIds);
      setLinkedMedia(newOrder);
    } catch (error) {
      console.error('Failed to reorder media:', error);
      loadLinkedMedia(); // Revert on failure
    }
  };

  // Handle click on media item to open media viewer
  const handleMediaClick = (mediaId: string) => {
    useAppStore.getState().openTab({ type: 'media', id: mediaId, isTransient: true });
  };

  // Get thumbnail URL for a media item
  const getThumbnailUrl = (media: MediaData): string | null => {
    if (media.mimeType?.startsWith('image/')) {
      return `bds-media://${media.id}`;
    }
    return null;
  };

  // Get unlinked media (for picker), filtered by search
  const unlinkedMedia = allMedia.filter(
    m => !linkedMedia.find(l => l.id === m.id)
  ).filter(
    m => {
      if (!mediaSearchQuery) return true;
      const query = mediaSearchQuery.toLowerCase();
      return m.originalName.toLowerCase().includes(query) || 
             (m.caption && m.caption.toLowerCase().includes(query));
    }
  );

  if (collapsed) {
    return (
      <div className="linked-media-panel collapsed" onClick={onToggleCollapse}>
        <div className="panel-header">
          <span className="panel-title">
            📷 Media ({linkedMedia.length})
          </span>
          <span className="expand-icon">▶</span>
        </div>
      </div>
    );
  }

  return (
    <div className="linked-media-panel">
      <div className="panel-header" onClick={onToggleCollapse}>
        <span className="panel-title">📷 Linked Media</span>
        <div className="panel-actions">
          <button
            className="panel-action"
            onClick={(e) => { e.stopPropagation(); handleImportMedia(); }}
            title="Import and link media"
          >
            +
          </button>
          <button
            className="panel-action"
            onClick={(e) => { e.stopPropagation(); setShowMediaPicker(!showMediaPicker); }}
            title="Link existing media"
          >
            🔗
          </button>
          {onToggleCollapse && <span className="collapse-icon">▼</span>}
        </div>
      </div>

      {showMediaPicker && (
        <div className="media-picker">
          <div className="media-picker-header">
            <span>Select media to link</span>
            <button onClick={() => { setShowMediaPicker(false); setMediaSearchQuery(''); }}>×</button>
          </div>
          <div className="media-picker-search">
            <input
              type="text"
              placeholder="Search media..."
              value={mediaSearchQuery}
              onChange={(e) => setMediaSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="media-picker-grid">
            {unlinkedMedia.length === 0 ? (
              <div className="no-media">No unlinked media available</div>
            ) : (
              unlinkedMedia.map(media => (
                <div
                  key={media.id}
                  className="media-picker-item"
                  onClick={() => handleLinkExisting(media.id)}
                  title={media.caption || media.originalName}
                >
                  {media.mimeType?.startsWith('image/') ? (
                    <img src={`bds-media://${media.id}`} alt={media.alt || media.originalName} />
                  ) : (
                    <div className="media-icon">📄</div>
                  )}
                  <span className="media-name">{getMediaDisplayName(media)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="panel-content">
        {isLoading ? (
          <div className="loading">Loading...</div>
        ) : linkedMedia.length === 0 ? (
          <div className="empty-state">
            <p>No media linked to this post</p>
            <button onClick={handleImportMedia}>Import Media</button>
          </div>
        ) : (
          <div className="media-list">
            {linkedMedia.map((media, index) => (
              <div
                key={media.id}
                className={`media-item ${dragOverIndex === index ? 'drag-over' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
              >
                <div className="media-order">{index + 1}</div>
                <div 
                  className="media-thumbnail"
                  onClick={() => handleMediaClick(media.id)}
                >
                  {getThumbnailUrl(media) ? (
                    <img src={getThumbnailUrl(media)!} alt={media.originalName} />
                  ) : (
                    <div className="media-icon">📄</div>
                  )}
                </div>
                <span className="media-name" title={media.caption || media.originalName}>
                  {getMediaDisplayName(media)}
                </span>
                <button
                  className="unlink-btn"
                  onClick={(e) => { e.stopPropagation(); handleUnlink(media.id); }}
                  title="Unlink from post"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkedMediaPanel;

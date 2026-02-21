import React, { useState, useEffect } from 'react';
import { useI18n } from '../../i18n';
import './PostLinks.css';

interface PostLinkInfo {
  id: string;
  title: string;
  slug: string;
}

interface PostLinksProps {
  postId: string;
  onPostClick?: (postId: string) => void;
  updatedAt?: string; // Trigger reload when post is saved
}

export const PostLinks: React.FC<PostLinksProps> = ({ postId, onPostClick, updatedAt }) => {
  const { t: tr } = useI18n();
  const [linksTo, setLinksTo] = useState<PostLinkInfo[]>([]);
  const [linkedBy, setLinkedBy] = useState<PostLinkInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const loadLinks = async () => {
      setLoading(true);
      try {
        const [to, by] = await Promise.all([
          window.electronAPI?.posts.getLinksTo(postId),
          window.electronAPI?.posts.getLinkedBy(postId),
        ]);
        setLinksTo(to || []);
        setLinkedBy(by || []);
      } catch (error) {
        console.error('Failed to load post links:', error);
      } finally {
        setLoading(false);
      }
    };

    loadLinks();
  }, [postId, updatedAt]); // Reload when post is updated

  const totalLinks = linksTo.length + linkedBy.length;

  if (loading) {
    return (
      <div className="post-links">
        <div className="post-links-loading">{tr('postLinks.loading')}</div>
      </div>
    );
  }

  if (totalLinks === 0) {
    return null;
  }

  return (
    <div className="post-links">
      <button 
        className={`post-links-toggle ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="post-links-icon">🔗</span>
        <span className="post-links-count">{totalLinks} {totalLinks !== 1 ? tr('postLinks.links') : tr('postLinks.link')}</span>
        <span className="post-links-chevron">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="post-links-content">
          {linksTo.length > 0 && (
            <div className="post-links-section">
              <h4 className="post-links-heading">
                <span className="post-links-arrow">→</span>
                {tr('postLinks.linksTo', { count: linksTo.length })}
              </h4>
              <ul className="post-links-list">
                {linksTo.map(link => (
                  <li key={link.id}>
                    <button
                      className="post-link-item"
                      onClick={() => onPostClick?.(link.id)}
                      title={tr('postLinks.openTitle', { title: link.title })}
                    >
                      {link.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {linkedBy.length > 0 && (
            <div className="post-links-section">
              <h4 className="post-links-heading">
                <span className="post-links-arrow">←</span>
                {tr('postLinks.linkedBy', { count: linkedBy.length })}
              </h4>
              <ul className="post-links-list">
                {linkedBy.map(link => (
                  <li key={link.id}>
                    <button
                      className="post-link-item"
                      onClick={() => onPostClick?.(link.id)}
                      title={tr('postLinks.openTitle', { title: link.title })}
                    >
                      {link.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PostLinks;

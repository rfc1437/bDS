/**
 * InlineSurface component.
 *
 * Wraps A2UIRenderer with expand/collapse and dismiss controls.
 * Renders inline within the chat transcript, anchored to the
 * assistant message turn that created the surface.
 */

import React, { useEffect, useState } from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../main/a2ui/types';
import { A2UIRenderer } from './A2UIRenderer';
import './InlineSurface.css';

interface InlineSurfaceProps {
  surfaceId: string;
  tree: A2UIResolvedComponent[];
  isExpanded: boolean;
  onDismiss?: (surfaceId: string) => void;
  onAction?: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
}

/**
 * Derive a display title from the surface's component tree.
 * Tries the root component's `title` or `label` property,
 * then falls back to the capitalized component type.
 */
export function deriveSurfaceTitle(tree: A2UIResolvedComponent[]): string {
  if (tree.length === 0) {
    return 'Surface';
  }
  const root = tree[0];
  const title = root.properties?.title as string | undefined;
  if (title) {
    return title;
  }
  const label = root.properties?.label as string | undefined;
  if (label) {
    return label;
  }
  return root.type.charAt(0).toUpperCase() + root.type.slice(1);
}

/**
 * Get an icon character for the surface based on the root component type.
 */
export function getSurfaceIcon(tree: A2UIResolvedComponent[]): string {
  if (tree.length === 0) {
    return '\u25A0';
  }
  const type = tree[0].type;
  const icons: Record<string, string> = {
    chart: '\u{1F4CA}',
    table: '\u{1F4CB}',
    form: '\u{1F4DD}',
    card: '\u{1F4C4}',
    metric: '\u{1F4CF}',
    list: '\u{1F4CB}',
    tabs: '\u{1F4C2}',
  };
  return icons[type] || '\u25A0';
}

export const InlineSurface: React.FC<InlineSurfaceProps> = ({
  surfaceId,
  tree,
  isExpanded: defaultExpanded,
  onDismiss,
  onAction,
  onDataChange,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Auto-collapse/expand when the parent changes which surface is latest
  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const surfaceTitle = deriveSurfaceTitle(tree);
  const surfaceIcon = getSurfaceIcon(tree);

  if (!expanded) {
    return (
      <div
        className="inline-surface collapsed"
        onClick={() => setExpanded(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setExpanded(true);
          }
        }}
      >
        <span className="inline-surface-icon">{surfaceIcon}</span>
        <span className="inline-surface-title">{surfaceTitle}</span>
        <button
          className="inline-surface-expand"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          aria-label="Expand surface"
        >
          {'\u25B6'}
        </button>
        {onDismiss && (
          <button
            className="inline-surface-dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(surfaceId);
            }}
            aria-label="Dismiss surface"
          >
            {'\u2715'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="inline-surface expanded">
      <div className="inline-surface-header">
        <span className="inline-surface-icon">{surfaceIcon}</span>
        <span className="inline-surface-title">{surfaceTitle}</span>
        <button
          className="inline-surface-collapse"
          onClick={() => setExpanded(false)}
          aria-label="Collapse surface"
        >
          {'\u25BC'}
        </button>
        {onDismiss && (
          <button
            className="inline-surface-dismiss"
            onClick={() => onDismiss(surfaceId)}
            aria-label="Dismiss surface"
          >
            {'\u2715'}
          </button>
        )}
      </div>
      <A2UIRenderer
        surfaceId={surfaceId}
        tree={tree}
        onAction={onAction!}
        onDataChange={onDataChange}
      />
    </div>
  );
};

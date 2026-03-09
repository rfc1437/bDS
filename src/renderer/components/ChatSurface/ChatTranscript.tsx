import React, { type ReactElement } from 'react';
import Markdown from 'marked-react';
import type { ChatMessage } from '../../types/electron';
import type { ChatToolEvent } from '../../navigation/useChatSurfaceState';
import type { A2UIClientAction } from '../../../main/a2ui/types';
import { InlineSurface } from '../../a2ui/InlineSurface';
import type { SurfaceEntry } from '../../a2ui/useA2UISurface';
import { computeTurnIndex } from '../../a2ui/surfaceAssociation';

interface ChatTranscriptProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  toolEvents: ChatToolEvent[];
  assistantRoleLabel: string;
  userRoleLabel: string;
  showToolMarkers?: boolean;
  endRef?: React.RefObject<HTMLDivElement | null>;
  /** Surfaces grouped by the turn index that created them */
  surfacesByTurn?: Map<number, SurfaceEntry[]>;
  /** The surfaceId of the most recently created surface */
  latestSurfaceId?: string | null;
  /** Set of surface IDs the user has dismissed */
  dismissedSurfaceIds?: Set<string>;
  /** Callback to dismiss a surface */
  onSurfaceDismiss?: (surfaceId: string) => void;
  /** Callback for surface actions */
  onSurfaceAction?: (action: A2UIClientAction) => void;
  /** Callback for surface data changes */
  onSurfaceDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  /** The current streaming turn index */
  currentTurnIndex?: number;
}

export const ChatTranscript: React.FC<ChatTranscriptProps> = ({
  messages,
  isStreaming,
  streamingContent,
  toolEvents,
  assistantRoleLabel,
  userRoleLabel,
  showToolMarkers = true,
  endRef,
  surfacesByTurn,
  latestSurfaceId,
  dismissedSurfaceIds,
  onSurfaceDismiss,
  onSurfaceAction,
  onSurfaceDataChange,
  currentTurnIndex,
}) => {
  // Block external images — CSP only allows self/data/file/blob/bds-media/bds-thumb
  const safeRenderer = {
    image(src: string, alt: string, _title?: string | null): ReactElement {
      if (/^https?:\/\//i.test(src)) {
        // Show alt text as a link instead of trying to load the image
        return <a href={src} key={src} title={alt}>{alt || src}</a>;
      }
      return <img src={src} alt={alt} key={src} />;
    },
  };

  const renderToolMarkers = (events: ChatToolEvent[]) => {
    if (events.length === 0) {
      return null;
    }

    const markers: Array<{ name: string; args?: unknown; completed: boolean }> = [];

    for (const event of events) {
      if (event.type === 'call') {
        markers.push({ name: event.name, args: event.args, completed: false });
      } else if (event.type === 'result') {
        for (let markerIndex = markers.length - 1; markerIndex >= 0; markerIndex -= 1) {
          if (markers[markerIndex].name === event.name && !markers[markerIndex].completed) {
            markers[markerIndex].completed = true;
            break;
          }
        }
      }
    }

    return (
      <div className="tool-markers">
        {markers.map((marker, index) => {
          const argsPreview = marker.args
            ? Object.entries(marker.args as Record<string, unknown>)
                .map(([key, value]) => `${key}: ${typeof value === 'string' ? `"${value.length > 30 ? value.slice(0, 30) + '...' : value}"` : JSON.stringify(value)}`)
                .join(', ')
            : '';

          return (
            <div key={`${marker.name}-${index}`} className={`tool-marker ${marker.completed ? 'completed' : 'pending'}`}>
              <span className="tool-marker-icon">{marker.completed ? '\u2713' : '\u25CF'}</span>
              <span className="tool-marker-name">{marker.name}</span>
              {argsPreview && <span className="tool-marker-args">({argsPreview})</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const renderInlineSurfaces = (turnIndex: number) => {
    if (!surfacesByTurn?.has(turnIndex)) {
      return null;
    }

    const turnSurfaces = surfacesByTurn.get(turnIndex)!;
    const visibleSurfaces = turnSurfaces.filter(
      (s) => !dismissedSurfaceIds?.has(s.surfaceId),
    );

    if (visibleSurfaces.length === 0) {
      return null;
    }

    return visibleSurfaces.map((surface) => (
      <InlineSurface
        key={surface.surfaceId}
        surfaceId={surface.surfaceId}
        tree={surface.tree}
        isExpanded={surface.surfaceId === latestSurfaceId}
        onDismiss={onSurfaceDismiss}
        onAction={onSurfaceAction}
        onDataChange={onSurfaceDataChange}
      />
    ));
  };

  const renderMessage = (message: ChatMessage, messageIndex: number) => {
    if (message.role === 'system' || message.role === 'tool') {
      return null;
    }

    const storedToolCalls: Array<{ name: string; args?: unknown; completed: boolean }> = [];
    if (message.role === 'assistant' && message.toolCalls) {
      try {
        const parsedToolCalls = JSON.parse(message.toolCalls) as Array<{ name: string; args?: unknown }>;
        parsedToolCalls.forEach((toolCall) => storedToolCalls.push({ name: toolCall.name, args: toolCall.args, completed: true }));
      } catch {
        // no-op
      }
    }

    const messageEl = (
      <div key={message.id} className={`chat-message ${message.role}`}>
        <div className="chat-message-avatar">
          {message.role === 'user' ? '\u{1F464}' : '\u{1F916}'}
        </div>
        <div className="chat-message-content">
          <div className="chat-message-header">
            <span className="chat-message-role">{message.role === 'user' ? userRoleLabel : assistantRoleLabel}</span>
          </div>
          {showToolMarkers && storedToolCalls.length > 0 && (
            <div className="tool-markers">
              {storedToolCalls.map((marker, markerIndex) => {
                const argsPreview = marker.args
                  ? Object.entries(marker.args as Record<string, unknown>)
                      .map(([key, value]) => `${key}: ${typeof value === 'string' ? `"${value.length > 30 ? value.slice(0, 30) + '...' : value}"` : JSON.stringify(value)}`)
                      .join(', ')
                  : '';
                return (
                  <div key={`${marker.name}-${markerIndex}`} className="tool-marker completed">
                    <span className="tool-marker-icon">{'\u2713'}</span>
                    <span className="tool-marker-name">{marker.name}</span>
                    {argsPreview && <span className="tool-marker-args">({argsPreview})</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="chat-message-text">
            {message.role === 'assistant' ? <Markdown gfm renderer={safeRenderer}>{message.content}</Markdown> : message.content}
          </div>
        </div>
      </div>
    );

    // After an assistant message, render any inline surfaces for this turn
    if (message.role === 'assistant' && surfacesByTurn) {
      const turnIndex = computeTurnIndex(messages, messageIndex);
      const inlineSurfaces = renderInlineSurfaces(turnIndex);
      if (inlineSurfaces) {
        return (
          <React.Fragment key={message.id}>
            {messageEl}
            {inlineSurfaces}
          </React.Fragment>
        );
      }
    }

    return messageEl;
  };

  return (
    <>
      {messages.map((message, index) => renderMessage(message, index))}

      {isStreaming && (streamingContent || (showToolMarkers && toolEvents.length > 0)) && (
        <>
          <div className="chat-message assistant streaming">
            <div className="chat-message-avatar">{'\u{1F916}'}</div>
            <div className="chat-message-content">
              <div className="chat-message-header">
                <span className="chat-message-role">{assistantRoleLabel}</span>
                <span className="streaming-indicator">{'\u25CF'}</span>
              </div>
              {showToolMarkers ? renderToolMarkers(toolEvents) : null}
              {streamingContent && (
                <div className="chat-message-text">
                  <Markdown gfm renderer={safeRenderer}>{streamingContent}</Markdown>
                </div>
              )}
            </div>
          </div>
          {currentTurnIndex !== undefined && renderInlineSurfaces(currentTurnIndex)}
        </>
      )}

      {isStreaming && !streamingContent && (!showToolMarkers || toolEvents.length === 0) && (
        <div className="chat-message assistant thinking">
          <div className="chat-message-avatar">{'\u{1F916}'}</div>
          <div className="chat-message-content">
            <div className="chat-thinking-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </>
  );
};

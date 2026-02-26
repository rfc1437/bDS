import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store';
import { resolveAssistantEditorContext } from '../../navigation/assistantPromptContext';
import { planAssistantRequest } from '../../navigation/assistantConversation';
import { dispatchAssistantAction } from '../../navigation/assistantActionDispatcher';
import { ensureConversationId } from '../../navigation/chatSession';
import { getChatSurfaceMode } from '../../navigation/chatSurfaceMode';
import { useChatMessageSender } from '../../navigation/useChatMessageSender';
import { useChatSurfaceState } from '../../navigation/useChatSurfaceState';
import { useA2UISurface } from '../../a2ui/useA2UISurface';
import { ChatTranscript } from '../ChatSurface';
import { useI18n } from '../../i18n';
import '../../styles/chatSurface.css';
import './AssistantSidebar.css';

export const AssistantSidebar: React.FC = () => {
  const { t: tr } = useI18n();
  const surfaceMode = getChatSurfaceMode('sidebar');
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    tabs,
    activeTabId,
    posts,
    media,
    setSelectedPost,
    setSelectedMedia,
    openTab,
    setActiveView,
    toggleSidebar,
    togglePanel,
    toggleAssistantSidebar,
  } = useAppStore();
  const { sendMessage: sendChatMessage } = useChatMessageSender({
    chatService: window.electronAPI?.chat,
  });
  const {
    messages,
    isStreaming,
    streamingContent,
    toolEvents,
    beginUserTurn,
    appendStreamDelta,
    recordToolCall,
    recordToolResult,
    finalizeAssistantTurn,
    appendAssistantMessage,
    stopStreaming,
    getStreamingContent,
  } = useChatSurfaceState();

  // A2UI surface rendering
  const {
    surfacesByTurn,
    latestSurfaceId,
    dismissedSurfaceIds,
    dismissSurface,
    updateLocalData,
  } = useA2UISurface({ conversationId });

  // Current turn index for associating streaming surfaces
  const currentTurnIndex = useMemo(() => {
    return messages.filter(m => m.role === 'user').length - 1;
  }, [messages]);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [tabs, activeTabId]);

  const editorContext = useMemo(
    () => resolveAssistantEditorContext({ activeTab, posts, media }),
    [activeTab, posts, media],
  );

  const contextSummary = useMemo(() => {
    if (!editorContext) {
      return tr('assistantSidebar.context.none');
    }

    const title = editorContext.title ? ` • ${editorContext.title}` : '';
    const id = editorContext.id ? ` (${editorContext.id})` : '';
    return `${editorContext.tabType}${id}${title}`;
  }, [editorContext, tr]);

  const persistActionEvent = async (message: string) => {
    if (!conversationId) {
      return;
    }

    try {
      await window.electronAPI?.chat.addSystemEvent(conversationId, message);
    } catch (error) {
      console.error('Failed to persist assistant action event:', error);
    }
  };

  useEffect(() => {
    const unsubDelta = window.electronAPI?.chat.onStreamDelta((data) => {
      if (data.conversationId === conversationId) {
        appendStreamDelta(data.delta);
      }
    });

    const unsubToolCall = window.electronAPI?.chat.onToolCall((data) => {
      if (data.conversationId === conversationId) {
        const toolCall = data.toolCall as { name: string; arguments: Record<string, unknown> };
        recordToolCall(toolCall.name, toolCall.arguments);
      }
    });

    const unsubToolResult = window.electronAPI?.chat.onToolResult((data) => {
      if (data.conversationId === conversationId) {
        const result = data.result as { name: string; result: unknown };
        recordToolResult(result.name);
      }
    });

    const unsubTitle = window.electronAPI?.chat.onTitleUpdated((data) => {
      if (data.conversationId === conversationId) {
        return;
      }
    });

    const unsubTokenUsage = window.electronAPI?.chat.onTokenUsage((data) => {
      if (data.conversationId === conversationId) {
        useAppStore.getState().setChatTokenUsage(conversationId, {
          inputTokens: data.cumulativeInputTokens,
          outputTokens: data.cumulativeOutputTokens,
          cacheReadTokens: data.cumulativeCacheReadTokens,
          cacheWriteTokens: data.cumulativeCacheWriteTokens,
          totalTokens: data.cumulativeTotalTokens,
        });
      }
    });

    return () => {
      unsubDelta?.();
      unsubToolCall?.();
      unsubToolResult?.();
      unsubTitle?.();
      unsubTokenUsage?.();
    };
  }, [conversationId, appendStreamDelta, recordToolCall, recordToolResult]);

  const handleStart = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const chatService = window.electronAPI?.chat;
      if (!chatService) {
        throw new Error('Chat service unavailable');
      }

      const resolvedConversationId = await ensureConversationId({
        currentConversationId: conversationId,
        createTitle: tr('assistantSidebar.conversationTitle'),
        chatService,
      });

      if (!conversationId) {
        setConversationId(resolvedConversationId);
      }

      const requestPlan = planAssistantRequest({
        conversationId,
        userPrompt: trimmed,
        context: editorContext,
      });

      beginUserTurn(resolvedConversationId, trimmed);

      const sendResult = await sendChatMessage({
        conversationId: resolvedConversationId,
        message: requestPlan.outboundMessage,
        metadata: { surface: 'sidebar' },
      });

      if (!sendResult.success) {
        appendAssistantMessage(
          resolvedConversationId,
          tr('chat.errorPrefix', { error: sendResult.error || tr('chat.errorNoResponse') }),
        );
        stopStreaming();
        throw new Error(sendResult.error || 'Failed to send assistant message');
      }

      const assistantContent = getStreamingContent() || sendResult.message;
      if (assistantContent) {
        finalizeAssistantTurn(resolvedConversationId, assistantContent);
      } else {
        appendAssistantMessage(resolvedConversationId, tr('chat.errorEmptyResponse'));
        stopStreaming();
      }

      setPrompt('');
    } catch (error) {
      console.error('Failed to start assistant conversation:', error);
      setErrorMessage(tr('assistantSidebar.error.startFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAssistantAction = (action: string, payload?: Record<string, unknown>) => {
    const result = dispatchAssistantAction(
      {
        action,
        payload,
      },
      {
        setSelectedPost,
        setSelectedMedia,
        openTab,
        setActiveView,
        toggleSidebar,
        togglePanel,
        toggleAssistantSidebar,
      },
    );

    if (!result.handled) {
      setActionError(result.error || tr('assistantSidebar.error.actionFailed'));
      void persistActionEvent(
        `Assistant action failed: ${action}${result.error ? ` (${result.error})` : ''}`,
      );
      return;
    }

    setActionError(null);
    void persistActionEvent(
      `Assistant action executed: ${action}${payload ? ` ${JSON.stringify(payload)}` : ''}`,
    );
  };

  return (
    <div className="assistant-sidebar chat-surface">
      <div className="assistant-sidebar-header">
        <h3>{tr('assistantSidebar.title')}</h3>
        <p>{tr('assistantSidebar.description')}</p>
      </div>

      <div className="assistant-sidebar-context chat-surface-section">
        <span className="assistant-sidebar-context-label">{tr('assistantSidebar.context.label')}</span>
        <span className="assistant-sidebar-context-value">{contextSummary}</span>
      </div>

      <textarea
        className="assistant-sidebar-prompt chat-surface-input"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={tr('assistantSidebar.prompt.placeholder')}
        rows={6}
      />

      <button
        type="button"
        className="assistant-sidebar-start-button"
        disabled={isSubmitting}
        onClick={() => void handleStart()}
      >
        {isSubmitting ? tr('assistantSidebar.button.starting') : tr('assistantSidebar.button.start')}
      </button>

      {errorMessage && <p className="assistant-sidebar-error chat-surface-error">{errorMessage}</p>}

      {actionError && <p className="assistant-sidebar-error chat-surface-error">{actionError}</p>}

      {surfaceMode.showWelcomeTips && messages.filter(m => m.role !== 'system' && m.role !== 'tool').length === 0 && !isStreaming && (
        <div className="assistant-sidebar-raw-message chat-surface-section">
          {tr('chat.welcomeDescription')}
        </div>
      )}

      {messages.length > 0 && (
        <div className="assistant-sidebar-raw-message chat-surface-section">
          <ChatTranscript
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
            toolEvents={toolEvents}
            assistantRoleLabel={tr('chat.role.assistant')}
            userRoleLabel={tr('chat.role.you')}
            showToolMarkers={surfaceMode.showToolMarkers}
            surfacesByTurn={surfacesByTurn}
            latestSurfaceId={latestSurfaceId}
            dismissedSurfaceIds={dismissedSurfaceIds}
            onSurfaceDismiss={dismissSurface}
            onSurfaceAction={(a) => handleAssistantAction(a.action, a.payload)}
            onSurfaceDataChange={updateLocalData}
            currentTurnIndex={currentTurnIndex}
          />
        </div>
      )}
    </div>
  );
};

export default AssistantSidebar;

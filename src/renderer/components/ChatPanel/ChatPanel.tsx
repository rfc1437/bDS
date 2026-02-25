import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatConversation, ChatModel } from '../../types/electron';
import { useChatMessageSender } from '../../navigation/useChatMessageSender';
import { useChatSurfaceState } from '../../navigation/useChatSurfaceState';
import { getChatSurfaceMode } from '../../navigation/chatSurfaceMode';
import { dispatchAssistantAction } from '../../navigation/assistantActionDispatcher';
import { extractAssistantResponseContent, type AssistantPanelElement } from '../../navigation/assistantPanelSpec';
import { useAppStore } from '../../store';
import { ChatTranscript } from '../ChatSurface';
import { AssistantPanelControls } from '../AssistantPanelControls';
import { useI18n } from '../../i18n';
import '../../styles/chatSurface.css';
import './ChatPanel.css';

interface ChatPanelProps {
  conversationId: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ conversationId }) => {
  const { t: tr } = useI18n();
  const surfaceMode = getChatSurfaceMode('tab');
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [panelElements, setPanelElements] = useState<AssistantPanelElement[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
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
    setMessages,
    beginUserTurn,
    appendStreamDelta,
    recordToolCall,
    recordToolResult,
    appendAssistantMessage,
    finalizeAssistantTurn,
    stopStreaming,
    abortStreaming,
    getStreamingContent,
  } = useChatSurfaceState();

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Check if service is ready
  const checkReady = useCallback(async () => {
    try {
      const status = await window.electronAPI?.chat.checkReady();
      if (!status?.ready) {
        setNeedsApiKey(true);
      } else {
        setNeedsApiKey(false);
      }
    } catch {
      setNeedsApiKey(true);
    }
  }, []);

  // Load conversation and messages
  const loadData = useCallback(async () => {
    try {
      const [conv, msgs, modelsResult] = await Promise.all([
        window.electronAPI?.chat.getConversation(conversationId),
        window.electronAPI?.chat.getHistory(conversationId),
        window.electronAPI?.chat.getAvailableModels()
      ]);

      if (conv) setConversation(conv);
      if (msgs) setMessages(msgs);
      if (modelsResult?.models) setAvailableModels(modelsResult.models);
    } catch (error) {
      console.error('Failed to load chat data:', error);
    }
  }, [conversationId]);

  useEffect(() => {
    checkReady();
    loadData();

    // Subscribe to stream events
    const unsubDelta = window.electronAPI?.chat.onStreamDelta((data) => {
      if (data.conversationId === conversationId) {
        appendStreamDelta(data.delta);
        scrollToBottom();
      }
    });

    const unsubToolCall = window.electronAPI?.chat.onToolCall((data) => {
      console.log('[ChatPanel] Tool call received:', data);
      if (data.conversationId === conversationId) {
        const toolCall = data.toolCall as { name: string; arguments: Record<string, unknown> };
        recordToolCall(toolCall.name, toolCall.arguments);
        scrollToBottom();
      }
    });

    const unsubToolResult = window.electronAPI?.chat.onToolResult((data) => {
      console.log('[ChatPanel] Tool result received:', data);
      if (data.conversationId === conversationId) {
        const result = data.result as { name: string; result: unknown };
        recordToolResult(result.name);
        scrollToBottom();
      }
    });

    const unsubTitle = window.electronAPI?.chat.onTitleUpdated((data) => {
      if (data.conversationId === conversationId) {
        setConversation(prev => prev ? { ...prev, title: data.title } : null);
      }
    });

    return () => {
      unsubDelta?.();
      unsubToolCall?.();
      unsubToolResult?.();
      unsubTitle?.();
    };
  }, [conversationId, loadData, scrollToBottom, checkReady, appendStreamDelta, recordToolCall, recordToolResult]);

  // Scroll on new messages or streaming content
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const handleApiKeySubmit = async () => {
    if (!apiKeyInput.trim()) return;

    setIsValidating(true);
    setApiKeyError('');

    try {
      const result = await window.electronAPI?.chat.validateApiKey(apiKeyInput.trim());
      if (result?.isValid) {
        await window.electronAPI?.chat.setApiKey(apiKeyInput.trim());
        setNeedsApiKey(false);
        setApiKeyInput('');
        loadData();
      } else {
        setApiKeyError(tr('chat.apiKeyInvalid'));
      }
    } catch {
      setApiKeyError(tr('chat.apiKeyValidationFailed'));
    } finally {
      setIsValidating(false);
    }
  };

  const handleSend = async () => {
    const message = inputValue.trim();
    if (!message || isStreaming) return;

    setInputValue('');
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    beginUserTurn(conversationId, message);

    try {
      const result = await sendChatMessage({
        conversationId,
        message,
        metadata: { surface: 'tab' },
      });

      // Use the streamed content we accumulated via onStreamDelta
      // Fall back to the backend result message if streaming didn't capture the content
      const assistantContent = getStreamingContent() || (result.success ? result.message : '');

      if (assistantContent) {
        const parsedResponse = extractAssistantResponseContent(assistantContent);
        finalizeAssistantTurn(conversationId, parsedResponse.displayText);
        setPanelElements(parsedResponse.panelSpec?.elements ?? []);
      } else if (!result.success) {
        // Backend returned an error (API failure, model unavailable, etc.)
        appendAssistantMessage(conversationId, tr('chat.errorPrefix', { error: result.error || tr('chat.errorNoResponse') }));
        stopStreaming();
        setPanelElements([]);
      } else {
        // No content from streaming AND no error, but also no success message
        // This can happen with some models that don't return content properly
        appendAssistantMessage(conversationId, tr('chat.errorEmptyResponse'));
        stopStreaming();
        setPanelElements([]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      appendAssistantMessage(conversationId, tr('chat.errorGeneric'));
      stopStreaming();
      setPanelElements([]);
    } finally {
      if (isStreaming) {
        stopStreaming();
      }
    }
  };

  const persistActionEvent = async (message: string) => {
    try {
      await window.electronAPI?.chat.addSystemEvent(conversationId, message);
    } catch (error) {
      console.error('Failed to persist chat action event:', error);
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
      void persistActionEvent(`Assistant action failed: ${action}${result.error ? ` (${result.error})` : ''}`);
      return;
    }

    setActionError(null);
    void persistActionEvent(`Assistant action executed: ${action}${payload ? ` ${JSON.stringify(payload)}` : ''}`);
  };

  const handleModelChange = async (modelId: string) => {
    try {
      await window.electronAPI?.chat.setConversationModel(conversationId, modelId);
      setConversation((previous) => (previous ? { ...previous, model: modelId } : null));
      setShowModelSelector(false);
    } catch (error) {
      console.error('Failed to change model:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAbort = async () => {
    try {
      await window.electronAPI?.chat.abortMessage(conversationId);
    } catch (error) {
      console.error('Failed to abort:', error);
    } finally {
      abortStreaming(conversationId, tr('chat.cancelledSuffix'));
    }
  };

  // API key setup screen
  if (needsApiKey) {
    return (
      <div className="chat-panel chat-surface">
        <div className="chat-panel-header">
          <div className="chat-panel-title">{tr('chat.setupTitle')}</div>
        </div>
        <div className="chat-messages chat-surface-scroll">
          <div className="chat-welcome">
            <div className="chat-welcome-icon">{'\u{1F511}'}</div>
            <h2>{tr('chat.apiKeyRequiredTitle')}</h2>
            <p>{tr('chat.apiKeyRequiredDescription')}</p>
            <div className="api-key-form">
              <input
                type="password"
                className="api-key-input"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
                placeholder={tr('chat.apiKeyPlaceholder')}
                disabled={isValidating}
              />
              <button
                className="api-key-submit"
                onClick={handleApiKeySubmit}
                disabled={!apiKeyInput.trim() || isValidating}
              >
                {isValidating ? tr('chat.apiKeyValidating') : tr('chat.apiKeySave')}
              </button>
              {apiKeyError && <div className="api-key-error">{apiKeyError}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel chat-surface">
      <div className="chat-panel-header">
        <div className="chat-panel-title">
          {conversation?.title || tr('chat.newChat')}
        </div>
        {surfaceMode.showModelSelector && (
          <div className="chat-panel-model">
            <button
              className="model-selector-button"
              onClick={() => setShowModelSelector(!showModelSelector)}
            >
              {conversation?.model || 'claude-sonnet-4'}
              <span className="model-dropdown-icon">{'\u25BE'}</span>
            </button>
            {showModelSelector && (
              <div className="model-dropdown">
                {availableModels.map(model => (
                  <button
                    key={model.id}
                    className={`model-option ${conversation?.model === model.id ? 'active' : ''}`}
                    onClick={() => handleModelChange(model.id)}
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chat-messages chat-surface-scroll">
        {surfaceMode.showWelcomeTips && messages.length === 0 && !isStreaming && (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">{'\u{1F916}'}</div>
            <h2>{tr('chat.welcomeTitle')}</h2>
            <p>{tr('chat.welcomeDescription')}</p>
            <ul>
              <li>{tr('chat.welcomeTipSearch')}</li>
              <li>{tr('chat.welcomeTipDetails')}</li>
              <li>{tr('chat.welcomeTipTags')}</li>
              <li>{tr('chat.welcomeTipMetadata')}</li>
              <li>{tr('chat.welcomeTipImages')}</li>
            </ul>
          </div>
        )}

        <ChatTranscript
          messages={messages}
          isStreaming={isStreaming}
          streamingContent={streamingContent}
          toolEvents={toolEvents}
          assistantRoleLabel={tr('chat.role.assistant')}
          userRoleLabel={tr('chat.role.you')}
          showToolMarkers={surfaceMode.showToolMarkers}
          endRef={messagesEndRef}
        />

        {panelElements.length > 0 && (
          <AssistantPanelControls elements={panelElements} onAction={handleAssistantAction} />
        )}

        {actionError && <p className="chat-surface-error">{actionError}</p>}
      </div>

      <div className="chat-input-container">
        {isStreaming && (
          <button className="chat-abort-button" onClick={handleAbort}>
            {'\u25FC'} {tr('chat.stop')}
          </button>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input chat-surface-input"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              // Auto-grow the textarea
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={tr('chat.inputPlaceholder')}
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="chat-send-button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isStreaming}
          >
            {'\u2191'}
          </button>
        </div>
      </div>
    </div>
  );
};

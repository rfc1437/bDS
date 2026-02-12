import React, { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'marked-react';
import type { ChatMessage, ChatConversation, ChatModel } from '../../types/electron';
import './ChatPanel.css';

interface ChatPanelProps {
  conversationId: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ conversationId }) => {
  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolEvents, setToolEvents] = useState<Array<{ type: 'call' | 'result'; name: string; args?: unknown; timestamp: number }>>([]);
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingRef = useRef('');
  const toolEventsRef = useRef<Array<{ name: string; args?: unknown }>>([]);

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
        streamingRef.current += data.delta;
        setStreamingContent(streamingRef.current);
        scrollToBottom();
      }
    });

    const unsubToolCall = window.electronAPI?.chat.onToolCall((data) => {
      console.log('[ChatPanel] Tool call received:', data);
      if (data.conversationId === conversationId) {
        const toolCall = data.toolCall as { name: string; arguments: Record<string, unknown> };
        toolEventsRef.current.push({ name: toolCall.name, args: toolCall.arguments });
        setToolEvents(prev => [...prev, { type: 'call', name: toolCall.name, args: toolCall.arguments, timestamp: Date.now() }]);
        scrollToBottom();
      }
    });

    const unsubToolResult = window.electronAPI?.chat.onToolResult((data) => {
      console.log('[ChatPanel] Tool result received:', data);
      if (data.conversationId === conversationId) {
        const result = data.result as { name: string; result: unknown };
        setToolEvents(prev => [...prev, { type: 'result', name: result.name, timestamp: Date.now() }]);
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
  }, [conversationId, loadData, scrollToBottom, checkReady]);

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
        setApiKeyError('Invalid API key. Please check and try again.');
      }
    } catch {
      setApiKeyError('Failed to validate API key.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSend = async () => {
    const message = inputValue.trim();
    if (!message || isStreaming) return;

    setInputValue('');
    setIsStreaming(true);
    streamingRef.current = '';
    setStreamingContent('');
    setToolEvents([]);
    toolEventsRef.current = [];

    // Add user message optimistically
    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId,
      role: 'user',
      content: message,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      // Send message and wait for complete response
      const result = await window.electronAPI?.chat.sendMessage(conversationId, message);

      // Use the streamed content we accumulated via onStreamDelta
      // Fall back to the backend result message if streaming didn't capture the content
      const assistantContent = streamingRef.current || (result?.success ? result.message : '');

      if (assistantContent) {
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          conversationId,
          role: 'assistant',
          content: assistantContent,
          toolCalls: toolEventsRef.current.length > 0 ? JSON.stringify(toolEventsRef.current) : undefined,
          createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else if (result && !result.success) {
        // Backend returned an error (API failure, model unavailable, etc.)
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          conversationId,
          role: 'assistant',
          content: `Error: ${result.error || 'Failed to get a response. Please try again.'}`,
          createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, errorMessage]);
      } else {
        // No content from streaming AND no error, but also no success message
        // This can happen with some models that don't return content properly
        const noContentMessage: ChatMessage = {
          id: `empty-${Date.now()}`,
          conversationId,
          role: 'assistant',
          content: 'The model returned an empty response. Try a different model or rephrase your question.',
          createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, noContentMessage]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        conversationId,
        role: 'assistant',
        content: 'Sorry, an error occurred while processing your message.',
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      streamingRef.current = '';
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
      // Keep any streamed content as a visible message
      const partialContent = streamingRef.current;
      setIsStreaming(false);
      setStreamingContent('');
      streamingRef.current = '';

      if (partialContent) {
        const partialMessage: ChatMessage = {
          id: `partial-${Date.now()}`,
          conversationId,
          role: 'assistant',
          content: partialContent + '\n\n*(cancelled)*',
          createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, partialMessage]);
      }
    }
  };

  const handleModelChange = async (modelId: string) => {
    try {
      await window.electronAPI?.chat.setConversationModel(conversationId, modelId);
      setConversation(prev => prev ? { ...prev, model: modelId } : null);
      setShowModelSelector(false);
    } catch (error) {
      console.error('Failed to change model:', error);
    }
  };

  const renderToolMarkers = (events: Array<{ type: 'call' | 'result'; name: string; args?: unknown; timestamp: number }>) => {
    if (events.length === 0) return null;

    // Group into pairs: call + result for each tool invocation
    const markers: Array<{ name: string; args?: unknown; completed: boolean }> = [];
    const pendingCalls = new Map<string, number>();

    for (const event of events) {
      if (event.type === 'call') {
        markers.push({ name: event.name, args: event.args, completed: false });
        const count = pendingCalls.get(event.name) || 0;
        pendingCalls.set(event.name, count + 1);
      } else if (event.type === 'result') {
        // Find the last uncompleted marker for this tool
        for (let i = markers.length - 1; i >= 0; i--) {
          if (markers[i].name === event.name && !markers[i].completed) {
            markers[i].completed = true;
            break;
          }
        }
      }
    }

    return (
      <div className="tool-markers">
        {markers.map((marker, i) => {
          const argsPreview = marker.args
            ? Object.entries(marker.args as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v.length > 30 ? v.slice(0, 30) + '...' : v}"` : JSON.stringify(v)}`)
                .join(', ')
            : '';

          return (
            <div key={i} className={`tool-marker ${marker.completed ? 'completed' : 'pending'}`}>
              <span className="tool-marker-icon">{marker.completed ? '\u2713' : '\u25CF'}</span>
              <span className="tool-marker-name">{marker.name}</span>
              {argsPreview && <span className="tool-marker-args">({argsPreview})</span>}
            </div>
          );
        })}
      </div>
    );
  };

  const renderMessage = (msg: ChatMessage) => {
    if (msg.role === 'system' || msg.role === 'tool') return null;

    // Parse tool calls from stored message data
    const storedToolCalls: Array<{ name: string; args?: unknown; completed: boolean }> = [];
    if (msg.role === 'assistant' && msg.toolCalls) {
      try {
        const calls = JSON.parse(msg.toolCalls) as Array<{ name: string; args?: unknown }>;
        calls.forEach(c => storedToolCalls.push({ name: c.name, args: c.args, completed: true }));
      } catch { /* ignore parse errors */ }
    }

    return (
      <div key={msg.id} className={`chat-message ${msg.role}`}>
        <div className="chat-message-avatar">
          {msg.role === 'user' ? '\u{1F464}' : '\u{1F916}'}
        </div>
        <div className="chat-message-content">
          <div className="chat-message-header">
            <span className="chat-message-role">
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </span>
          </div>
          {storedToolCalls.length > 0 && (
            <div className="tool-markers">
              {storedToolCalls.map((marker, i) => {
                const argsPreview = marker.args
                  ? Object.entries(marker.args as Record<string, unknown>)
                      .map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v.length > 30 ? v.slice(0, 30) + '...' : v}"` : JSON.stringify(v)}`)
                      .join(', ')
                  : '';
                return (
                  <div key={i} className="tool-marker completed">
                    <span className="tool-marker-icon">{'\u2713'}</span>
                    <span className="tool-marker-name">{marker.name}</span>
                    {argsPreview && <span className="tool-marker-args">({argsPreview})</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="chat-message-text">
            {msg.role === 'assistant' ? (
              <Markdown gfm>{msg.content}</Markdown>
            ) : (
              msg.content
            )}
          </div>
        </div>
      </div>
    );
  };

  // API key setup screen
  if (needsApiKey) {
    return (
      <div className="chat-panel">
        <div className="chat-panel-header">
          <div className="chat-panel-title">AI Chat Setup</div>
        </div>
        <div className="chat-messages">
          <div className="chat-welcome">
            <div className="chat-welcome-icon">{'\u{1F511}'}</div>
            <h2>OpenCode Zen API Key Required</h2>
            <p>Enter your OpenCode API key to enable AI chat.</p>
            <div className="api-key-form">
              <input
                type="password"
                className="api-key-input"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
                placeholder="Enter your API key..."
                disabled={isValidating}
              />
              <button
                className="api-key-submit"
                onClick={handleApiKeySubmit}
                disabled={!apiKeyInput.trim() || isValidating}
              >
                {isValidating ? 'Validating...' : 'Save Key'}
              </button>
              {apiKeyError && <div className="api-key-error">{apiKeyError}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <div className="chat-panel-title">
          {conversation?.title || 'New Chat'}
        </div>
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
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="chat-welcome">
            <div className="chat-welcome-icon">{'\u{1F916}'}</div>
            <h2>Welcome to the AI Assistant</h2>
            <p>I can help you manage your posts and media. Try asking me to:</p>
            <ul>
              <li>Search for posts about a specific topic</li>
              <li>Get details about a specific post</li>
              <li>List all tags or categories in your blog</li>
              <li>Update metadata for posts or media</li>
              <li>List all images in your media library</li>
            </ul>
          </div>
        )}

        {messages.map(renderMessage)}

        {isStreaming && (streamingContent || toolEvents.length > 0) && (
          <div className="chat-message assistant streaming">
            <div className="chat-message-avatar">{'\u{1F916}'}</div>
            <div className="chat-message-content">
              <div className="chat-message-header">
                <span className="chat-message-role">Assistant</span>
                <span className="streaming-indicator">{'\u25CF'}</span>
              </div>
              {renderToolMarkers(toolEvents)}
              {streamingContent && (
                <div className="chat-message-text">
                  <Markdown gfm>{streamingContent}</Markdown>
                </div>
              )}
            </div>
          </div>
        )}

        {isStreaming && !streamingContent && toolEvents.length === 0 && (
          <div className="chat-message assistant thinking">
            <div className="chat-message-avatar">{'\u{1F916}'}</div>
            <div className="chat-message-content">
              <div className="chat-thinking-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        {isStreaming && (
          <button className="chat-abort-button" onClick={handleAbort}>
            {'\u25FC'} Stop
          </button>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
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

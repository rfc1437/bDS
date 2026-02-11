import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [availableModels, setAvailableModels] = useState<ChatModel[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingRef = useRef('');

  // Scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load conversation and messages
  const loadData = useCallback(async () => {
    try {
      const [conv, msgs, models] = await Promise.all([
        window.electronAPI?.chat.getConversation(conversationId),
        window.electronAPI?.chat.getHistory(conversationId),
        window.electronAPI?.chat.getAvailableModels()
      ]);
      
      if (conv) setConversation(conv);
      if (msgs) setMessages(msgs);
      if (models) setAvailableModels(models);
    } catch (error) {
      console.error('Failed to load chat data:', error);
    }
  }, [conversationId]);

  useEffect(() => {
    loadData();
    
    // Subscribe to stream events
    const unsubDelta = window.electronAPI?.chat.onStreamDelta((data) => {
      if (data.conversationId === conversationId) {
        streamingRef.current += data.delta;
        setStreamingContent(streamingRef.current);
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
      unsubTitle?.();
    };
  }, [conversationId, loadData, scrollToBottom]);

  // Scroll on new messages or streaming content
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const handleSend = async () => {
    const message = inputValue.trim();
    if (!message || isStreaming) return;

    setInputValue('');
    setIsStreaming(true);
    streamingRef.current = '';
    setStreamingContent('');

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
      await window.electronAPI?.chat.sendMessage(conversationId, message);
      
      // Reload messages to get the saved assistant response
      const msgs = await window.electronAPI?.chat.getHistory(conversationId);
      if (msgs) setMessages(msgs);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Add error message
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

  const renderMessage = (msg: ChatMessage) => {
    if (msg.role === 'system' || msg.role === 'tool') return null;

    return (
      <div key={msg.id} className={`chat-message ${msg.role}`}>
        <div className="chat-message-avatar">
          {msg.role === 'user' ? '👤' : '🤖'}
        </div>
        <div className="chat-message-content">
          <div className="chat-message-header">
            <span className="chat-message-role">
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </span>
          </div>
          <div className="chat-message-text">{msg.content}</div>
        </div>
      </div>
    );
  };

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
            {conversation?.model || 'gpt-4o'}
            <span className="model-dropdown-icon">▾</span>
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
            <div className="chat-welcome-icon">🤖</div>
            <h2>Welcome to the AI Assistant</h2>
            <p>I can help you manage your posts and media. Try asking me to:</p>
            <ul>
              <li>Search for posts about a specific topic</li>
              <li>Get details about a specific post</li>
              <li>Update metadata for posts or media</li>
              <li>List all images in your media library</li>
            </ul>
          </div>
        )}
        
        {messages.map(renderMessage)}
        
        {isStreaming && streamingContent && (
          <div className="chat-message assistant streaming">
            <div className="chat-message-avatar">🤖</div>
            <div className="chat-message-content">
              <div className="chat-message-header">
                <span className="chat-message-role">Assistant</span>
                <span className="streaming-indicator">●</span>
              </div>
              <div className="chat-message-text">{streamingContent}</div>
            </div>
          </div>
        )}
        
        {isStreaming && !streamingContent && (
          <div className="chat-message assistant thinking">
            <div className="chat-message-avatar">🤖</div>
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
            ◼ Stop
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
            ↑
          </button>
        </div>
      </div>
    </div>
  );
};

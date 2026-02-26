import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from '../types/electron';

export interface ChatToolEvent {
  type: 'call' | 'result';
  name: string;
  args?: unknown;
  timestamp: number;
}

export function useChatSurfaceState() {
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolEvents, setToolEvents] = useState<ChatToolEvent[]>([]);
  const streamingRef = useRef('');
  const toolEventsRef = useRef<Array<{ name: string; args?: unknown }>>([]);

  const setMessages = useCallback((nextMessages: ChatMessage[]) => {
    setMessagesState(nextMessages);
  }, []);

  const beginUserTurn = useCallback((conversationId: string, content: string) => {
    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    setMessagesState((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    streamingRef.current = '';
    setStreamingContent('');
    setToolEvents([]);
    toolEventsRef.current = [];
  }, []);

  const appendStreamDelta = useCallback((delta: string) => {
    streamingRef.current += delta;
    setStreamingContent(streamingRef.current);
  }, []);

  const recordToolCall = useCallback((name: string, args?: unknown) => {
    toolEventsRef.current.push({ name, args });
    setToolEvents((prev) => [...prev, { type: 'call', name, args, timestamp: Date.now() }]);
  }, []);

  const recordToolResult = useCallback((name: string) => {
    setToolEvents((prev) => [...prev, { type: 'result', name, timestamp: Date.now() }]);
  }, []);

  const stopStreaming = useCallback(() => {
    setIsStreaming(false);
    setStreamingContent('');
    streamingRef.current = '';
  }, []);

  const appendAssistantMessage = useCallback((conversationId: string, content: string) => {
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      conversationId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessagesState((prev) => [...prev, assistantMessage]);
  }, []);

  const finalizeAssistantTurn = useCallback((conversationId: string, content: string) => {
    if (content) {
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        conversationId,
        role: 'assistant',
        content,
        toolCalls: toolEventsRef.current.length > 0 ? JSON.stringify(toolEventsRef.current) : undefined,
        createdAt: new Date().toISOString(),
      };
      setMessagesState((prev) => [...prev, assistantMessage]);
    }

    setIsStreaming(false);
    setStreamingContent('');
    streamingRef.current = '';
  }, []);

  const abortStreaming = useCallback((conversationId: string, cancelledSuffix: string) => {
    const partialContent = streamingRef.current;
    setIsStreaming(false);
    setStreamingContent('');
    streamingRef.current = '';

    if (!partialContent) {
      return;
    }

    const partialMessage: ChatMessage = {
      id: `partial-${Date.now()}`,
      conversationId,
      role: 'assistant',
      content: `${partialContent}\n\n*(${cancelledSuffix})*`,
      createdAt: new Date().toISOString(),
    };
    setMessagesState((prev) => [...prev, partialMessage]);
  }, []);

  const getStreamingContent = useCallback(() => streamingRef.current, []);

  return {
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
  };
}

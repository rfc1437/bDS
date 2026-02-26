import { useCallback, useState } from 'react';
import { sendConversationMessage, type ChatService, type SendMessageMetadata } from './chatSession';

interface UseChatMessageSenderInput {
  chatService: Pick<ChatService, 'sendMessage'> | null | undefined;
}

interface UseChatMessageSenderParams {
  conversationId: string;
  message: string;
  metadata?: SendMessageMetadata;
}

export function useChatMessageSender(input: UseChatMessageSenderInput) {
  const [lastError, setLastError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (params: UseChatMessageSenderParams) => {
      if (!input.chatService) {
        const error = 'Chat service unavailable';
        setLastError(error);
        return {
          success: false as const,
          message: '',
          error,
        };
      }

      const result = await sendConversationMessage({
        conversationId: params.conversationId,
        message: params.message,
        metadata: params.metadata,
        chatService: input.chatService,
      });

      if (!result.success) {
        setLastError(result.error || 'Failed to send message');
        return result;
      }

      setLastError(null);
      return result;
    },
    [input.chatService],
  );

  const clearError = useCallback(() => {
    setLastError(null);
  }, []);

  return {
    sendMessage,
    lastError,
    clearError,
  };
}

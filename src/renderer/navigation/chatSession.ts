import type { ProtocolResponseEnvelope } from '../types/electron';

export interface ChatService {
  createConversation: (title?: string, model?: string) => Promise<{ id: string } | null | undefined>;
  sendMessage: (
    conversationId: string,
    message: string,
    metadata?: SendMessageMetadata,
  ) => Promise<{ success: boolean; message?: string; envelope?: ProtocolResponseEnvelope; protocolVersion?: '2.0'; traceId?: string; warnings?: string[]; error?: string } | null | undefined>;
}

export interface SendMessageMetadata {
  surface?: 'tab' | 'sidebar';
}

export interface EnsureConversationIdInput {
  currentConversationId: string | null;
  createTitle: string;
  chatService: Pick<ChatService, 'createConversation'>;
}

export interface SendConversationMessageInput {
  conversationId: string;
  message: string;
  metadata?: SendMessageMetadata;
  chatService: Pick<ChatService, 'sendMessage'>;
}

export interface SendConversationMessageResult {
  success: boolean;
  message: string;
  envelope?: ProtocolResponseEnvelope;
  protocolVersion?: '2.0';
  traceId?: string;
  warnings?: string[];
  error?: string;
}

export async function ensureConversationId(input: EnsureConversationIdInput): Promise<string> {
  if (input.currentConversationId) {
    return input.currentConversationId;
  }

  const conversation = await input.chatService.createConversation(input.createTitle);
  if (!conversation?.id) {
    throw new Error('No conversation id returned');
  }

  return conversation.id;
}

export async function sendConversationMessage(
  input: SendConversationMessageInput,
): Promise<SendConversationMessageResult> {
  const result = input.metadata
    ? await input.chatService.sendMessage(input.conversationId, input.message, input.metadata)
    : await input.chatService.sendMessage(input.conversationId, input.message);

  if (result?.success === false) {
    return {
      success: false,
      message: '',
      error: result.error || 'Failed to send message',
    };
  }

  if (!result) {
    return {
      success: false,
      message: '',
      error: 'No response returned',
    };
  }

  return {
    success: true,
    message: result.message || '',
    envelope: result.envelope,
    protocolVersion: result.protocolVersion,
    traceId: result.traceId,
    warnings: result.warnings,
  };
}

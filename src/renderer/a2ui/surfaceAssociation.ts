/**
 * Surface-to-message association utilities.
 *
 * Computes the turn index for a message based on its position
 * in the message array, enabling inline surface rendering.
 *
 * Also provides replay logic to reconstruct A2UI surfaces from
 * persisted tool calls when reloading a saved conversation.
 */

import type { ChatMessage } from '../../main/shared/electronApi';
import type { A2UIServerMessage } from '../../main/a2ui/types';
import { isRenderTool, generateFromToolCall } from '../../main/a2ui/generator';

/**
 * Compute the turn index for a message at a given position.
 *
 * Turn index is defined as the 0-based count of user messages
 * seen up to and including the given position, minus 1.
 * System and tool messages do not affect the count.
 *
 * Returns -1 if no user message has been seen at or before the index.
 */
export function computeTurnIndex(messages: ChatMessage[], currentIndex: number): number {
  let userCount = 0;
  for (let i = 0; i <= currentIndex; i++) {
    if (messages[i].role === 'user') {
      userCount++;
    }
  }
  return userCount - 1;
}

interface StoredToolCall {
  name: string;
  args?: Record<string, unknown>;
}

/**
 * Replay A2UI surfaces from persisted chat messages.
 *
 * Scans assistant messages for render tool calls stored in their
 * `toolCalls` JSON field and regenerates the A2UI server messages
 * needed to reconstruct the surfaces in the manager.
 *
 * @param conversationId - The conversation ID for surface creation
 * @param messages - The full ordered message history from the database
 * @returns Array of A2UI server messages to feed into A2UISurfaceManager
 */
export function replaySurfacesFromMessages(
  conversationId: string,
  messages: ChatMessage[],
): A2UIServerMessage[] {
  const allA2UIMessages: A2UIServerMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.toolCalls) {
      continue;
    }

    let toolCalls: StoredToolCall[];
    try {
      toolCalls = JSON.parse(message.toolCalls) as StoredToolCall[];
    } catch {
      continue;
    }

    if (!Array.isArray(toolCalls)) {
      continue;
    }

    const turnIndex = computeTurnIndex(messages, i);

    for (const toolCall of toolCalls) {
      if (!isRenderTool(toolCall.name)) {
        continue;
      }

      const a2uiMessages = generateFromToolCall(
        conversationId,
        toolCall.name,
        toolCall.args ?? {},
      );

      if (a2uiMessages) {
        // Inject turnIndex into createSurface metadata, matching live behavior
        for (const msg of a2uiMessages) {
          if (msg.type === 'createSurface') {
            msg.metadata = { ...msg.metadata, turnIndex };
          }
        }
        allA2UIMessages.push(...a2uiMessages);
      }
    }
  }

  return allA2UIMessages;
}

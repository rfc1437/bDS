/**
 * Surface-to-message association utilities.
 *
 * Computes the turn index for a message based on its position
 * in the message array, enabling inline surface rendering.
 */

import type { ChatMessage } from '../../main/shared/electronApi';

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

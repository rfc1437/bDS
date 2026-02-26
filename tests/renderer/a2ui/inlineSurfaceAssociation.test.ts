import { describe, expect, it } from 'vitest';
import { computeTurnIndex } from '../../../src/renderer/a2ui/surfaceAssociation';
import type { ChatMessage } from '../../../src/main/shared/electronApi';

function msg(role: ChatMessage['role'], id = `msg-${Date.now()}-${Math.random()}`): ChatMessage {
  return { id, conversationId: 'conv-1', role, content: '', createdAt: new Date().toISOString() };
}

describe('computeTurnIndex', () => {
  it('returns 0 for the first user message', () => {
    const messages = [msg('user')];
    expect(computeTurnIndex(messages, 0)).toBe(0);
  });

  it('returns 0 for an assistant message following the first user message', () => {
    const messages = [msg('user'), msg('assistant')];
    expect(computeTurnIndex(messages, 1)).toBe(0);
  });

  it('increments turn index for each user message', () => {
    const messages = [msg('user'), msg('assistant'), msg('user'), msg('assistant')];
    expect(computeTurnIndex(messages, 0)).toBe(0);
    expect(computeTurnIndex(messages, 1)).toBe(0);
    expect(computeTurnIndex(messages, 2)).toBe(1);
    expect(computeTurnIndex(messages, 3)).toBe(1);
  });

  it('skips system and tool messages in turn counting', () => {
    const messages = [msg('system'), msg('user'), msg('tool'), msg('assistant')];
    expect(computeTurnIndex(messages, 1)).toBe(0); // user
    expect(computeTurnIndex(messages, 3)).toBe(0); // assistant after first user
  });

  it('returns -1 when no user messages precede the index', () => {
    const messages = [msg('system'), msg('assistant')];
    expect(computeTurnIndex(messages, 0)).toBe(-1);
    expect(computeTurnIndex(messages, 1)).toBe(-1);
  });

  it('handles multiple assistant messages in the same turn', () => {
    const messages = [msg('user'), msg('assistant'), msg('assistant')];
    expect(computeTurnIndex(messages, 1)).toBe(0);
    expect(computeTurnIndex(messages, 2)).toBe(0);
  });
});

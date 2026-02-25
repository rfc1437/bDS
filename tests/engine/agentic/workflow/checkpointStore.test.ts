import { describe, expect, it } from 'vitest';
import {
  WorkflowCheckpointStore,
  type WorkflowCheckpointSettingsAdapter,
} from '../../../../src/main/agentic/workflow/checkpointStore';

class InMemorySettingsAdapter implements WorkflowCheckpointSettingsAdapter {
  private readonly store = new Map<string, string>();

  async getSetting(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

describe('WorkflowCheckpointStore', () => {
  it('persists and reloads workflow checkpoints by conversation id', async () => {
    const adapter = new InMemorySettingsAdapter();
    const store = new WorkflowCheckpointStore(adapter);

    await store.save({
      conversationId: 'conversation-1',
      state: 'awaiting_input',
      pendingFields: ['date'],
      lastTraceId: 'trace-1',
      updatedAt: new Date('2026-02-25T10:00:00.000Z').toISOString(),
    });

    const loaded = await store.load('conversation-1');

    expect(loaded).not.toBeNull();
    expect(loaded?.state).toBe('awaiting_input');
    expect(loaded?.pendingFields).toEqual(['date']);
    expect(loaded?.lastTraceId).toBe('trace-1');
  });

  it('returns null when no checkpoint exists', async () => {
    const adapter = new InMemorySettingsAdapter();
    const store = new WorkflowCheckpointStore(adapter);

    const loaded = await store.load('missing-conversation');

    expect(loaded).toBeNull();
  });

  it('returns null for malformed checkpoint JSON', async () => {
    const adapter = new InMemorySettingsAdapter();
    await adapter.setSetting('agui.workflow.conversation-2', '{not-valid-json');
    const store = new WorkflowCheckpointStore(adapter);

    const loaded = await store.load('conversation-2');

    expect(loaded).toBeNull();
  });

  it('returns null when stored checkpoint conversation id does not match', async () => {
    const adapter = new InMemorySettingsAdapter();
    await adapter.setSetting(
      'agui.workflow.conversation-3',
      JSON.stringify({
        conversationId: 'other-conversation',
        state: 'planning',
        pendingFields: [],
        lastTraceId: 'trace-mismatch',
        updatedAt: new Date('2026-02-25T10:00:00.000Z').toISOString(),
      }),
    );

    const store = new WorkflowCheckpointStore(adapter);
    const loaded = await store.load('conversation-3');

    expect(loaded).toBeNull();
  });
});

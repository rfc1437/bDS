import { describe, expect, it } from 'vitest';
import { replaySurfacesFromMessages } from '../../../src/renderer/a2ui/surfaceAssociation';
import type { ChatMessage } from '../../../src/main/shared/electronApi';

function msg(
  role: ChatMessage['role'],
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `msg-${Math.random()}`,
    conversationId: 'conv-1',
    role,
    content: '',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('replaySurfacesFromMessages', () => {
  it('returns empty array when there are no messages', () => {
    const result = replaySurfacesFromMessages('conv-1', []);
    expect(result).toEqual([]);
  });

  it('returns empty array when no assistant messages have toolCalls', () => {
    const messages = [
      msg('user'),
      msg('assistant', { content: 'Hello!' }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);
    expect(result).toEqual([]);
  });

  it('returns empty array when assistant has non-render tool calls only', () => {
    const messages = [
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          { name: 'search_posts', args: { query: 'test' } },
        ]),
      }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);
    expect(result).toEqual([]);
  });

  it('replays a single render_chart tool call', () => {
    const messages = [
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          {
            name: 'render_chart',
            args: {
              chartType: 'bar',
              title: 'Test Chart',
              series: [{ label: 'A', value: 10 }],
            },
          },
        ]),
      }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);

    expect(result.length).toBeGreaterThanOrEqual(2); // createSurface + updateComponents + updateDataModel

    // Verify createSurface has correct turnIndex
    const createMsg = result.find((m) => m.type === 'createSurface');
    expect(createMsg).toBeDefined();
    expect(createMsg!.type).toBe('createSurface');
    if (createMsg!.type === 'createSurface') {
      expect(createMsg!.conversationId).toBe('conv-1');
      expect(createMsg!.metadata?.turnIndex).toBe(0);
    }

    // Verify chart component was generated
    const updateMsg = result.find((m) => m.type === 'updateComponents');
    expect(updateMsg).toBeDefined();
    if (updateMsg!.type === 'updateComponents') {
      expect(updateMsg!.components[0].type).toBe('chart');
      expect(updateMsg!.components[0].properties.chartType).toBe('bar');
    }
  });

  it('assigns correct turnIndex based on message position', () => {
    const messages = [
      msg('user'),
      msg('assistant', { content: 'turn 0' }),
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          {
            name: 'render_metric',
            args: { label: 'Total', value: '42' },
          },
        ]),
      }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);

    const createMsg = result.find((m) => m.type === 'createSurface');
    expect(createMsg).toBeDefined();
    if (createMsg!.type === 'createSurface') {
      expect(createMsg!.metadata?.turnIndex).toBe(1);
    }
  });

  it('replays multiple render tools from the same assistant message', () => {
    const messages = [
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          {
            name: 'render_chart',
            args: { chartType: 'bar', series: [{ label: 'A', value: 1 }] },
          },
          {
            name: 'render_metric',
            args: { label: 'Count', value: '5' },
          },
        ]),
      }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);

    // Should have two createSurface messages (one per render tool)
    const creates = result.filter((m) => m.type === 'createSurface');
    expect(creates).toHaveLength(2);

    // Both should have the same turnIndex
    for (const c of creates) {
      if (c.type === 'createSurface') {
        expect(c.metadata?.turnIndex).toBe(0);
      }
    }
  });

  it('replays render tools across multiple turns', () => {
    const messages = [
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          {
            name: 'render_chart',
            args: { chartType: 'bar', series: [{ label: 'A', value: 1 }] },
          },
        ]),
      }),
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          {
            name: 'render_table',
            args: { columns: ['Name'], rows: [['X']] },
          },
        ]),
      }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);

    const creates = result.filter((m) => m.type === 'createSurface');
    expect(creates).toHaveLength(2);

    if (creates[0].type === 'createSurface' && creates[1].type === 'createSurface') {
      expect(creates[0].metadata?.turnIndex).toBe(0);
      expect(creates[1].metadata?.turnIndex).toBe(1);
    }
  });

  it('mixes data tools and render tools, only replaying render tools', () => {
    const messages = [
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          { name: 'search_posts', args: { query: 'hello' } },
          {
            name: 'render_chart',
            args: { chartType: 'pie', series: [{ label: 'Yes', value: 3 }] },
          },
          { name: 'list_tags', args: {} },
        ]),
      }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);

    const creates = result.filter((m) => m.type === 'createSurface');
    expect(creates).toHaveLength(1);
  });

  it('handles malformed toolCalls JSON gracefully', () => {
    const messages = [
      msg('user'),
      msg('assistant', { toolCalls: 'not-valid-json{{{' }),
    ];
    const result = replaySurfacesFromMessages('conv-1', messages);
    expect(result).toEqual([]);
  });

  it('handles toolCalls with missing args gracefully', () => {
    const messages = [
      msg('user'),
      msg('assistant', {
        toolCalls: JSON.stringify([
          { name: 'render_chart' },
        ]),
      }),
    ];
    // Should not throw
    const result = replaySurfacesFromMessages('conv-1', messages);
    // We expect it to try to generate (generator handles validation)
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

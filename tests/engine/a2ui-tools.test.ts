/**
 * Unit tests for ai/a2ui-tools.ts — 7 A2UI render tools.
 * Execute functions just return { success: true }; actual rendering
 * is triggered externally via experimental_onToolCallFinish.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createA2UITools } from '../../src/main/engine/ai/a2ui-tools';

describe('A2UI Tools — createA2UITools', () => {
  let tools: ReturnType<typeof createA2UITools>;

  beforeEach(() => {
    tools = createA2UITools();
  });

  const expectedToolNames = [
    'render_chart',
    'render_table',
    'render_form',
    'render_card',
    'render_metric',
    'render_list',
    'render_tabs',
    'render_mindmap',
  ];

  it('returns all 8 tools', () => {
    expect(Object.keys(tools)).toHaveLength(8);
    for (const name of expectedToolNames) {
      expect(tools).toHaveProperty(name);
    }
  });

  it('all tools have description and inputSchema', () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t.description, `${name} missing description`).toBeTruthy();
      expect(t.inputSchema, `${name} missing inputSchema`).toBeDefined();
    }
  });

  // Each tool's execute should return { success: true }
  describe.each(expectedToolNames)('%s returns { success: true }', (toolName) => {
    it('executes successfully', async () => {
      const tool = tools[toolName as keyof typeof tools];
      // Provide minimal valid input per tool
      const inputs: Record<string, unknown> = {
        render_chart: { chartType: 'bar', title: 'Test', data: [{ label: 'A', value: 1 }] },
        render_table: { title: 'Test', columns: ['Col1'], rows: [['Val1']] },
        render_form: { title: 'Test', fields: [{ name: 'f1', label: 'Field 1', type: 'text' }] },
        render_card: { title: 'Test', content: 'Body' },
        render_metric: { label: 'Test', value: '42' },
        render_list: { title: 'Test', items: [{ label: 'Item', value: '1' }] },
        render_tabs: {
          title: 'Test',
          tabs: [{ label: 'Tab1', content: [{ type: 'text', data: 'Hello' }] }],
        },
        render_mindmap: {
          nodes: [{ id: 'root', label: 'Topic' }],
        },
      };

      const result = await tool.execute!(
        inputs[toolName] as never,
        { toolCallId: `tc-${toolName}`, messages: [], abortSignal: new AbortController().signal },
      );
      expect(result).toEqual({ success: true });
    });
  });
});

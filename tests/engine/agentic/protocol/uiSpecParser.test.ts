import { describe, expect, it } from 'vitest';
import { extractAssistantUiSpec } from '../../../../src/main/agentic/protocol/uiSpecParser';

describe('extractAssistantUiSpec', () => {
  it('extracts fenced JSON spec and preserves assistant text around it', () => {
    const input = [
      'Here is your dashboard.',
      '```json',
      '{"specVersion":"1","elements":[{"type":"text","text":"Hello"}]}',
      '```',
      'Anything else?',
    ].join('\n');

    const result = extractAssistantUiSpec(input);

    expect(result.ui).not.toBeNull();
    expect(result.ui?.specVersion).toBe('1');
    expect(result.ui?.elements).toHaveLength(1);
    expect(result.assistantText).toContain('Here is your dashboard.');
    expect(result.assistantText).toContain('Anything else?');
  });

  it('normalizes markdown element into canonical text element', () => {
    const input = JSON.stringify({
      specVersion: '1',
      elements: [{ type: 'markdown', content: '## Title' }],
    });

    const result = extractAssistantUiSpec(input);
    const first = result.ui?.elements[0] as { type: string; text?: string };

    expect(result.ui).not.toBeNull();
    expect(first.type).toBe('text');
    expect(first.text).toBe('## Title');
  });

  it('normalizes chart data datasets into chart series', () => {
    const input = JSON.stringify({
      specVersion: '1',
      elements: [
        {
          type: 'chart',
          chartType: 'bar',
          data: {
            labels: ['Jan', 'Feb'],
            datasets: [{ data: [10, 20] }],
          },
        },
      ],
    });

    const result = extractAssistantUiSpec(input);
    const first = result.ui?.elements[0] as { series?: Array<{ label: string; value: number }>; data?: unknown };

    expect(result.ui).not.toBeNull();
    expect(first.series).toEqual([
      { label: 'Jan', value: 10 },
      { label: 'Feb', value: 20 },
    ]);
    expect(first.data).toBeUndefined();
  });

  it('normalizes tabs content to nested elements arrays', () => {
    const input = JSON.stringify({
      type: 'tabs',
      tabs: [
        {
          title: 'Overview',
          content: { type: 'text', text: 'Summary' },
        },
      ],
    });

    const result = extractAssistantUiSpec(input);
    const tabs = result.ui?.elements[0] as {
      tabs: Array<{ id: string; label: string; elements: Array<{ type: string; text?: string }> }>;
    };

    expect(result.ui).not.toBeNull();
    expect(tabs.tabs).toHaveLength(1);
    expect(tabs.tabs[0].id).toBe('tab-1');
    expect(tabs.tabs[0].label).toBe('Overview');
    expect(tabs.tabs[0].elements[0]).toEqual({ type: 'text', text: 'Summary' });
  });

  it('returns plain assistant text when malformed JSON is provided', () => {
    const input = '{"specVersion":"1","elements":[{"type":"text"}';
    const result = extractAssistantUiSpec(input);

    expect(result.ui).toBeNull();
    expect(result.assistantText).toBe(input);
  });
});
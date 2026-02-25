import { describe, expect, it } from 'vitest';
import { ProtocolResponseBuilder } from '../../../../src/main/agentic/protocol/responseBuilder';

describe('ProtocolResponseBuilder', () => {
  it('builds canonical envelope from mixed text + AGUI payload', () => {
    const builder = new ProtocolResponseBuilder();

    const raw = [
      'I found weak months.',
      '```json',
      '{"specVersion":"1","elements":[{"type":"chart","chartType":"bar","series":[{"label":"Jan","value":10}]}]}',
      '```',
    ].join('\n');

    const result = builder.build({
      rawAssistantOutput: raw,
      surface: 'tab',
      capabilities: {
        widgets: ['chart'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
    });

    expect(result.envelope.ui?.elements).toHaveLength(1);
    expect(result.envelope.assistantText).toContain('I found weak months');
    expect(result.envelope.protocolVersion).toBe('2.0');
    expect(result.repairAttempted).toBe(false);
  });

  it('repairs non-canonical envelope keys and validates output', () => {
    const builder = new ProtocolResponseBuilder();

    const raw = JSON.stringify({
      protocol_version: '2.0',
      assistant_text: 'Need more details',
      intent: 'ask_input',
      needs_input: {
        required: true,
        fields: [{ key: 'date', label: 'Date', inputType: 'date' }],
      },
      actions: [],
      confidence: 0.8,
      trace_id: 'trace-manual',
    });

    const result = builder.build({
      rawAssistantOutput: raw,
      surface: 'sidebar',
      capabilities: {
        widgets: ['form'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
    });

    expect(result.repairAttempted).toBe(true);
    expect(result.envelope.assistantText).toBe('Need more details');
    expect(result.envelope.needsInput.required).toBe(true);
    expect(result.envelope.needsInput.fields).toHaveLength(1);
    expect(result.validationError).toBeUndefined();
  });

  it('falls back to safe summarize envelope when payload is invalid', () => {
    const builder = new ProtocolResponseBuilder();

    const raw = '{"specVersion":"9","elements":[]}';

    const result = builder.build({
      rawAssistantOutput: raw,
      surface: 'tab',
      capabilities: {
        widgets: ['chart'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
    });

    expect(result.envelope.intent).toBe('summarize');
    expect(result.envelope.ui).toBeUndefined();
    expect(result.envelope.assistantText).toContain('specVersion');
    expect(result.traceId.length).toBeGreaterThan(0);
  });

  it('blocks actions that are unavailable for the active surface capabilities', () => {
    const builder = new ProtocolResponseBuilder();

    const raw = JSON.stringify({
      protocolVersion: '2.0',
      assistantText: 'Open settings?',
      intent: 'propose_action',
      needsInput: { required: false, fields: [] },
      actions: [{
        id: 'a1',
        action: 'openSettings',
        label: 'Open Settings',
        policy: 'confirm',
        requiresConfirmation: true,
      }],
      confidence: 0.7,
      traceId: 'trace-abc',
    });

    const result = builder.build({
      rawAssistantOutput: raw,
      surface: 'tab',
      capabilities: {
        widgets: ['chart'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
    });

    expect(result.envelope.actions).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes('openSettings'))).toBe(true);
  });

  it('extracts declarative actions from UI elements and applies policy defaults', () => {
    const builder = new ProtocolResponseBuilder();

    const raw = JSON.stringify({
      protocolVersion: '2.0',
      assistantText: 'Choose an option',
      intent: 'propose_action',
      needsInput: { required: false, fields: [] },
      actions: [],
      ui: {
        specVersion: '1',
        elements: [
          {
            type: 'card',
            title: 'Actions',
            body: 'Pick one',
            actions: [{ label: 'Delete', action: 'deletePost' }],
          },
          {
            type: 'tabs',
            tabs: [
              {
                id: 'first',
                label: 'First',
                elements: [{ type: 'action', label: 'Open post', action: 'openPost' }],
              },
            ],
          },
        ],
      },
      confidence: 0.7,
      traceId: 'trace-ui-actions',
    });

    const result = builder.build({
      rawAssistantOutput: raw,
      surface: 'tab',
      capabilities: {
        widgets: ['card', 'tabs', 'action'],
        actions: ['deletePost', 'openPost'],
        tools: ['search_posts'],
      },
    });

    expect(result.envelope.actions).toHaveLength(2);
    expect(result.envelope.actions[0]).toEqual(expect.objectContaining({
      action: 'deletePost',
      policy: 'danger',
      requiresConfirmation: true,
    }));
    expect(result.envelope.actions[1]).toEqual(expect.objectContaining({
      action: 'openPost',
      policy: 'silent',
      requiresConfirmation: false,
    }));
  });

  it('drops invalid ui payloads from canonical envelopes before renderer consumption', () => {
    const builder = new ProtocolResponseBuilder();

    const raw = JSON.stringify({
      protocolVersion: '2.0',
      assistantText: 'Here is the result',
      intent: 'summarize',
      needsInput: { required: false, fields: [] },
      actions: [],
      ui: {
        specVersion: '1',
        elements: [
          {
            type: 'chart',
            chartType: 'bar',
          },
        ],
      },
      confidence: 0.7,
      traceId: 'trace-invalid-ui',
    });

    const result = builder.build({
      rawAssistantOutput: raw,
      surface: 'tab',
      capabilities: {
        widgets: ['chart'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
    });

    expect(result.envelope.ui).toBeUndefined();
    expect(result.warnings.some((warning) => warning.includes('Invalid ui payload'))).toBe(true);
  });

  it('normalizes non-canonical ui element fields inside canonical envelopes', () => {
    const builder = new ProtocolResponseBuilder();

    const raw = JSON.stringify({
      protocolVersion: '2.0',
      assistantText: 'Distribution chart ready.',
      ui: {
        specVersion: '1',
        elements: [
          {
            type: 'chart',
            chartType: 'bar',
            data: {
              labels: ['aside', 'article'],
              datasets: [{ data: [181, 53] }],
            },
          },
          {
            type: 'text',
            content: 'Category breakdown',
          },
        ],
      },
      intent: 'summarize',
      needsInput: { required: false, fields: [] },
      actions: [],
      confidence: 0.95,
      traceId: 'trace-normalize-ui',
    });

    const result = builder.build({
      rawAssistantOutput: raw,
      surface: 'tab',
      capabilities: {
        widgets: ['chart', 'text'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
    });

    const elements = result.envelope.ui?.elements as Array<{ type: string; series?: Array<{ label: string; value: number }>; text?: string }>;
    expect(elements).toHaveLength(2);
    expect(elements[0]?.type).toBe('chart');
    expect(elements[0]?.series).toEqual([
      { label: 'aside', value: 181 },
      { label: 'article', value: 53 },
    ]);
    expect(elements[1]).toEqual({ type: 'text', text: 'Category breakdown' });
    expect(result.warnings.some((warning) => warning.includes('Normalized non-canonical ui payload'))).toBe(true);
  });

});

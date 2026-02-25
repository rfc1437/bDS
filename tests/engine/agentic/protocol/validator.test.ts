import { describe, expect, it } from 'vitest';
import {
  validateProtocolRequestEnvelope,
  validateProtocolResponseEnvelope,
  type ProtocolResponseEnvelope,
} from '../../../../src/main/agentic/protocol/validator';

describe('agentic protocol validator', () => {
  it('validates canonical response envelope', () => {
    const envelope: ProtocolResponseEnvelope = {
      protocolVersion: '2.0',
      assistantText: 'Done',
      intent: 'summarize',
      needsInput: {
        required: false,
        fields: [],
      },
      actions: [],
      confidence: 0.82,
      traceId: 'trace-abc',
    };

    const result = validateProtocolResponseEnvelope(envelope);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects response envelope with unknown properties in strict mode', () => {
    const result = validateProtocolResponseEnvelope({
      protocolVersion: '2.0',
      assistantText: 'Done',
      intent: 'summarize',
      needsInput: { required: false, fields: [] },
      actions: [],
      confidence: 0.8,
      traceId: 'trace-abc',
      extra: 'nope',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AGUI_PROTOCOL_VALIDATION_ERROR');
  });

  it('rejects needsInput.required=true without fields', () => {
    const result = validateProtocolResponseEnvelope({
      protocolVersion: '2.0',
      assistantText: 'Need details',
      intent: 'ask_input',
      needsInput: { required: true, fields: [] },
      actions: [],
      confidence: 0.9,
      traceId: 'trace-xyz',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('needsInput.fields');
  });

  it('validates canonical request envelope with capabilities', () => {
    const result = validateProtocolRequestEnvelope({
      protocolVersion: '2.0',
      surface: 'tab',
      messages: [{ role: 'user', content: 'Create a chart' }],
      context: { projectId: 'project-1' },
      capabilities: {
        widgets: ['chart', 'form'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects invalid request envelope and returns structured protocol error', () => {
    const result = validateProtocolRequestEnvelope({
      protocolVersion: '2.0',
      surface: 'tab',
      messages: [{ role: 'invalid-role', content: 'Create a chart' }],
      context: { projectId: 'project-1' },
      capabilities: {
        widgets: ['chart'],
        actions: ['openPost'],
        tools: ['search_posts'],
      },
      unknown: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AGUI_PROTOCOL_VALIDATION_ERROR');
    expect(result.error?.details?.length).toBeGreaterThan(0);
  });
});

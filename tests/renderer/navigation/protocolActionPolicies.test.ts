import { describe, expect, it } from 'vitest';
import { buildActionPoliciesFromEnvelope } from '../../../src/renderer/navigation/protocolActionPolicies';

describe('buildActionPoliciesFromEnvelope', () => {
  it('preserves server-provided action policies', () => {
    const result = buildActionPoliciesFromEnvelope({
      actions: [
        {
          id: 'a1',
          action: 'openSettings',
          policy: 'confirm',
          requiresConfirmation: true,
        },
      ],
      needsInput: {
        required: false,
        fields: [],
      },
    });

    expect(result).toEqual({
      openSettings: 'confirm',
    });
  });

  it('adds confirm policy for submitNeedsInput when clarification is required', () => {
    const result = buildActionPoliciesFromEnvelope({
      actions: [],
      needsInput: {
        required: true,
        fields: [{ key: 'date', label: 'Date', inputType: 'date' }],
      },
    });

    expect(result.submitNeedsInput).toBe('confirm');
  });

  it('does not override explicit server policy for submitNeedsInput', () => {
    const result = buildActionPoliciesFromEnvelope({
      actions: [
        {
          id: 'a1',
          action: 'submitNeedsInput',
          policy: 'danger',
          requiresConfirmation: true,
        },
      ],
      needsInput: {
        required: true,
        fields: [{ key: 'title', label: 'Title', inputType: 'text' }],
      },
    });

    expect(result.submitNeedsInput).toBe('danger');
  });
});

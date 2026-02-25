import { describe, expect, it } from 'vitest';
import { resolveActionPolicy } from '../../../../src/main/agentic/policy/actionPolicy';

describe('action policy', () => {
  it('marks dangerous actions as requiring explicit confirmation', () => {
    const policy = resolveActionPolicy('deletePost');
    expect(policy.level).toBe('danger');
    expect(policy.requiresConfirmation).toBe(true);
  });

  it('marks configurable but safe navigation actions as confirm', () => {
    const policy = resolveActionPolicy('openSettings');
    expect(policy.level).toBe('confirm');
    expect(policy.requiresConfirmation).toBe(true);
  });

  it('defaults unknown actions to danger', () => {
    const policy = resolveActionPolicy('unknownAction');
    expect(policy.level).toBe('danger');
  });
});

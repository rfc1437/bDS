import type { ProtocolResponseEnvelope } from '../types/electron';

export type ActionPolicyLevel = 'silent' | 'confirm' | 'danger';

export function buildActionPoliciesFromEnvelope(
  envelope: Pick<ProtocolResponseEnvelope, 'actions' | 'needsInput'>,
): Record<string, ActionPolicyLevel> {
  const policies = envelope.actions.reduce<Record<string, ActionPolicyLevel>>((accumulator, action) => {
    accumulator[action.action] = action.policy;
    return accumulator;
  }, {});

  if (envelope.needsInput.required && envelope.needsInput.fields.length > 0 && !policies.submitNeedsInput) {
    policies.submitNeedsInput = 'confirm';
  }

  return policies;
}

import { describe, expect, it } from 'vitest';
import { AgentTurnStateMachine } from '../../../../src/main/agentic/workflow/turnStateMachine';

describe('AgentTurnStateMachine', () => {
  it('transitions to awaiting_input when envelope requests required input', () => {
    const stateMachine = new AgentTurnStateMachine();

    const next = stateMachine.transition({
      previousState: 'planning',
      envelope: {
        intent: 'ask_input',
        needsInput: {
          required: true,
          fields: [{ key: 'date', label: 'Date', inputType: 'date' }],
        },
      },
    });

    expect(next).toBe('awaiting_input');
  });

  it('transitions to completed when summarize intent has no required input', () => {
    const stateMachine = new AgentTurnStateMachine();

    const next = stateMachine.transition({
      previousState: 'observing',
      envelope: {
        intent: 'summarize',
        needsInput: {
          required: false,
          fields: [],
        },
      },
    });

    expect(next).toBe('completed');
  });
});

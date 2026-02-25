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

  it('transitions to executing when intent requests action execution', () => {
    const stateMachine = new AgentTurnStateMachine();

    const next = stateMachine.transition({
      previousState: 'planning',
      envelope: {
        intent: 'execute_action',
        needsInput: {
          required: false,
          fields: [],
        },
      },
    });

    expect(next).toBe('executing');
  });

  it('transitions to observing when proposing actions', () => {
    const stateMachine = new AgentTurnStateMachine();

    const next = stateMachine.transition({
      previousState: 'planning',
      envelope: {
        intent: 'propose_action',
        needsInput: {
          required: false,
          fields: [],
        },
      },
    });

    expect(next).toBe('observing');
  });

  it('returns to executing after awaiting input when input is no longer required', () => {
    const stateMachine = new AgentTurnStateMachine();

    const next = stateMachine.transition({
      previousState: 'awaiting_input',
      envelope: {
        intent: 'analyze',
        needsInput: {
          required: false,
          fields: [],
        },
      },
    });

    expect(next).toBe('executing');
  });

  it('stays in planning for non-terminal analyze intent by default', () => {
    const stateMachine = new AgentTurnStateMachine();

    const next = stateMachine.transition({
      previousState: 'planning',
      envelope: {
        intent: 'analyze',
        needsInput: {
          required: false,
          fields: [],
        },
      },
    });

    expect(next).toBe('planning');
  });
});

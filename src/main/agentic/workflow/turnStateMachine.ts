export type AgentTurnState =
  | 'planning'
  | 'awaiting_input'
  | 'executing'
  | 'observing'
  | 'completed';

interface TurnStateEnvelopeInput {
  intent: 'analyze' | 'ask_input' | 'propose_action' | 'execute_action' | 'summarize';
  needsInput: {
    required: boolean;
    fields: Array<{ key: string }>;
  };
}

interface TransitionInput {
  previousState: AgentTurnState;
  envelope: TurnStateEnvelopeInput;
}

export class AgentTurnStateMachine {
  transition(input: TransitionInput): AgentTurnState {
    if (input.envelope.needsInput.required && input.envelope.needsInput.fields.length > 0) {
      return 'awaiting_input';
    }

    if (input.envelope.intent === 'execute_action') {
      return 'executing';
    }

    if (input.envelope.intent === 'propose_action') {
      return 'observing';
    }

    if (input.envelope.intent === 'summarize') {
      return 'completed';
    }

    if (input.previousState === 'awaiting_input') {
      return 'executing';
    }

    return 'planning';
  }
}

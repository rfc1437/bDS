export type AgentSurface = 'tab' | 'sidebar';

export type ProtocolIntent =
  | 'analyze'
  | 'ask_input'
  | 'propose_action'
  | 'execute_action'
  | 'summarize';

export type ActionPolicyLevel = 'silent' | 'confirm' | 'danger';

export interface ProtocolNeedsInputField {
  key: string;
  label: string;
  inputType: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number';
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
  defaultValue?: string | number | boolean;
}

export interface ProtocolNeedsInput {
  required: boolean;
  fields: ProtocolNeedsInputField[];
}

export interface ProtocolAction {
  id: string;
  action: string;
  label?: string;
  payload?: Record<string, unknown>;
  policy: ActionPolicyLevel;
  requiresConfirmation: boolean;
}

export interface ProtocolUiSpec {
  specVersion: '1';
  elements: unknown[];
}

export interface ProtocolResponseEnvelope {
  protocolVersion: '2.0';
  assistantText: string;
  ui?: ProtocolUiSpec;
  intent: ProtocolIntent;
  needsInput: ProtocolNeedsInput;
  actions: ProtocolAction[];
  confidence: number;
  traceId: string;
}

export interface ProtocolRequestMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface ProtocolCapabilitySnapshot {
  widgets: string[];
  actions: string[];
  tools: string[];
  disabled?: string[];
}

export interface ProtocolRequestEnvelope {
  protocolVersion: '2.0';
  surface: AgentSurface;
  messages: ProtocolRequestMessage[];
  context: Record<string, unknown>;
  capabilities: ProtocolCapabilitySnapshot;
}

export interface ProtocolValidationError {
  code: 'AGUI_PROTOCOL_VALIDATION_ERROR';
  message: string;
  details?: string[];
}

export interface ProtocolValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: ProtocolValidationError;
}

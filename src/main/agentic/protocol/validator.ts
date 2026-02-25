import { z } from 'zod';
import type {
  ProtocolRequestEnvelope,
  ProtocolResponseEnvelope,
  ProtocolValidationResult,
} from './types';
import { createProtocolValidationError } from './errors';

const needsInputFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  inputType: z.enum(['text', 'textarea', 'select', 'checkbox', 'date', 'number']),
  required: z.boolean().optional(),
  options: z.array(z.object({ label: z.string().min(1), value: z.string() })).optional(),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
}).strict();

const needsInputSchema = z.object({
  required: z.boolean(),
  fields: z.array(needsInputFieldSchema),
}).strict();

const protocolActionSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  label: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  policy: z.enum(['silent', 'confirm', 'danger']),
  requiresConfirmation: z.boolean(),
}).strict();

const protocolUiSchema = z.object({
  specVersion: z.literal('1'),
  elements: z.array(z.unknown()),
}).strict();

const protocolResponseEnvelopeSchema = z.object({
  protocolVersion: z.literal('2.0'),
  assistantText: z.string(),
  ui: protocolUiSchema.optional(),
  intent: z.enum(['analyze', 'ask_input', 'propose_action', 'execute_action', 'summarize']),
  needsInput: needsInputSchema,
  actions: z.array(protocolActionSchema),
  confidence: z.number().min(0).max(1),
  traceId: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.needsInput.required && value.needsInput.fields.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['needsInput', 'fields'],
      message: 'needsInput.fields must include at least one field when needsInput.required is true',
    });
  }
});

const protocolRequestEnvelopeSchema = z.object({
  protocolVersion: z.literal('2.0'),
  surface: z.enum(['tab', 'sidebar']),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant', 'system', 'tool']), content: z.string() }).strict()),
  context: z.record(z.string(), z.unknown()),
  capabilities: z.object({
    widgets: z.array(z.string().min(1)),
    actions: z.array(z.string().min(1)),
    tools: z.array(z.string().min(1)),
    disabled: z.array(z.string().min(1)).optional(),
  }).strict(),
}).strict();

function toErrorMessage(prefix: string, issues: z.ZodIssue[]): string {
  const firstIssue = issues[0];
  const issuePath = firstIssue.path.length > 0 ? firstIssue.path.join('.') : 'root';
  return `${prefix}: ${issuePath} ${firstIssue.message}`;
}

export function validateProtocolResponseEnvelope(input: unknown): ProtocolValidationResult<ProtocolResponseEnvelope> {
  const parsed = protocolResponseEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: createProtocolValidationError(
        toErrorMessage('Invalid protocol response envelope', parsed.error.issues),
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      ),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export function validateProtocolRequestEnvelope(input: unknown): ProtocolValidationResult<ProtocolRequestEnvelope> {
  const parsed = protocolRequestEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: createProtocolValidationError(
        toErrorMessage('Invalid protocol request envelope', parsed.error.issues),
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      ),
    };
  }

  return {
    ok: true,
    value: parsed.data,
  };
}

export type { ProtocolRequestEnvelope, ProtocolResponseEnvelope } from './types';

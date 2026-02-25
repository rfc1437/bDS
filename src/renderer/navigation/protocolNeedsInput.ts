import type { ProtocolNeedsInputField, ProtocolResponseEnvelope } from '../types/electron';
import type { AssistantPanelElement } from './assistantPanelSpec';

function toFormField(field: ProtocolNeedsInputField): {
  key: string;
  label: string;
  inputType: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number';
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
} {
  return {
    key: field.key,
    label: field.label,
    inputType: field.inputType,
    placeholder: field.placeholder,
    defaultValue: field.defaultValue,
    options: field.options,
    required: field.required,
  };
}

export function toClarificationElements(
  needsInput: ProtocolResponseEnvelope['needsInput'],
): AssistantPanelElement[] {
  if (!needsInput.required || needsInput.fields.length === 0) {
    return [];
  }

  return [{
    type: 'form',
    formId: 'agui-needs-input',
    submitLabel: needsInput.fields[0].label,
    action: 'submitNeedsInput',
    fields: needsInput.fields.map(toFormField),
  }];
}

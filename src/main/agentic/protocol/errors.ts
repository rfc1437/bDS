import type { ProtocolValidationError } from './types';

export function createProtocolValidationError(message: string, details?: string[]): ProtocolValidationError {
  return {
    code: 'AGUI_PROTOCOL_VALIDATION_ERROR',
    message,
    details,
  };
}

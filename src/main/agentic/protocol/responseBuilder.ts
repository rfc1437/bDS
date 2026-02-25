import { randomUUID } from 'crypto';
import type {
  AgentSurface,
  ProtocolCapabilitySnapshot,
  ProtocolIntent,
  ProtocolResponseEnvelope,
  ProtocolValidationError,
} from './types';
import { validateProtocolResponseEnvelope } from './validator';
import { extractAssistantUiSpec } from './uiSpecParser';
import { resolveActionPolicy } from '../policy/actionPolicy';

export interface ProtocolResponseBuildInput {
  rawAssistantOutput: string;
  surface: AgentSurface;
  capabilities: ProtocolCapabilitySnapshot;
}

export interface ProtocolResponseBuildResult {
  envelope: ProtocolResponseEnvelope;
  traceId: string;
  repairAttempted: boolean;
  warnings: string[];
  validationError?: ProtocolValidationError;
}

export class ProtocolResponseBuilder {
  build(input: ProtocolResponseBuildInput): ProtocolResponseBuildResult {
    const warnings: string[] = [];

    const directEnvelope = this.parseCanonicalEnvelope(input.rawAssistantOutput);
    if (directEnvelope) {
      const normalizedDirectEnvelope = this.applyActionPolicies(directEnvelope);
      const { filteredEnvelope, warnings: capabilityWarnings } = this.applyCapabilityGuards(normalizedDirectEnvelope, input.capabilities);
      warnings.push(...capabilityWarnings);
      const validated = validateProtocolResponseEnvelope(filteredEnvelope);
      if (validated.ok && validated.value) {
        return {
          envelope: validated.value,
          traceId: validated.value.traceId,
          repairAttempted: false,
          warnings,
        };
      }

      const fallback = this.fallbackEnvelope(input.rawAssistantOutput);
      return {
        envelope: fallback,
        traceId: fallback.traceId,
        repairAttempted: true,
        warnings,
        validationError: validated.error,
      };
    }

    const repaired = this.repairRawEnvelope(input.rawAssistantOutput);
    if (repaired) {
      const normalizedRepairedEnvelope = this.applyActionPolicies(repaired);
      const { filteredEnvelope, warnings: capabilityWarnings } = this.applyCapabilityGuards(normalizedRepairedEnvelope, input.capabilities);
      warnings.push(...capabilityWarnings);
      const validated = validateProtocolResponseEnvelope(filteredEnvelope);
      if (validated.ok && validated.value) {
        return {
          envelope: validated.value,
          traceId: validated.value.traceId,
          repairAttempted: true,
          warnings,
        };
      }
    }

    const parsedUi = extractAssistantUiSpec(input.rawAssistantOutput);
    const jsonLikeOutput = input.rawAssistantOutput.trim().startsWith('{')
      || input.rawAssistantOutput.trim().startsWith('[');
    const baseEnvelope: ProtocolResponseEnvelope = {
      protocolVersion: '2.0',
      assistantText: parsedUi.assistantText,
      ui: parsedUi.ui || undefined,
      intent: jsonLikeOutput
        ? 'summarize'
        : this.deriveIntent(parsedUi.assistantText, Boolean(parsedUi.ui), false),
      needsInput: {
        required: false,
        fields: [],
      },
      actions: [],
      confidence: 0.7,
      traceId: randomUUID(),
    };

    const normalizedBaseEnvelope = this.applyActionPolicies(baseEnvelope);
    const { filteredEnvelope, warnings: capabilityWarnings } = this.applyCapabilityGuards(normalizedBaseEnvelope, input.capabilities);
    warnings.push(...capabilityWarnings);

    const validated = validateProtocolResponseEnvelope(filteredEnvelope);
    if (validated.ok && validated.value) {
      return {
        envelope: validated.value,
        traceId: validated.value.traceId,
        repairAttempted: false,
        warnings,
      };
    }

    const fallback = this.fallbackEnvelope(input.rawAssistantOutput);
    return {
      envelope: fallback,
      traceId: fallback.traceId,
      repairAttempted: true,
      warnings,
      validationError: validated.error,
    };
  }

  private parseCanonicalEnvelope(raw: string): ProtocolResponseEnvelope | null {
    try {
      const parsed = JSON.parse(raw);
      const validated = validateProtocolResponseEnvelope(parsed);
      return validated.ok && validated.value ? validated.value : null;
    } catch {
      return null;
    }
  }

  private repairRawEnvelope(raw: string): ProtocolResponseEnvelope | null {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const looksLikeEnvelope = Boolean(
        parsed.assistantText
        || parsed.assistant_text
        || parsed.intent
        || parsed.needsInput
        || parsed.needs_input
        || parsed.actions,
      );

      if (!looksLikeEnvelope) {
        return null;
      }

      const repaired: Record<string, unknown> = {
        protocolVersion: parsed.protocolVersion ?? parsed.protocol_version ?? '2.0',
        assistantText: parsed.assistantText ?? parsed.assistant_text ?? '',
        ui: parsed.ui,
        intent: parsed.intent ?? 'summarize',
        needsInput: parsed.needsInput ?? parsed.needs_input ?? { required: false, fields: [] },
        actions: parsed.actions ?? [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.6,
        traceId: parsed.traceId ?? parsed.trace_id ?? randomUUID(),
      };

      const validated = validateProtocolResponseEnvelope(repaired);
      return validated.ok && validated.value ? validated.value : null;
    } catch {
      return null;
    }
  }

  private deriveIntent(text: string, hasUi: boolean, needsInput: boolean): ProtocolIntent {
    if (needsInput) {
      return 'ask_input';
    }

    if (hasUi) {
      return 'propose_action';
    }

    if (text.trim().length === 0) {
      return 'summarize';
    }

    return 'analyze';
  }

  private applyCapabilityGuards(
    envelope: ProtocolResponseEnvelope,
    capabilities: ProtocolCapabilitySnapshot,
  ): { filteredEnvelope: ProtocolResponseEnvelope; warnings: string[] } {
    const warnings: string[] = [];

    const filteredActions = envelope.actions.filter((action) => {
      const supported = capabilities.actions.includes(action.action);
      if (!supported) {
        warnings.push(`Blocked unsupported action: ${action.action}`);
      }
      return supported;
    });

    const filteredUiElements = envelope.ui?.elements.filter((element) => {
      const typedElement = element as { type?: string };
      const elementType = typedElement?.type;
      if (!elementType) {
        return true;
      }

      const supported = capabilities.widgets.includes(elementType);
      if (!supported) {
        warnings.push(`Blocked unsupported widget: ${elementType}`);
      }
      return supported;
    });

    return {
      filteredEnvelope: {
        ...envelope,
        ui: envelope.ui && filteredUiElements
          ? {
            specVersion: '1',
            elements: filteredUiElements,
          }
          : envelope.ui,
        actions: filteredActions,
      },
      warnings,
    };
  }

  private applyActionPolicies(envelope: ProtocolResponseEnvelope): ProtocolResponseEnvelope {
    const actionList = envelope.actions.length > 0
      ? envelope.actions
      : this.extractActionsFromUi(envelope.ui?.elements ?? []);

    const normalizedActions = actionList.map((action, index) => {
      const policy = resolveActionPolicy(action.action);
      return {
        id: action.id || `agui-action-${index + 1}`,
        action: action.action,
        label: action.label,
        payload: action.payload,
        policy: policy.level,
        requiresConfirmation: policy.requiresConfirmation,
      };
    });

    return {
      ...envelope,
      actions: normalizedActions,
    };
  }

  private extractActionsFromUi(elements: unknown[]): Array<{
    id: string;
    action: string;
    label?: string;
    payload?: Record<string, unknown>;
  }> {
    const extracted: Array<{
      id: string;
      action: string;
      label?: string;
      payload?: Record<string, unknown>;
    }> = [];

    const walk = (nodes: unknown[], parentId: string) => {
      nodes.forEach((node, index) => {
        const typedNode = node as Record<string, unknown>;
        const type = typeof typedNode?.type === 'string' ? typedNode.type : '';
        const nodeId = `${parentId}-${index + 1}`;

        if ((type === 'action' || type === 'input' || type === 'datePicker' || type === 'form' || type === 'image') && typeof typedNode.action === 'string') {
          extracted.push({
            id: `ui-${nodeId}`,
            action: typedNode.action,
            label: typeof typedNode.label === 'string' ? typedNode.label : undefined,
            payload: typedNode.payload as Record<string, unknown> | undefined,
          });
        }

        if (type === 'card' && Array.isArray(typedNode.actions)) {
          typedNode.actions.forEach((cardAction, cardActionIndex) => {
            const typedCardAction = cardAction as Record<string, unknown>;
            if (typeof typedCardAction.action === 'string') {
              extracted.push({
                id: `ui-${nodeId}-card-${cardActionIndex + 1}`,
                action: typedCardAction.action,
                label: typeof typedCardAction.label === 'string' ? typedCardAction.label : undefined,
                payload: typedCardAction.payload as Record<string, unknown> | undefined,
              });
            }
          });
        }

        if (type === 'tabs' && Array.isArray(typedNode.tabs)) {
          typedNode.tabs.forEach((tabNode, tabIndex) => {
            const typedTab = tabNode as Record<string, unknown>;
            if (Array.isArray(typedTab.elements)) {
              walk(typedTab.elements, `${nodeId}-tab-${tabIndex + 1}`);
            }
          });
        }
      });
    };

    walk(elements, 'root');
    return extracted;
  }

  private fallbackEnvelope(rawAssistantOutput: string): ProtocolResponseEnvelope {
    return {
      protocolVersion: '2.0',
      assistantText: rawAssistantOutput,
      intent: 'summarize',
      needsInput: {
        required: false,
        fields: [],
      },
      actions: [],
      confidence: 0.3,
      traceId: randomUUID(),
    };
  }
}

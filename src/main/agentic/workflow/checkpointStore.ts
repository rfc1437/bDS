import type { AgentTurnState } from './turnStateMachine';

export interface WorkflowCheckpoint {
  conversationId: string;
  state: AgentTurnState;
  pendingFields: string[];
  lastTraceId: string;
  updatedAt: string;
}

export interface WorkflowCheckpointSettingsAdapter {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

function keyForConversation(conversationId: string): string {
  return `agui.workflow.${conversationId}`;
}

export class WorkflowCheckpointStore {
  private readonly adapter: WorkflowCheckpointSettingsAdapter;

  constructor(adapter: WorkflowCheckpointSettingsAdapter) {
    this.adapter = adapter;
  }

  async save(checkpoint: WorkflowCheckpoint): Promise<void> {
    await this.adapter.setSetting(
      keyForConversation(checkpoint.conversationId),
      JSON.stringify(checkpoint),
    );
  }

  async load(conversationId: string): Promise<WorkflowCheckpoint | null> {
    const raw = await this.adapter.getSetting(keyForConversation(conversationId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as WorkflowCheckpoint;
      if (!parsed || parsed.conversationId !== conversationId) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}

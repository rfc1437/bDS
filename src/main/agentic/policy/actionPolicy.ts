export type ActionPolicyLevel = 'silent' | 'confirm' | 'danger';

export interface ActionPolicyResolution {
  level: ActionPolicyLevel;
  requiresConfirmation: boolean;
}

const ACTION_POLICY_MAP: Record<string, ActionPolicyLevel> = {
  openPost: 'silent',
  openMedia: 'silent',
  openPanel: 'silent',
  setActiveView: 'silent',
  toggleSidebar: 'silent',
  togglePanel: 'silent',
  toggleAssistantSidebar: 'silent',
  openSettings: 'confirm',
  updatePostMetadata: 'confirm',
  updateMediaMetadata: 'confirm',
  submitNeedsInput: 'confirm',
  deletePost: 'danger',
  deleteMedia: 'danger',
};

export function resolveActionPolicy(action: string): ActionPolicyResolution {
  const level = ACTION_POLICY_MAP[action] ?? 'danger';
  return {
    level,
    requiresConfirmation: level !== 'silent',
  };
}

import type { TabType } from '../store/appStore';

export type SingletonToolTabKey =
  | 'settings'
  | 'tags'
  | 'style'
  | 'scripts'
  | 'menu-editor'
  | 'documentation'
  | 'api-documentation'
  | 'metadata-diff'
  | 'site-validation'
  | 'translation-validation'
  | 'find-duplicates';

export interface CanonicalTabSpec {
  type: TabType;
  id: string;
  isTransient: boolean;
}

export type EntityTabType = 'post' | 'media';
export type EntityTabOpenIntent = 'preview' | 'pin';
export type ScriptTabOpenIntent = 'preview' | 'pin';
export type TemplateTabOpenIntent = 'preview' | 'pin';
export type GitDiffResourceOpenIntent = 'preview' | 'pin';

const SINGLETON_TOOL_TAB_REGISTRY: Record<SingletonToolTabKey, CanonicalTabSpec> = {
  settings: { type: 'settings', id: 'settings', isTransient: false },
  tags: { type: 'tags', id: 'tags', isTransient: false },
  style: { type: 'style', id: 'style', isTransient: false },
  scripts: { type: 'scripts', id: 'scripts', isTransient: false },
  'menu-editor': { type: 'menu-editor', id: 'menu-editor', isTransient: false },
  documentation: { type: 'documentation', id: 'documentation', isTransient: false },
  'api-documentation': { type: 'api-documentation', id: 'api-documentation', isTransient: false },
  'metadata-diff': { type: 'metadata-diff', id: 'metadata-diff', isTransient: false },
  'site-validation': { type: 'site-validation', id: 'site-validation', isTransient: false },
  'translation-validation': { type: 'translation-validation', id: 'translation-validation', isTransient: false },
  'find-duplicates': { type: 'find-duplicates', id: 'find-duplicates', isTransient: false },
};

export function getSingletonToolTabSpec(key: SingletonToolTabKey): CanonicalTabSpec {
  return SINGLETON_TOOL_TAB_REGISTRY[key];
}

export function openSingletonToolTab(
  openTab: (tab: CanonicalTabSpec) => void,
  key: SingletonToolTabKey,
): void {
  openTab(getSingletonToolTabSpec(key));
}

export function getEntityTabSpec(
  type: EntityTabType,
  id: string,
  intent: EntityTabOpenIntent,
): CanonicalTabSpec {
  return {
    type,
    id,
    isTransient: intent === 'preview',
  };
}

export function openEntityTab(
  openTab: (tab: CanonicalTabSpec) => void,
  type: EntityTabType,
  id: string,
  intent: EntityTabOpenIntent,
): void {
  openTab(getEntityTabSpec(type, id, intent));
}

export function getChatTabSpec(conversationId: string): CanonicalTabSpec {
  return {
    type: 'chat',
    id: conversationId,
    isTransient: false,
  };
}

export function openChatTab(
  openTab: (tab: CanonicalTabSpec) => void,
  conversationId: string,
): void {
  openTab(getChatTabSpec(conversationId));
}

export function getImportTabSpec(definitionId: string): CanonicalTabSpec {
  return {
    type: 'import',
    id: definitionId,
    isTransient: false,
  };
}

export function openImportTab(
  openTab: (tab: CanonicalTabSpec) => void,
  definitionId: string,
): void {
  openTab(getImportTabSpec(definitionId));
}

export function getScriptTabSpec(scriptId: string, intent: ScriptTabOpenIntent): CanonicalTabSpec {
  return {
    type: 'scripts',
    id: scriptId,
    isTransient: intent === 'preview',
  };
}

export function openScriptTab(
  openTab: (tab: CanonicalTabSpec) => void,
  scriptId: string,
  intent: ScriptTabOpenIntent,
): void {
  openTab(getScriptTabSpec(scriptId, intent));
}

export function getTemplateTabSpec(templateId: string, intent: TemplateTabOpenIntent): CanonicalTabSpec {
  return {
    type: 'templates',
    id: templateId,
    isTransient: intent === 'preview',
  };
}

export function openTemplateTab(
  openTab: (tab: CanonicalTabSpec) => void,
  templateId: string,
  intent: TemplateTabOpenIntent,
): void {
  openTab(getTemplateTabSpec(templateId, intent));
}

function getGitDiffFileTabId(filePath: string): string {
  return `git-diff:${filePath}`;
}

function getGitDiffCommitTabId(commitHash: string): string {
  return `git-diff:commit:${commitHash}`;
}

export function getGitDiffFileTabSpec(
  filePath: string,
  intent: GitDiffResourceOpenIntent,
): CanonicalTabSpec {
  return {
    type: 'git-diff',
    id: getGitDiffFileTabId(filePath),
    isTransient: intent === 'preview',
  };
}

export function getGitDiffCommitTabSpec(
  commitHash: string,
  intent: GitDiffResourceOpenIntent,
): CanonicalTabSpec {
  return {
    type: 'git-diff',
    id: getGitDiffCommitTabId(commitHash),
    isTransient: intent === 'preview',
  };
}

export function openGitDiffFileTab(
  openTab: (tab: CanonicalTabSpec) => void,
  filePath: string,
  intent: GitDiffResourceOpenIntent,
): void {
  openTab(getGitDiffFileTabSpec(filePath, intent));
}

export function openGitDiffCommitTab(
  openTab: (tab: CanonicalTabSpec) => void,
  commitHash: string,
  intent: GitDiffResourceOpenIntent,
): void {
  openTab(getGitDiffCommitTabSpec(commitHash, intent));
}

export function parseGitDiffTabId(tabId: string): { resource: string; commitHash: string | null } {
  const resource = tabId.startsWith('git-diff:') ? tabId.slice('git-diff:'.length) : tabId;
  if (!resource.startsWith('commit:')) {
    return { resource, commitHash: null };
  }

  return {
    resource,
    commitHash: resource.slice('commit:'.length),
  };
}

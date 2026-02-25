import type { AgentSurface, ProtocolCapabilitySnapshot } from '../protocol/types';

interface CapabilityRegistryOptions {
  disabledActions?: string[];
  disabledWidgets?: string[];
  disabledTools?: string[];
}

interface CapabilitySnapshotInput {
  surface: AgentSurface;
}

const COMMON_WIDGETS = [
  'text',
  'metric',
  'list',
  'table',
  'action',
  'chart',
  'form',
  'input',
  'datePicker',
  'card',
  'image',
  'tabs',
] as const;

const COMMON_ACTIONS = [
  'openSettings',
  'openPost',
  'openMedia',
  'openPanel',
  'setActiveView',
  'toggleSidebar',
  'togglePanel',
  'toggleAssistantSidebar',
] as const;

const COMMON_TOOLS = [
  'search_posts',
  'read_post',
  'list_posts',
  'get_media',
  'list_media',
  'update_post_metadata',
  'update_media_metadata',
  'list_tags',
  'list_categories',
  'view_image',
  'get_post_backlinks',
  'get_post_outlinks',
  'get_post_media',
  'get_media_posts',
] as const;

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export class CapabilityRegistryService {
  private readonly disabledActions: Set<string>;
  private readonly disabledWidgets: Set<string>;
  private readonly disabledTools: Set<string>;

  constructor(options: CapabilityRegistryOptions = {}) {
    this.disabledActions = new Set(options.disabledActions ?? []);
    this.disabledWidgets = new Set(options.disabledWidgets ?? []);
    this.disabledTools = new Set(options.disabledTools ?? []);
  }

  getSnapshot(input: CapabilitySnapshotInput): ProtocolCapabilitySnapshot {
    const widgets = COMMON_WIDGETS.filter((widget) => !this.disabledWidgets.has(widget));

    const surfaceActions = input.surface === 'tab'
      ? COMMON_ACTIONS.filter((action) => action !== 'toggleAssistantSidebar')
      : COMMON_ACTIONS.filter((action) => action !== 'toggleSidebar');

    const actions = surfaceActions.filter((action) => !this.disabledActions.has(action));
    const tools = COMMON_TOOLS.filter((tool) => !this.disabledTools.has(tool));

    const disabled = unique([
      ...Array.from(this.disabledActions).map((action) => `action:${action}`),
      ...Array.from(this.disabledWidgets).map((widget) => `widget:${widget}`),
      ...Array.from(this.disabledTools).map((tool) => `tool:${tool}`),
    ]);

    return {
      widgets: [...widgets],
      actions: [...actions],
      tools: [...tools],
      disabled,
    };
  }
}

/**
 * A2UI v0.9 types for bDS
 *
 * Implements the core A2UI protocol concepts:
 * - JSONL streaming via IPC (not HTTP/SSE)
 * - 4 server message types: createSurface, updateComponents, updateDataModel, deleteSurface
 * - Flat component model with ID references
 * - Data binding via JSON Pointer paths (RFC 6901)
 * - Actions dispatched from client back to server
 *
 * @see https://a2ui.org
 */

// ---- Component Types ----

export type A2UIComponentType =
  | 'text'
  | 'button'
  | 'card'
  | 'chart'
  | 'table'
  | 'form'
  | 'textField'
  | 'checkBox'
  | 'dateTimeInput'
  | 'choicePicker'
  | 'image'
  | 'tabs'
  | 'metric'
  | 'list'
  | 'row'
  | 'column'
  | 'divider';

export interface A2UIComponent {
  id: string;
  type: A2UIComponentType;
  properties: Record<string, unknown>;
  /** JSON Pointer path for data binding (RFC 6901) */
  dataBinding?: string;
  /** Ordered child component IDs */
  children?: string[];
  /** Actions this component can dispatch */
  actions?: A2UIComponentAction[];
}

export interface A2UIComponentAction {
  eventType: string;
  action: string;
  payload?: Record<string, unknown>;
  /** Policy for this action: silent = no confirm, confirm = ask user, danger = warn */
  policy?: 'silent' | 'confirm' | 'danger';
}

// ---- Server Messages (main → renderer) ----

export interface A2UICreateSurface {
  type: 'createSurface';
  surfaceId: string;
  conversationId: string;
  metadata?: Record<string, unknown>;
}

export interface A2UIUpdateComponents {
  type: 'updateComponents';
  surfaceId: string;
  components: A2UIComponent[];
  /** Root component IDs for top-level rendering order */
  rootIds?: string[];
}

export interface A2UIUpdateDataModel {
  type: 'updateDataModel';
  surfaceId: string;
  /** JSON Pointer path (RFC 6901) */
  path: string;
  value: unknown;
}

export interface A2UIDeleteSurface {
  type: 'deleteSurface';
  surfaceId: string;
}

export type A2UIServerMessage =
  | A2UICreateSurface
  | A2UIUpdateComponents
  | A2UIUpdateDataModel
  | A2UIDeleteSurface;

// ---- Client Actions (renderer → main) ----

export interface A2UIClientAction {
  surfaceId: string;
  componentId: string;
  action: string;
  payload?: Record<string, unknown>;
}

// ---- Surface State (renderer-side) ----

export interface A2UISurfaceState {
  surfaceId: string;
  conversationId: string;
  components: Map<string, A2UIComponent>;
  rootIds: string[];
  dataModel: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ---- Resolved Component Tree (for rendering) ----

export interface A2UIResolvedComponent {
  id: string;
  type: A2UIComponentType;
  properties: Record<string, unknown>;
  /** JSON Pointer path for data binding (carried from raw component) */
  dataBinding?: string;
  /** Resolved value from data binding */
  boundValue?: unknown;
  actions?: A2UIComponentAction[];
  children: A2UIResolvedComponent[];
}

// ---- Catalog ----

export interface A2UICatalogEntry {
  type: A2UIComponentType;
  description: string;
  /** Whether this is a standard A2UI component or a custom bDS extension */
  custom?: boolean;
}

export const BDS_CATALOG_ID = 'bds-blogging-v1';

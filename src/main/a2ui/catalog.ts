/**
 * A2UI Component Catalog for bDS
 *
 * Defines which A2UI component types the bDS client supports.
 * This catalog is used to:
 * 1. Inform the LLM (via system prompt) what UI components are available
 * 2. Validate incoming A2UI messages
 * 3. Map component types to React renderers
 */

import type { A2UICatalogEntry, A2UIComponentType } from './types';
import { BDS_CATALOG_ID } from './types';

const CATALOG_ENTRIES: A2UICatalogEntry[] = [
  { type: 'text', description: 'Text block with Markdown support' },
  { type: 'button', description: 'Clickable button that dispatches an action' },
  { type: 'card', description: 'Card with title, subtitle, body, and action buttons' },
  { type: 'chart', description: 'Bar, stacked-bar, line, area, pie, donut, or heatmap chart visualization', custom: true },
  { type: 'table', description: 'Data table with columns and rows', custom: true },
  { type: 'textField', description: 'Text input field with data binding' },
  { type: 'checkBox', description: 'Checkbox input with data binding' },
  { type: 'dateTimeInput', description: 'Date/time picker input' },
  { type: 'choicePicker', description: 'Select/dropdown with options' },
  { type: 'image', description: 'Image with optional caption and click action' },
  { type: 'tabs', description: 'Tabbed container for organizing content' },
  { type: 'metric', description: 'Key-value metric display', custom: true },
  { type: 'list', description: 'Ordered or unordered item list' },
  { type: 'form', description: 'Form container with fields and submit button', custom: true },
  { type: 'mindmap', description: 'Mind map tree diagram with a central topic and branching nodes', custom: true },
  { type: 'row', description: 'Horizontal layout container' },
  { type: 'column', description: 'Vertical layout container' },
  { type: 'divider', description: 'Visual separator' },
];

const catalogMap = new Map<A2UIComponentType, A2UICatalogEntry>();
for (const entry of CATALOG_ENTRIES) {
  catalogMap.set(entry.type, entry);
}

export function getCatalogEntries(): A2UICatalogEntry[] {
  return [...CATALOG_ENTRIES];
}

export function isSupportedComponentType(type: string): type is A2UIComponentType {
  return catalogMap.has(type as A2UIComponentType);
}

export function getCatalogEntry(type: A2UIComponentType): A2UICatalogEntry | undefined {
  return catalogMap.get(type);
}

export function getCatalogId(): string {
  return BDS_CATALOG_ID;
}

/**
 * Build a description of supported components for inclusion in the LLM system prompt.
 */
export function buildCatalogDescription(): string {
  const lines = CATALOG_ENTRIES.map((entry) => {
    const suffix = entry.custom ? ' (custom)' : '';
    return `  - ${entry.type}: ${entry.description}${suffix}`;
  });
  return `Supported UI component types:\n${lines.join('\n')}`;
}

/**
 * A2UI Generator
 *
 * Converts tool call results from the LLM into A2UI server messages.
 * Each render_* tool call produces a set of A2UI messages:
 * - createSurface (if new surface needed)
 * - updateComponents (add/update components)
 * - updateDataModel (set data values)
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  A2UIServerMessage,
  A2UIComponent,
} from './types';

function makeId(prefix: string): string {
  return `${prefix}-${uuidv4().slice(0, 8)}`;
}

function createSurfaceMessages(
  conversationId: string,
  components: A2UIComponent[],
  rootIds: string[],
  dataEntries?: Array<{ path: string; value: unknown }>,
): A2UIServerMessage[] {
  const surfaceId = makeId('surface');
  const messages: A2UIServerMessage[] = [
    {
      type: 'createSurface',
      surfaceId,
      conversationId,
    },
    {
      type: 'updateComponents',
      surfaceId,
      components,
      rootIds,
    },
  ];

  if (dataEntries) {
    for (const entry of dataEntries) {
      messages.push({
        type: 'updateDataModel',
        surfaceId,
        path: entry.path,
        value: entry.value,
      });
    }
  }

  return messages;
}

// ---- Tool argument interfaces ----

export interface RenderChartArgs {
  chartType: 'bar' | 'stacked-bar' | 'line' | 'area' | 'pie' | 'donut' | 'heatmap';
  title?: string;
  series: Array<{ label: string; value: number; segments?: Array<{ label: string; value: number }> }>;
}

export interface RenderTableArgs {
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface RenderFormField {
  key: string;
  label: string;
  inputType: 'text' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number';
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
}

export interface RenderFormArgs {
  title?: string;
  fields: RenderFormField[];
  submitLabel: string;
  submitAction?: string;
}

export interface RenderCardArgs {
  title: string;
  body: string;
  subtitle?: string;
  actions?: Array<{ label: string; action: string; payload?: Record<string, unknown> }>;
}

export interface RenderMetricArgs {
  label: string;
  value: string;
}

export interface RenderListArgs {
  title?: string;
  items: string[];
}

export interface RenderTabArgs {
  label: string;
  content: Array<{
    type: string;
    [key: string]: unknown;
  }>;
}

export interface RenderTabsArgs {
  tabs: RenderTabArgs[];
}

export interface RenderMindmapNodeArgs {
  id: string;
  label: string;
  children?: string[];
}

export interface RenderMindmapArgs {
  title?: string;
  nodes: RenderMindmapNodeArgs[];
}

// ---- Generators ----

export function generateChart(
  conversationId: string,
  args: RenderChartArgs,
): A2UIServerMessage[] {
  const chartId = makeId('chart');
  const component: A2UIComponent = {
    id: chartId,
    type: 'chart',
    properties: {
      chartType: args.chartType,
      title: args.title,
    },
    dataBinding: '/chartData',
  };

  return createSurfaceMessages(
    conversationId,
    [component],
    [chartId],
    [{ path: '/chartData', value: args.series }],
  );
}

export function generateTable(
  conversationId: string,
  args: RenderTableArgs,
): A2UIServerMessage[] {
  const tableId = makeId('table');
  const components: A2UIComponent[] = [
    {
      id: tableId,
      type: 'table',
      properties: {
        title: args.title,
        columns: args.columns,
      },
      dataBinding: '/tableRows',
    },
  ];

  return createSurfaceMessages(
    conversationId,
    components,
    [tableId],
    [{ path: '/tableRows', value: args.rows }],
  );
}

export function generateForm(
  conversationId: string,
  args: RenderFormArgs,
): A2UIServerMessage[] {
  const formId = makeId('form');
  const fieldComponents: A2UIComponent[] = [];
  const fieldIds: string[] = [];

  for (const field of args.fields) {
    const fieldId = makeId('field');
    fieldIds.push(fieldId);

    let componentType: A2UIComponent['type'] = 'textField';
    if (field.inputType === 'checkbox') {
      componentType = 'checkBox';
    } else if (field.inputType === 'date') {
      componentType = 'dateTimeInput';
    } else if (field.inputType === 'select') {
      componentType = 'choicePicker';
    }

    fieldComponents.push({
      id: fieldId,
      type: componentType,
      properties: {
        key: field.key,
        label: field.label,
        inputType: field.inputType,
        placeholder: field.placeholder,
        defaultValue: field.defaultValue,
        options: field.options,
        required: field.required,
      },
      dataBinding: `/formData/${field.key}`,
    });
  }

  const submitId = makeId('submit');
  fieldComponents.push({
    id: submitId,
    type: 'button',
    properties: {
      label: args.submitLabel,
    },
    actions: [
      {
        eventType: 'click',
        action: args.submitAction || 'submitForm',
        payload: { formId },
      },
    ],
  });

  const formComponent: A2UIComponent = {
    id: formId,
    type: 'form',
    properties: {
      title: args.title,
      submitLabel: args.submitLabel,
    },
    children: [...fieldIds, submitId],
  };

  // Set initial data model values for fields with defaults
  const dataEntries: Array<{ path: string; value: unknown }> = [];
  for (const field of args.fields) {
    if (field.defaultValue !== undefined) {
      dataEntries.push({ path: `/formData/${field.key}`, value: field.defaultValue });
    }
  }

  return createSurfaceMessages(
    conversationId,
    [formComponent, ...fieldComponents],
    [formId],
    dataEntries.length > 0 ? dataEntries : undefined,
  );
}

export function generateCard(
  conversationId: string,
  args: RenderCardArgs,
): A2UIServerMessage[] {
  const cardId = makeId('card');
  const cardActions = args.actions?.map((a) => ({
    eventType: 'click',
    action: a.action,
    payload: a.payload,
  }));

  const component: A2UIComponent = {
    id: cardId,
    type: 'card',
    properties: {
      title: args.title,
      body: args.body,
      subtitle: args.subtitle,
    },
    actions: cardActions,
  };

  return createSurfaceMessages(conversationId, [component], [cardId]);
}

export function generateMetric(
  conversationId: string,
  args: RenderMetricArgs,
): A2UIServerMessage[] {
  const metricId = makeId('metric');
  const component: A2UIComponent = {
    id: metricId,
    type: 'metric',
    properties: {
      label: args.label,
      value: args.value,
    },
  };

  return createSurfaceMessages(conversationId, [component], [metricId]);
}

export function generateList(
  conversationId: string,
  args: RenderListArgs,
): A2UIServerMessage[] {
  const listId = makeId('list');
  const component: A2UIComponent = {
    id: listId,
    type: 'list',
    properties: {
      title: args.title,
    },
    dataBinding: '/listItems',
  };

  return createSurfaceMessages(
    conversationId,
    [component],
    [listId],
    [{ path: '/listItems', value: args.items }],
  );
}

export function generateTabs(
  conversationId: string,
  args: RenderTabsArgs,
): A2UIServerMessage[] {
  const tabsId = makeId('tabs');
  const tabComponents: A2UIComponent[] = [];
  const tabIds: string[] = [];

  for (const tab of args.tabs) {
    const tabId = makeId('tab');
    tabIds.push(tabId);

    const childComponents: A2UIComponent[] = [];
    const childIds: string[] = [];

    for (const contentItem of tab.content) {
      const childId = makeId('child');
      childIds.push(childId);
      childComponents.push({
        id: childId,
        type: contentItem.type as A2UIComponent['type'],
        properties: { ...contentItem, type: undefined },
      });
    }

    tabComponents.push({
      id: tabId,
      type: 'column',
      properties: { label: tab.label },
      children: childIds,
    });

    tabComponents.push(...childComponents);
  }

  const tabsComponent: A2UIComponent = {
    id: tabsId,
    type: 'tabs',
    properties: {
      tabLabels: args.tabs.map((t) => t.label),
    },
    children: tabIds,
  };

  return createSurfaceMessages(
    conversationId,
    [tabsComponent, ...tabComponents],
    [tabsId],
  );
}

// ---- Tool name to generator dispatch ----

export function generateMindmap(
  conversationId: string,
  args: RenderMindmapArgs,
): A2UIServerMessage[] {
  const mindmapId = makeId('mindmap');
  const component: A2UIComponent = {
    id: mindmapId,
    type: 'mindmap',
    properties: {
      title: args.title,
    },
    dataBinding: '/mindmapNodes',
  };

  return createSurfaceMessages(
    conversationId,
    [component],
    [mindmapId],
    [{ path: '/mindmapNodes', value: args.nodes }],
  );
}

const GENERATORS: Record<string, (conversationId: string, args: Record<string, unknown>) => A2UIServerMessage[]> = {
  render_chart: (cid, args) => generateChart(cid, args as unknown as RenderChartArgs),
  render_table: (cid, args) => generateTable(cid, args as unknown as RenderTableArgs),
  render_form: (cid, args) => generateForm(cid, args as unknown as RenderFormArgs),
  render_card: (cid, args) => generateCard(cid, args as unknown as RenderCardArgs),
  render_metric: (cid, args) => generateMetric(cid, args as unknown as RenderMetricArgs),
  render_list: (cid, args) => generateList(cid, args as unknown as RenderListArgs),
  render_tabs: (cid, args) => generateTabs(cid, args as unknown as RenderTabsArgs),
  render_mindmap: (cid, args) => generateMindmap(cid, args as unknown as RenderMindmapArgs),
};

/**
 * Check if a tool name is a UI-rendering tool.
 */
export function isRenderTool(toolName: string): boolean {
  return toolName in GENERATORS;
}

/**
 * Generate A2UI messages for a render tool call.
 * Returns null if the tool name is not a render tool.
 */
export function generateFromToolCall(
  conversationId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): A2UIServerMessage[] | null {
  const generator = GENERATORS[toolName];
  if (!generator) {
    return null;
  }
  return generator(conversationId, toolArgs);
}

/**
 * A2UI render tools — rich UI surfaces in the chat.
 *
 * These tools produce { success: true } as their execute result.
 * The actual A2UI message generation happens in chat.ts via
 * `experimental_onToolCallFinish`, which calls `generateFromToolCall()`.
 *
 * Zod schemas here are the single source of truth for the tool parameter shapes.
 */

import { z } from 'zod';
import { tool } from 'ai';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

const segmentSchema = z.object({
  label: z.string().describe('Segment/column label'),
  value: z.number().describe('Segment value'),
});

const seriesItemSchema = z.object({
  label: z.string().describe('Data point label'),
  value: z.number().describe('Data point value'),
  segments: z.array(segmentSchema).optional()
    .describe('Segments within this data point. Required for stacked-bar and heatmap charts.'),
});

const chartTypeEnum = z.enum(['bar', 'stacked-bar', 'line', 'area', 'pie', 'donut', 'heatmap']);

const tabContentItemSchema = z.object({
  type: z.enum(['text', 'metric', 'list', 'chart', 'table']).describe('Content type'),
  // text
  text: z.string().optional().describe('Text content (for type text)'),
  // metric
  label: z.string().optional().describe('Label (for type metric)'),
  value: z.string().optional().describe('Display value (for type metric)'),
  // list, chart, table
  title: z.string().optional().describe('Title (for type list, chart, or table)'),
  items: z.array(z.string()).optional().describe('Items (for type list)'),
  // chart
  chartType: chartTypeEnum.optional().describe('Chart type (for type chart)'),
  series: z.array(seriesItemSchema).optional().describe('Data series (for type chart)'),
  // table
  columns: z.array(z.string()).optional().describe('Column headers (for type table)'),
  rows: z.array(z.array(z.string())).optional().describe('Table rows (for type table)'),
});

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createA2UITools() {
  return {
    render_chart: tool({
      description: 'Render an interactive chart in the chat UI. Use this when the user asks for a chart, graph, or data visualization.',
      inputSchema: z.object({
        chartType: chartTypeEnum.describe('The type of chart to render. Use stacked-bar for multi-segment bars. Use heatmap for grid/matrix visualizations.'),
        title: z.string().optional().describe('Optional chart title'),
        series: z.array(seriesItemSchema).describe('Array of data points.'),
      }),
      execute: async (_input) => ({ success: true }),
    }),

    render_table: tool({
      description: 'Render a data table in the chat UI. Use this when the user asks for tabular data, comparisons, or structured information.',
      inputSchema: z.object({
        title: z.string().optional().describe('Optional table title'),
        columns: z.array(z.string()).describe('Column header names'),
        rows: z.array(z.array(z.string())).describe('Table rows, each row is an array of cell values'),
      }),
      execute: async (_input) => ({ success: true }),
    }),

    render_form: tool({
      description: 'Render an interactive form in the chat UI. Use this when you need to collect structured input from the user.',
      inputSchema: z.object({
        title: z.string().optional().describe('Optional form title'),
        fields: z.array(z.object({
          key: z.string().describe('Field identifier'),
          label: z.string().describe('Field label shown to user'),
          inputType: z.enum(['text', 'textarea', 'select', 'checkbox', 'date', 'number']).describe('Type of input control'),
          placeholder: z.string().optional().describe('Placeholder text'),
          defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Default value'),
          options: z.array(z.object({
            label: z.string(),
            value: z.string(),
          })).optional().describe('Options for select fields'),
          required: z.boolean().optional().describe('Whether the field is required'),
        })).describe('Form fields to display'),
        submitLabel: z.string().describe('Label for the submit button'),
        submitAction: z.string().optional().describe('Action to dispatch on submit'),
      }),
      execute: async (_input) => ({ success: true }),
    }),

    render_card: tool({
      description: 'Render an information card in the chat UI. Use this for displaying a summary, highlight, or actionable item.',
      inputSchema: z.object({
        title: z.string().describe('Card title'),
        body: z.string().describe('Card body text (supports markdown)'),
        subtitle: z.string().optional().describe('Optional subtitle'),
        actions: z.array(z.object({
          label: z.string().describe('Button label'),
          action: z.string().describe('Action name to dispatch'),
          payload: z.record(z.string(), z.unknown()).optional().describe('Optional action payload'),
        })).optional().describe('Optional action buttons on the card'),
      }),
      execute: async (_input) => ({ success: true }),
    }),

    render_metric: tool({
      description: 'Render a single metric/KPI display in the chat UI. Use this for showing a single important value with a label.',
      inputSchema: z.object({
        label: z.string().describe('Metric label'),
        value: z.string().describe('Metric value (displayed prominently)'),
      }),
      execute: async (_input) => ({ success: true }),
    }),

    render_list: tool({
      description: 'Render a list of items in the chat UI. Use this for displaying bullet-point style lists, checklists, or simple enumerations.',
      inputSchema: z.object({
        title: z.string().optional().describe('Optional list title'),
        items: z.array(z.string()).describe('List items'),
      }),
      execute: async (_input) => ({ success: true }),
    }),

    render_tabs: tool({
      description: 'Render a tabbed interface in the chat UI. Use this to organize information into multiple tabs that the user can switch between.',
      inputSchema: z.object({
        tabs: z.array(z.object({
          label: z.string().describe('Tab label'),
          content: z.array(tabContentItemSchema).describe('Content items within the tab'),
        })).describe('Array of tabs'),
      }),
      execute: async (_input) => ({ success: true }),
    }),
  };
}

/** The return type of createA2UITools — useful for typing tool maps. */
export type A2UITools = ReturnType<typeof createA2UITools>;

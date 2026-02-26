import { z } from 'zod';

const textElementSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1),
});

const metricElementSchema = z.object({
  type: z.literal('metric'),
  label: z.string().min(1),
  value: z.string().min(1),
});

const listElementSchema = z.object({
  type: z.literal('list'),
  title: z.string().optional(),
  items: z.array(z.string().min(1)).min(1),
});

const tableElementSchema = z.object({
  type: z.literal('table'),
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.array(z.string())).min(1),
});

const actionElementSchema = z.object({
  type: z.literal('action'),
  label: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const chartElementSchema = z.object({
  type: z.literal('chart'),
  chartType: z.enum(['bar', 'line', 'pie']),
  title: z.string().min(1).optional(),
  series: z.array(
    z.object({
      label: z.string().min(1),
      value: z.number(),
    }),
  ).min(1),
});

const inputTypeSchema = z.enum(['text', 'textarea', 'select', 'checkbox', 'date', 'number']);

const inputOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
});

const inputElementSchema = z.object({
  type: z.literal('input'),
  key: z.string().min(1),
  label: z.string().min(1),
  inputType: inputTypeSchema,
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(inputOptionSchema).optional(),
  action: z.string().min(1).optional(),
  submitLabel: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const datePickerElementSchema = z.object({
  type: z.literal('datePicker'),
  key: z.string().min(1),
  label: z.string().min(1),
  defaultValue: z.string().optional(),
  min: z.string().optional(),
  max: z.string().optional(),
  action: z.string().min(1).optional(),
  submitLabel: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const formFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  inputType: inputTypeSchema,
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(inputOptionSchema).optional(),
  required: z.boolean().optional(),
});

const formElementSchema = z.object({
  type: z.literal('form'),
  formId: z.string().min(1),
  title: z.string().optional(),
  submitLabel: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(formFieldSchema).min(1),
});

const cardActionSchema = z.object({
  label: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const cardElementSchema = z.object({
  type: z.literal('card'),
  title: z.string().min(1),
  body: z.string().min(1),
  subtitle: z.string().optional(),
  actions: z.array(cardActionSchema).optional(),
});

const imageElementSchema = z.object({
  type: z.literal('image'),
  src: z.string().min(1),
  alt: z.string().optional(),
  caption: z.string().optional(),
  action: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

let assistantPanelElementSchemaRef: z.ZodTypeAny;

const tabsElementSchema: z.ZodTypeAny = z.lazy(() => z.object({
  type: z.literal('tabs'),
  widgetId: z.string().min(1).optional(),
  defaultTabId: z.string().min(1).optional(),
  tabs: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      elements: z.array(assistantPanelElementSchemaRef).min(1),
    }),
  ).min(1),
}));

assistantPanelElementSchemaRef = z.discriminatedUnion('type', [
  textElementSchema,
  metricElementSchema,
  listElementSchema,
  tableElementSchema,
  actionElementSchema,
  chartElementSchema,
  inputElementSchema,
  formElementSchema,
  datePickerElementSchema,
  cardElementSchema,
  imageElementSchema,
  tabsElementSchema,
]);

export const assistantPanelElementSchema = assistantPanelElementSchemaRef;

export const assistantPanelSpecSchema = z.object({
  specVersion: z.literal('1'),
  elements: z.array(assistantPanelElementSchema).min(1),
});

export type AssistantPanelElement = z.infer<typeof assistantPanelElementSchema>;
export type AssistantPanelSpec = z.infer<typeof assistantPanelSpecSchema>;

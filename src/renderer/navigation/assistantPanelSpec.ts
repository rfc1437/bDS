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

export interface AssistantResponseContent {
  displayText: string;
  panelSpec: AssistantPanelSpec | null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeChartElement(record: Record<string, unknown>): Record<string, unknown> | null {
  const normalized: Record<string, unknown> = {
    ...record,
  };

  const dataRecord = toRecord(record.data);
  if (Array.isArray(record.series)) {
    return normalized;
  }

  if (!dataRecord) {
    return normalized;
  }

  const labels = Array.isArray(dataRecord.labels) ? dataRecord.labels : [];
  const datasets = Array.isArray(dataRecord.datasets) ? dataRecord.datasets : [];
  const firstDataset = toRecord(datasets[0]);
  const values = Array.isArray(firstDataset?.data) ? firstDataset?.data : [];

  if (labels.length === 0 || values.length === 0) {
    return normalized;
  }

  const series = labels
    .map((label, index) => ({
      label: String(label),
      value: Number(values[index]),
    }))
    .filter((entry) => Number.isFinite(entry.value));

  if (series.length === 0) {
    return normalized;
  }

  normalized.series = series;
  delete normalized.data;
  return normalized;
}

function normalizeTabContent(tabValue: unknown): Record<string, unknown>[] {
  if (Array.isArray(tabValue)) {
    return tabValue.map((entry) => normalizeElement(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const normalized = normalizeElement(tabValue);
  return normalized ? [normalized] : [];
}

function normalizeTabsElement(record: Record<string, unknown>): Record<string, unknown> | null {
  const tabs = Array.isArray(record.tabs) ? record.tabs : [];
  const normalizedTabs = tabs
    .map((tabValue, tabIndex) => {
      const tabRecord = toRecord(tabValue);
      if (!tabRecord) {
        return null;
      }

      const id = typeof tabRecord.id === 'string' && tabRecord.id.trim().length > 0
        ? tabRecord.id
        : `tab-${tabIndex + 1}`;

      const label = typeof tabRecord.label === 'string' && tabRecord.label.trim().length > 0
        ? tabRecord.label
        : typeof tabRecord.title === 'string' && tabRecord.title.trim().length > 0
          ? tabRecord.title
          : id;

      const elements = Array.isArray(tabRecord.elements)
        ? normalizeTabContent(tabRecord.elements)
        : normalizeTabContent(tabRecord.content);

      if (elements.length === 0) {
        return null;
      }

      return {
        id,
        label,
        elements,
      };
    })
    .filter((entry): entry is { id: string; label: string; elements: Record<string, unknown>[] } => Boolean(entry));

  if (normalizedTabs.length === 0) {
    return null;
  }

  return {
    ...record,
    tabs: normalizedTabs,
  };
}

function normalizeElement(value: unknown): Record<string, unknown> | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'markdown') {
    const textValue = typeof record.content === 'string' ? record.content : typeof record.text === 'string' ? record.text : '';
    if (!textValue.trim()) {
      return null;
    }
    return {
      type: 'text',
      text: textValue,
    };
  }

  if (type === 'chart') {
    return normalizeChartElement(record);
  }

  if (type === 'tabs') {
    return normalizeTabsElement(record);
  }

  return record;
}

function normalizeCandidate(parsed: unknown): AssistantPanelSpec | null {
  const canonicalResult = assistantPanelSpecSchema.safeParse(parsed);
  if (canonicalResult.success) {
    return canonicalResult.data;
  }

  const record = toRecord(parsed);
  if (!record) {
    return null;
  }

  if (record.type === 'tab' && record.content) {
    return normalizeCandidate(record.content);
  }

  if (record.type === 'tabs') {
    const tabsElement = normalizeTabsElement(record);
    if (!tabsElement) {
      return null;
    }

    const asSpec = {
      specVersion: '1',
      elements: [tabsElement],
    };
    const normalizedResult = assistantPanelSpecSchema.safeParse(asSpec);
    return normalizedResult.success ? normalizedResult.data : null;
  }

  if (Array.isArray(record.elements)) {
    const normalizedElements = record.elements
      .map((element) => normalizeElement(element))
      .filter((element): element is Record<string, unknown> => Boolean(element));

    if (normalizedElements.length === 0) {
      return null;
    }

    const asSpec = {
      specVersion: '1',
      elements: normalizedElements,
    };
    const normalizedResult = assistantPanelSpecSchema.safeParse(asSpec);
    return normalizedResult.success ? normalizedResult.data : null;
  }

  const normalizedElement = normalizeElement(record);
  if (!normalizedElement) {
    return null;
  }

  const asSpec = {
    specVersion: '1',
    elements: [normalizedElement],
  };
  const normalizedResult = assistantPanelSpecSchema.safeParse(asSpec);
  return normalizedResult.success ? normalizedResult.data : null;
}

function parseSpecCandidate(raw: string): AssistantPanelSpec | null {
  try {
    const parsed = JSON.parse(raw);
    return normalizeCandidate(parsed);
  } catch {
    return null;
  }
}

export function extractAssistantPanelSpec(message: string): AssistantPanelSpec | null {
  return extractAssistantResponseContent(message).panelSpec;
}

export function extractAssistantResponseContent(message: string): AssistantResponseContent {
  const trimmed = message.trim();

  const fencedMatches = [...trimmed.matchAll(/```(json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const candidate = match[2]?.trim();
    if (!candidate) {
      continue;
    }

    const parsed = parseSpecCandidate(candidate);
    if (parsed) {
      const displayText = trimmed.replace(match[0], '').trim();
      return {
        displayText,
        panelSpec: parsed,
      };
    }
  }

  const parsedWholeMessage = parseSpecCandidate(trimmed);
  return {
    displayText: parsedWholeMessage ? '' : trimmed,
    panelSpec: parsedWholeMessage,
  };
}

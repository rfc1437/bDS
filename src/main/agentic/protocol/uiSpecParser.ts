import { assistantPanelSpecSchema, type AssistantPanelSpec } from './uiSchema';

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeChartElement(record: Record<string, unknown>): Record<string, unknown> {
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
    return tabValue
      .map((entry) => normalizeElement(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
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

      return { id, label, elements };
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
    const textValue = typeof record.content === 'string'
      ? record.content
      : typeof record.text === 'string'
        ? record.text
        : '';

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
      specVersion: '1' as const,
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
      specVersion: '1' as const,
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
    specVersion: '1' as const,
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

export interface ParsedAssistantUiResult {
  assistantText: string;
  ui: AssistantPanelSpec | null;
}

export function extractAssistantUiSpec(message: string): ParsedAssistantUiResult {
  const trimmed = message.trim();

  const fencedMatches = [...trimmed.matchAll(/```(json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const candidate = match[2]?.trim();
    if (!candidate) {
      continue;
    }

    const parsed = parseSpecCandidate(candidate);
    if (parsed) {
      const assistantText = trimmed.replace(match[0], '').trim();
      return {
        assistantText,
        ui: parsed,
      };
    }
  }

  const parsedWholeMessage = parseSpecCandidate(trimmed);
  return {
    assistantText: parsedWholeMessage ? '' : trimmed,
    ui: parsedWholeMessage,
  };
}

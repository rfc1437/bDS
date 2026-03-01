import { describe, expect, it } from 'vitest';
import {
  getCatalogEntries,
  isSupportedComponentType,
  getCatalogEntry,
  getCatalogId,
  buildCatalogDescription,
} from '../../../src/main/a2ui/catalog';
import { BDS_CATALOG_ID } from '../../../src/main/a2ui/types';

describe('A2UI catalog', () => {
  it('returns all 18 catalog entries', () => {
    const entries = getCatalogEntries();
    expect(entries).toHaveLength(18);
  });

  it('returns a copy of catalog entries to prevent mutation', () => {
    const entries1 = getCatalogEntries();
    const entries2 = getCatalogEntries();
    expect(entries1).not.toBe(entries2);
    expect(entries1).toEqual(entries2);
  });

  it('recognises all supported component types', () => {
    const types = [
      'text', 'button', 'card', 'chart', 'table', 'form',
      'textField', 'checkBox', 'dateTimeInput', 'choicePicker',
      'image', 'tabs', 'metric', 'list', 'mindmap', 'row', 'column', 'divider',
    ];

    for (const type of types) {
      expect(isSupportedComponentType(type)).toBe(true);
    }
  });

  it('rejects unsupported component types', () => {
    expect(isSupportedComponentType('video')).toBe(false);
    expect(isSupportedComponentType('slider')).toBe(false);
    expect(isSupportedComponentType('')).toBe(false);
  });

  it('returns catalog entry by type', () => {
    const entry = getCatalogEntry('chart');
    expect(entry).toEqual({
      type: 'chart',
      description: 'Bar, stacked-bar, line, area, pie, donut, or heatmap chart visualization',
      custom: true,
    });
  });

  it('returns undefined for unknown type', () => {
    expect(getCatalogEntry('unknown' as never)).toBeUndefined();
  });

  it('returns the bDS catalog ID', () => {
    expect(getCatalogId()).toBe(BDS_CATALOG_ID);
    expect(getCatalogId()).toBe('bds-blogging-v1');
  });

  it('builds a catalog description for LLM system prompt', () => {
    const description = buildCatalogDescription();
    expect(description).toContain('Supported UI component types:');
    expect(description).toContain('text: Text block with Markdown support');
    expect(description).toContain('chart: Bar, stacked-bar, line, area, pie, donut, or heatmap chart visualization (custom)');
    expect(description).toContain('table: Data table with columns and rows (custom)');
  });

  it('marks custom components correctly', () => {
    const entries = getCatalogEntries();
    const customEntries = entries.filter((e) => e.custom);
    const customTypes = customEntries.map((e) => e.type);

    expect(customTypes).toContain('chart');
    expect(customTypes).toContain('table');
    expect(customTypes).toContain('metric');
    expect(customTypes).toContain('form');
    expect(customTypes).toContain('mindmap');
    expect(customTypes).not.toContain('text');
    expect(customTypes).not.toContain('button');
  });
});

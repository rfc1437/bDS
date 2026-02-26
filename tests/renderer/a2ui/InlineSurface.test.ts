import { describe, expect, it } from 'vitest';
import { deriveSurfaceTitle, getSurfaceIcon } from '../../../src/renderer/a2ui/InlineSurface';
import type { A2UIResolvedComponent } from '../../../src/main/a2ui/types';

function makeTree(type: string, properties: Record<string, unknown> = {}): A2UIResolvedComponent[] {
  return [{
    id: `${type}-1`,
    type: type as A2UIResolvedComponent['type'],
    properties,
    children: [],
  }];
}

describe('deriveSurfaceTitle', () => {
  it('extracts title from root component properties', () => {
    expect(deriveSurfaceTitle(makeTree('chart', { title: 'Post Views' }))).toBe('Post Views');
  });

  it('extracts label from root component properties when no title', () => {
    expect(deriveSurfaceTitle(makeTree('metric', { label: 'Total Posts' }))).toBe('Total Posts');
  });

  it('falls back to capitalized component type when no title or label', () => {
    expect(deriveSurfaceTitle(makeTree('chart'))).toBe('Chart');
  });

  it('returns "Surface" for an empty tree', () => {
    expect(deriveSurfaceTitle([])).toBe('Surface');
  });

  it('capitalizes multi-word types correctly', () => {
    expect(deriveSurfaceTitle(makeTree('textField'))).toBe('TextField');
  });
});

describe('getSurfaceIcon', () => {
  it('returns chart icon for chart type', () => {
    expect(getSurfaceIcon(makeTree('chart'))).toBe('\u{1F4CA}');
  });

  it('returns table icon for table type', () => {
    expect(getSurfaceIcon(makeTree('table'))).toBe('\u{1F4CB}');
  });

  it('returns form icon for form type', () => {
    expect(getSurfaceIcon(makeTree('form'))).toBe('\u{1F4DD}');
  });

  it('returns card icon for card type', () => {
    expect(getSurfaceIcon(makeTree('card'))).toBe('\u{1F4C4}');
  });

  it('returns metric icon for metric type', () => {
    expect(getSurfaceIcon(makeTree('metric'))).toBe('\u{1F4CF}');
  });

  it('returns list icon for list type', () => {
    expect(getSurfaceIcon(makeTree('list'))).toBe('\u{1F4CB}');
  });

  it('returns tabs icon for tabs type', () => {
    expect(getSurfaceIcon(makeTree('tabs'))).toBe('\u{1F4C2}');
  });

  it('returns default icon for unknown types', () => {
    expect(getSurfaceIcon(makeTree('text'))).toBe('\u25A0');
  });

  it('returns default icon for empty tree', () => {
    expect(getSurfaceIcon([])).toBe('\u25A0');
  });
});

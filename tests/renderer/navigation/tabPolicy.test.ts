import { describe, expect, it } from 'vitest';
import { getSingletonToolTabSpec, openSingletonToolTab } from '../../../src/renderer/navigation/tabPolicy';

describe('tabPolicy', () => {
  it('provides canonical singleton tab specs', () => {
    expect(getSingletonToolTabSpec('settings')).toEqual({ type: 'settings', id: 'settings', isTransient: false });
    expect(getSingletonToolTabSpec('tags')).toEqual({ type: 'tags', id: 'tags', isTransient: false });
    expect(getSingletonToolTabSpec('style')).toEqual({ type: 'style', id: 'style', isTransient: false });
    expect(getSingletonToolTabSpec('documentation')).toEqual({ type: 'documentation', id: 'documentation', isTransient: false });
    expect(getSingletonToolTabSpec('metadata-diff')).toEqual({ type: 'metadata-diff', id: 'metadata-diff', isTransient: false });
    expect(getSingletonToolTabSpec('site-validation')).toEqual({ type: 'site-validation', id: 'site-validation', isTransient: false });
  });

  it('opens singleton tool tabs using canonical tab spec', () => {
    const openTab = (tab: { type: string; id: string; isTransient: boolean }) => {
      captured = tab;
    };

    let captured: { type: string; id: string; isTransient: boolean } | null = null;

    openSingletonToolTab(openTab, 'site-validation');

    expect(captured).toEqual({ type: 'site-validation', id: 'site-validation', isTransient: false });
  });
});

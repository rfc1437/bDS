import { describe, expect, it } from 'vitest';
import { shouldPropagateMilkdownChange } from '../../../src/renderer/components/MilkdownEditor/MilkdownEditor';

describe('shouldPropagateMilkdownChange', () => {
  it('does not propagate when markdown is unchanged', () => {
    const result = shouldPropagateMilkdownChange({
      markdown: 'Same content',
      prevMarkdown: 'Same content',
      externalContent: 'Same content',
      hasUserInteracted: true,
    });

    expect(result).toBe(false);
  });

  it('does not propagate normalization changes without user interaction', () => {
    const result = shouldPropagateMilkdownChange({
      markdown: 'Line one\n\nLine two',
      prevMarkdown: '',
      externalContent: 'Line one\nLine two',
      hasUserInteracted: false,
    });

    expect(result).toBe(false);
  });

  it('propagates real edits when user has interacted', () => {
    const result = shouldPropagateMilkdownChange({
      markdown: '[Example](https://example.com)',
      prevMarkdown: 'Hello world',
      externalContent: 'Hello world',
      hasUserInteracted: true,
    });

    expect(result).toBe(true);
  });

  it('does not propagate duplicate updates that match external content', () => {
    const result = shouldPropagateMilkdownChange({
      markdown: 'External content',
      prevMarkdown: 'Different previous',
      externalContent: 'External content',
      hasUserInteracted: true,
    });

    expect(result).toBe(false);
  });
});

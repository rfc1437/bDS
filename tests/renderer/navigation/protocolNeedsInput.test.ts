import { describe, expect, it } from 'vitest';
import { toClarificationElements } from '../../../src/renderer/navigation/protocolNeedsInput';

describe('protocolNeedsInput', () => {
  it('builds a clarification form element when required fields are provided', () => {
    const elements = toClarificationElements({
      required: true,
      fields: [
        { key: 'date', label: 'Date', inputType: 'date', required: true },
        { key: 'category', label: 'Category', inputType: 'select', options: [{ label: 'A', value: 'a' }] },
      ],
    });

    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      type: 'form',
      formId: 'agui-needs-input',
      action: 'submitNeedsInput',
    });
  });

  it('returns empty elements when input is not required', () => {
    const elements = toClarificationElements({
      required: false,
      fields: [],
    });

    expect(elements).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { extractAssistantPanelSpec, extractAssistantResponseContent } from '../../../src/renderer/navigation/assistantPanelSpec';

describe('assistantPanelSpec', () => {
  it('extracts valid spec from fenced json block', () => {
    const raw = [
      'Here is the analysis summary.',
      '```json',
      '{"specVersion":"1","elements":[{"type":"metric","label":"Drafts","value":"12"}]}',
      '```',
    ].join('\n');

    const result = extractAssistantPanelSpec(raw);

    expect(result).not.toBeNull();
    expect(result?.specVersion).toBe('1');
    expect(result?.elements).toHaveLength(1);
    expect(result?.elements[0]).toEqual({ type: 'metric', label: 'Drafts', value: '12' });
  });

  it('returns null for invalid schema payload', () => {
    const raw = '{"specVersion":"1","elements":[{"type":"table","columns":[]}]}';
    const result = extractAssistantPanelSpec(raw);
    expect(result).toBeNull();
  });

  it('ignores yaml payloads to keep the protocol JSON-only', () => {
    const raw = [
      'Here is your chart.',
      '```yaml',
      'specVersion: "1"',
      'elements:',
      '  - type: chart',
      '    chartType: bar',
      '    title: Posts by Month',
      '    series:',
      '      - label: Jan',
      '        value: 10',
      '      - label: Feb',
      '        value: 20',
      '```',
    ].join('\n');

    const result = extractAssistantPanelSpec(raw);
    expect(result).toBeNull();
  });

  it('extracts text plus ui payload from mixed assistant response', () => {
    const raw = [
      'I found two weak months. Please confirm how to proceed.',
      '```json',
      '{"specVersion":"1","elements":[{"type":"chart","chartType":"bar","title":"Posts by Month","series":[{"label":"Jan","value":10},{"label":"Feb","value":20}]}]}',
      '```',
    ].join('\n\n');

    const result = extractAssistantResponseContent(raw);

    expect(result.displayText).toContain('I found two weak months');
    expect(result.panelSpec).not.toBeNull();
    expect(result.panelSpec?.elements[0]).toMatchObject({ type: 'chart', chartType: 'bar' });
  });

  it('normalizes tab-channel envelope payloads into canonical panel spec', () => {
    const raw = JSON.stringify({
      type: 'tab',
      title: 'Posts mit Tag spielen',
      id: 'spielen-tag-analysis',
      content: {
        type: 'tabs',
        tabs: [
          {
            id: 'yearly-chart',
            title: 'Jahresübersicht',
            content: {
              type: 'chart',
              chartType: 'bar',
              data: {
                labels: ['2011', '2013'],
                datasets: [{ data: [2, 8] }],
              },
            },
          },
        ],
      },
    });

    const result = extractAssistantPanelSpec(raw);

    expect(result).not.toBeNull();
    expect(result?.specVersion).toBe('1');
    expect(result?.elements[0]).toMatchObject({ type: 'tabs' });
  });

  it('normalizes chartjs-like chart payloads to series format', () => {
    const raw = JSON.stringify({
      specVersion: '1',
      elements: [
        {
          type: 'chart',
          chartType: 'bar',
          data: {
            labels: ['Jan', 'Feb', 'Mar'],
            datasets: [{ data: [23, 10, 14] }],
          },
        },
      ],
    });

    const result = extractAssistantPanelSpec(raw);

    expect(result).not.toBeNull();
    expect(result?.elements[0]).toMatchObject({
      type: 'chart',
      chartType: 'bar',
      series: [
        { label: 'Jan', value: 23 },
        { label: 'Feb', value: 10 },
        { label: 'Mar', value: 14 },
      ],
    });
  });

  it('parses extended widgets including chart, form, datePicker, card, image, input and tabs', () => {
    const raw = JSON.stringify({
      specVersion: '1',
      elements: [
        {
          type: 'chart',
          chartType: 'bar',
          title: 'Posts by Month',
          series: [
            { label: 'Jan', value: 10 },
            { label: 'Feb', value: 20 },
          ],
        },
        {
          type: 'input',
          key: 'query',
          label: 'Search Query',
          inputType: 'text',
          placeholder: 'Find post',
        },
        {
          type: 'datePicker',
          key: 'publishDate',
          label: 'Publish Date',
        },
        {
          type: 'form',
          formId: 'meta-form',
          title: 'Update Metadata',
          submitLabel: 'Apply',
          action: 'updatePostMetadata',
          fields: [
            { key: 'title', label: 'Title', inputType: 'text' },
            { key: 'isDraft', label: 'Draft', inputType: 'checkbox' },
          ],
        },
        {
          type: 'card',
          title: 'Suggestion',
          body: 'Consider adding tags.',
          actions: [
            { label: 'Open Tags', action: 'switchView', payload: { view: 'tags' } },
          ],
        },
        {
          type: 'image',
          src: 'https://example.com/image.png',
          alt: 'Preview',
          caption: 'Generated preview',
        },
        {
          type: 'tabs',
          tabs: [
            {
              id: 'summary',
              label: 'Summary',
              elements: [{ type: 'text', text: 'Summary text' }],
            },
            {
              id: 'details',
              label: 'Details',
              elements: [{ type: 'metric', label: 'Count', value: '42' }],
            },
          ],
        },
      ],
    });

    const result = extractAssistantPanelSpec(raw);
    expect(result).not.toBeNull();
    expect(result?.elements).toHaveLength(7);
  });
});

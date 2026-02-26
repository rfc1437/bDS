import { describe, expect, it } from 'vitest';
import {
  isRenderTool,
  generateFromToolCall,
  generateChart,
  generateTable,
  generateForm,
  generateCard,
  generateMetric,
  generateList,
  generateTabs,
} from '../../../src/main/a2ui/generator';
import type { A2UIServerMessage } from '../../../src/main/a2ui/types';

describe('A2UI generator', () => {
  describe('isRenderTool', () => {
    it('returns true for all render tools', () => {
      expect(isRenderTool('render_chart')).toBe(true);
      expect(isRenderTool('render_table')).toBe(true);
      expect(isRenderTool('render_form')).toBe(true);
      expect(isRenderTool('render_card')).toBe(true);
      expect(isRenderTool('render_metric')).toBe(true);
      expect(isRenderTool('render_list')).toBe(true);
      expect(isRenderTool('render_tabs')).toBe(true);
    });

    it('returns false for non-render tools', () => {
      expect(isRenderTool('search_posts')).toBe(false);
      expect(isRenderTool('get_post')).toBe(false);
      expect(isRenderTool('render_unknown')).toBe(false);
      expect(isRenderTool('')).toBe(false);
    });
  });

  describe('generateFromToolCall', () => {
    it('dispatches to chart generator', () => {
      const messages = generateFromToolCall('conv-1', 'render_chart', {
        chartType: 'bar',
        series: [{ label: 'A', value: 1 }],
      });

      expect(messages).not.toBeNull();
      expect(messages!.length).toBeGreaterThanOrEqual(2);
      expect(messages![0].type).toBe('createSurface');
    });

    it('returns null for unknown tool', () => {
      expect(generateFromToolCall('conv-1', 'search_posts', {})).toBeNull();
    });
  });

  describe('generateChart', () => {
    it('creates surface with chart component and data binding', () => {
      const messages = generateChart('conv-1', {
        chartType: 'bar',
        title: 'Sales',
        series: [
          { label: 'Jan', value: 10 },
          { label: 'Feb', value: 20 },
        ],
      });

      expect(messages).toHaveLength(3); // createSurface + updateComponents + updateDataModel

      const createMsg = messages[0] as Extract<A2UIServerMessage, { type: 'createSurface' }>;
      expect(createMsg.type).toBe('createSurface');
      expect(createMsg.conversationId).toBe('conv-1');

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      expect(updateMsg.type).toBe('updateComponents');
      expect(updateMsg.components).toHaveLength(1);
      expect(updateMsg.components[0].type).toBe('chart');
      expect(updateMsg.components[0].properties.chartType).toBe('bar');
      expect(updateMsg.components[0].dataBinding).toBe('/chartData');
      expect(updateMsg.rootIds).toHaveLength(1);

      const dataMsg = messages[2] as Extract<A2UIServerMessage, { type: 'updateDataModel' }>;
      expect(dataMsg.type).toBe('updateDataModel');
      expect(dataMsg.path).toBe('/chartData');
      expect(dataMsg.value).toEqual([
        { label: 'Jan', value: 10 },
        { label: 'Feb', value: 20 },
      ]);
    });
  });

  describe('generateTable', () => {
    it('creates surface with table component and row data', () => {
      const messages = generateTable('conv-1', {
        title: 'Posts',
        columns: ['Title', 'Status'],
        rows: [['Hello', 'published'], ['Draft', 'draft']],
      });

      expect(messages).toHaveLength(3);

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      expect(updateMsg.components[0].type).toBe('table');
      expect(updateMsg.components[0].properties.columns).toEqual(['Title', 'Status']);

      const dataMsg = messages[2] as Extract<A2UIServerMessage, { type: 'updateDataModel' }>;
      expect(dataMsg.path).toBe('/tableRows');
      expect(dataMsg.value).toEqual([['Hello', 'published'], ['Draft', 'draft']]);
    });
  });

  describe('generateCard', () => {
    it('creates surface with card component', () => {
      const messages = generateCard('conv-1', {
        title: 'My Card',
        body: 'Card body text',
        subtitle: 'Optional subtitle',
      });

      expect(messages).toHaveLength(2); // No data model for card

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      expect(updateMsg.components[0].type).toBe('card');
      expect(updateMsg.components[0].properties.title).toBe('My Card');
      expect(updateMsg.components[0].properties.body).toBe('Card body text');
    });

    it('includes card actions when provided', () => {
      const messages = generateCard('conv-1', {
        title: 'Action Card',
        body: 'Has actions',
        actions: [{ label: 'Open', action: 'openPost', payload: { postId: 'p1' } }],
      });

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      expect(updateMsg.components[0].actions).toEqual([
        { eventType: 'click', action: 'openPost', payload: { postId: 'p1' } },
      ]);
    });
  });

  describe('generateMetric', () => {
    it('creates surface with metric component', () => {
      const messages = generateMetric('conv-1', {
        label: 'Total Posts',
        value: '42',
      });

      expect(messages).toHaveLength(2);

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      expect(updateMsg.components[0].type).toBe('metric');
      expect(updateMsg.components[0].properties.label).toBe('Total Posts');
      expect(updateMsg.components[0].properties.value).toBe('42');
    });
  });

  describe('generateList', () => {
    it('creates surface with list component and item data', () => {
      const messages = generateList('conv-1', {
        title: 'Tags',
        items: ['react', 'typescript', 'electron'],
      });

      expect(messages).toHaveLength(3);

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      expect(updateMsg.components[0].type).toBe('list');

      const dataMsg = messages[2] as Extract<A2UIServerMessage, { type: 'updateDataModel' }>;
      expect(dataMsg.path).toBe('/listItems');
      expect(dataMsg.value).toEqual(['react', 'typescript', 'electron']);
    });
  });

  describe('generateForm', () => {
    it('creates surface with form, field components, and submit button', () => {
      const messages = generateForm('conv-1', {
        title: 'Edit Post',
        submitLabel: 'Save',
        fields: [
          { key: 'title', label: 'Title', inputType: 'text', defaultValue: 'Hello' },
          { key: 'draft', label: 'Draft', inputType: 'checkbox', defaultValue: true },
        ],
      });

      // createSurface + updateComponents + 2 updateDataModel (one per default value)
      expect(messages).toHaveLength(4);

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      // form + 2 fields + 1 submit button = 4
      expect(updateMsg.components).toHaveLength(4);

      const formComponent = updateMsg.components.find((c) => c.type === 'form');
      expect(formComponent).toBeDefined();
      expect(formComponent!.children).toHaveLength(3); // 2 fields + submit button

      const textField = updateMsg.components.find((c) => c.type === 'textField');
      expect(textField).toBeDefined();
      expect(textField!.dataBinding).toBe('/formData/title');

      const checkBox = updateMsg.components.find((c) => c.type === 'checkBox');
      expect(checkBox).toBeDefined();
      expect(checkBox!.dataBinding).toBe('/formData/draft');

      const submitButton = updateMsg.components.find((c) => c.type === 'button');
      expect(submitButton).toBeDefined();
      expect(submitButton!.properties.label).toBe('Save');
    });

    it('maps select inputType to choicePicker', () => {
      const messages = generateForm('conv-1', {
        submitLabel: 'Go',
        fields: [
          {
            key: 'status',
            label: 'Status',
            inputType: 'select',
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Published', value: 'published' },
            ],
          },
        ],
      });

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      const picker = updateMsg.components.find((c) => c.type === 'choicePicker');
      expect(picker).toBeDefined();
    });

    it('maps date inputType to dateTimeInput', () => {
      const messages = generateForm('conv-1', {
        submitLabel: 'Set',
        fields: [{ key: 'date', label: 'Date', inputType: 'date' }],
      });

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      const dateInput = updateMsg.components.find((c) => c.type === 'dateTimeInput');
      expect(dateInput).toBeDefined();
    });
  });

  describe('generateTabs', () => {
    it('creates surface with tabs and child components', () => {
      const messages = generateTabs('conv-1', {
        tabs: [
          {
            label: 'Overview',
            content: [{ type: 'text', text: 'Tab content' }],
          },
          {
            label: 'Details',
            content: [{ type: 'metric', label: 'Count', value: '5' }],
          },
        ],
      });

      expect(messages).toHaveLength(2); // createSurface + updateComponents

      const updateMsg = messages[1] as Extract<A2UIServerMessage, { type: 'updateComponents' }>;
      const tabsComponent = updateMsg.components.find((c) => c.type === 'tabs');
      expect(tabsComponent).toBeDefined();
      expect(tabsComponent!.children).toHaveLength(2);
      expect(tabsComponent!.properties.tabLabels).toEqual(['Overview', 'Details']);
    });
  });
});

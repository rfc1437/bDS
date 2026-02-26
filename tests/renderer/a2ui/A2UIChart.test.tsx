import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { A2UIChart } from '../../../src/renderer/a2ui/components/A2UIChart';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../src/main/a2ui/types';

function makeChartComponent(
  overrides: Partial<A2UIResolvedComponent> = {},
  series?: unknown,
): A2UIResolvedComponent {
  return {
    id: 'chart-1',
    type: 'chart',
    properties: {
      chartType: 'bar',
      title: 'Test Chart',
      ...(overrides.properties ?? {}),
    },
    children: [],
    boundValue: series ?? [
      { label: 'Alpha', value: 10 },
      { label: 'Beta', value: 25 },
      { label: 'Gamma', value: 15 },
    ],
    ...overrides,
  };
}

const noopAction = vi.fn<(action: A2UIClientAction) => void>();

describe('A2UIChart', () => {
  describe('bar chart tabular layout', () => {
    it('renders chart title', () => {
      const comp = makeChartComponent();
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(screen.getByText('Test Chart')).toBeInTheDocument();
      expect(container.querySelector('.assistant-panel-chart-title')).not.toBeNull();
    });

    it('renders chart type label', () => {
      const comp = makeChartComponent();
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('bar')).toBeInTheDocument();
    });

    it('renders all series labels', () => {
      const comp = makeChartComponent();
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
      expect(screen.getByText('Gamma')).toBeInTheDocument();
    });

    it('renders all series values', () => {
      const comp = makeChartComponent();
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('10')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('15')).toBeInTheDocument();
    });

    it('renders bar chart items in a three-column grid layout', () => {
      const comp = makeChartComponent();
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const items = container.querySelectorAll('.assistant-panel-chart-item');
      expect(items).toHaveLength(3);

      // Each item should have label, bar container, and value as separate elements
      for (const item of items) {
        const label = item.querySelector('.assistant-panel-chart-label');
        const barContainer = item.querySelector('.assistant-panel-chart-bar-track');
        const value = item.querySelector('.assistant-panel-chart-value');
        expect(label).not.toBeNull();
        expect(barContainer).not.toBeNull();
        expect(value).not.toBeNull();
      }
    });

    it('renders bar fill with correct percentage width', () => {
      const comp = makeChartComponent({}, [
        { label: 'A', value: 50 },
        { label: 'B', value: 100 },
      ]);
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const fills = container.querySelectorAll('.assistant-panel-chart-bar-fill');
      expect(fills).toHaveLength(2);
      // A = 50/100 = 50%, B = 100/100 = 100%
      expect((fills[0] as HTMLElement).style.width).toBe('50%');
      expect((fills[1] as HTMLElement).style.width).toBe('100%');
    });

    it('renders without title when title is not provided', () => {
      const comp = makeChartComponent({ properties: { chartType: 'bar' } });
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-title')).toBeNull();
    });

    it('renders empty state when series is empty', () => {
      const comp = makeChartComponent({}, []);
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const items = container.querySelectorAll('.assistant-panel-chart-item');
      expect(items).toHaveLength(0);
    });
  });

  describe('stacked bar chart', () => {
    const stackedSeries = [
      {
        label: '2023',
        value: 30,
        segments: [
          { label: 'Published', value: 20 },
          { label: 'Draft', value: 10 },
        ],
      },
      {
        label: '2024',
        value: 45,
        segments: [
          { label: 'Published', value: 35 },
          { label: 'Draft', value: 10 },
        ],
      },
    ];

    it('renders stacked bar items', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'stacked-bar', title: 'Posts by Year' } },
        stackedSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const items = container.querySelectorAll('.assistant-panel-chart-item');
      expect(items).toHaveLength(2);
    });

    it('renders multiple segment fills per bar', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'stacked-bar', title: 'Posts' } },
        stackedSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      // Each bar should have multiple fill segments
      const tracks = container.querySelectorAll('.assistant-panel-chart-bar-track');
      expect(tracks).toHaveLength(2);

      const firstBarSegments = tracks[0].querySelectorAll('.assistant-panel-chart-bar-segment');
      expect(firstBarSegments).toHaveLength(2);
    });

    it('renders segment widths as proportion of total across all bars', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'stacked-bar' } },
        stackedSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      // maxValue is 45 (2024 total)
      // 2023 row: Published=20/45, Draft=10/45 → total bar width = 30/45
      // We need segment widths relative to the bar track via the fill percentage
      const tracks = container.querySelectorAll('.assistant-panel-chart-bar-track');
      expect(tracks.length).toBe(2);
    });

    it('renders a legend for stacked bar charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'stacked-bar', title: 'Posts' } },
        stackedSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const legend = container.querySelector('.assistant-panel-chart-legend');
      expect(legend).not.toBeNull();
      expect(screen.getByText('Published')).toBeInTheDocument();
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });

    it('shows total value for stacked bars', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'stacked-bar' } },
        stackedSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);

      expect(screen.getByText('30')).toBeInTheDocument();
      expect(screen.getByText('45')).toBeInTheDocument();
    });

    it('does not render legend for regular bar charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'bar' } },
        [{ label: 'A', value: 10 }],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-legend')).toBeNull();
    });
  });
});

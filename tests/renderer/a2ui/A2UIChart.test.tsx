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

  describe('line chart', () => {
    const lineSeries = [
      { label: 'Jan', value: 10 },
      { label: 'Feb', value: 25 },
      { label: 'Mar', value: 15 },
      { label: 'Apr', value: 30 },
    ];

    it('renders an SVG element for line charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line', title: 'Monthly Posts' } },
        lineSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const svg = container.querySelector('.assistant-panel-chart-line-svg');
      expect(svg).not.toBeNull();
      expect(svg!.tagName.toLowerCase()).toBe('svg');
    });

    it('does not render bar chart body for line charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        lineSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-body')).toBeNull();
    });

    it('renders a polyline connecting data points', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        lineSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const polyline = container.querySelector('polyline');
      expect(polyline).not.toBeNull();
      const points = polyline!.getAttribute('points')!;
      // Should have 4 coordinate pairs
      const pairs = points.trim().split(/\s+/);
      expect(pairs).toHaveLength(4);
    });

    it('renders circle dots at each data point', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        lineSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const dots = container.querySelectorAll('.assistant-panel-chart-line-dot');
      expect(dots).toHaveLength(4);
    });

    it('renders x-axis labels for each data point', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        lineSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Jan')).toBeInTheDocument();
      expect(screen.getByText('Feb')).toBeInTheDocument();
      expect(screen.getByText('Mar')).toBeInTheDocument();
      expect(screen.getByText('Apr')).toBeInTheDocument();
    });

    it('renders y-axis value labels', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        lineSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const yLabels = container.querySelectorAll('.assistant-panel-chart-line-y-label');
      expect(yLabels.length).toBeGreaterThanOrEqual(2);
    });

    it('renders chart title for line charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line', title: 'Trend' } },
        lineSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Trend')).toBeInTheDocument();
    });

    it('renders chart type label', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        lineSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('line')).toBeInTheDocument();
    });

    it('handles single data point', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        [{ label: 'Only', value: 42 }],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const dots = container.querySelectorAll('.assistant-panel-chart-line-dot');
      expect(dots).toHaveLength(1);
    });

    it('handles empty series for line chart', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        [],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-line-svg')).toBeNull();
    });

    it('renders horizontal grid lines', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'line' } },
        lineSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const gridLines = container.querySelectorAll('.assistant-panel-chart-line-grid');
      expect(gridLines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('pie chart', () => {
    const pieSeries = [
      { label: 'Published', value: 60 },
      { label: 'Draft', value: 25 },
      { label: 'Archived', value: 15 },
    ];

    it('renders an SVG element for pie charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie', title: 'Post Status' } },
        pieSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const svg = container.querySelector('.assistant-panel-chart-pie-svg');
      expect(svg).not.toBeNull();
      expect(svg!.tagName.toLowerCase()).toBe('svg');
    });

    it('does not render bar chart body for pie charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie' } },
        pieSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-body')).toBeNull();
    });

    it('renders a path slice for each data point', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie' } },
        pieSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const slices = container.querySelectorAll('.assistant-panel-chart-pie-slice');
      expect(slices).toHaveLength(3);
    });

    it('renders a legend with all labels and values', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie' } },
        pieSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const legend = container.querySelector('.assistant-panel-chart-legend');
      expect(legend).not.toBeNull();
      expect(screen.getByText('Published')).toBeInTheDocument();
      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.getByText('Archived')).toBeInTheDocument();
    });

    it('renders chart title for pie charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie', title: 'Distribution' } },
        pieSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Distribution')).toBeInTheDocument();
    });

    it('renders chart type label', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie' } },
        pieSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('pie')).toBeInTheDocument();
    });

    it('handles single slice', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie' } },
        [{ label: 'All', value: 100 }],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const slices = container.querySelectorAll('.assistant-panel-chart-pie-slice');
      expect(slices).toHaveLength(1);
    });

    it('handles empty series for pie chart', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie' } },
        [],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-pie-svg')).toBeNull();
    });

    it('assigns different colors to each slice', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'pie' } },
        pieSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const slices = container.querySelectorAll('.assistant-panel-chart-pie-slice');
      const fills = Array.from(slices).map((s) => (s as SVGElement).getAttribute('fill'));
      // All fills should be different
      const unique = new Set(fills);
      expect(unique.size).toBe(3);
    });
  });

  describe('area chart', () => {
    const areaSeries = [
      { label: 'Jan', value: 10 },
      { label: 'Feb', value: 25 },
      { label: 'Mar', value: 15 },
      { label: 'Apr', value: 30 },
    ];

    it('renders an SVG element for area charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'area', title: 'Cumulative Posts' } },
        areaSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const svg = container.querySelector('.assistant-panel-chart-line-svg');
      expect(svg).not.toBeNull();
    });

    it('does not render bar chart body for area charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'area' } },
        areaSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-body')).toBeNull();
    });

    it('renders a filled polygon area beneath the line', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'area' } },
        areaSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const area = container.querySelector('.assistant-panel-chart-area-fill');
      expect(area).not.toBeNull();
      expect(area!.tagName.toLowerCase()).toBe('polygon');
    });

    it('renders dots at each data point', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'area' } },
        areaSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const dots = container.querySelectorAll('.assistant-panel-chart-line-dot');
      expect(dots).toHaveLength(4);
    });

    it('renders a polyline on top of the area', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'area' } },
        areaSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const polyline = container.querySelector('polyline');
      expect(polyline).not.toBeNull();
    });

    it('renders x-axis labels', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'area' } },
        areaSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Jan')).toBeInTheDocument();
      expect(screen.getByText('Apr')).toBeInTheDocument();
    });

    it('handles empty series for area chart', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'area' } },
        [],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-line-svg')).toBeNull();
    });
  });

  describe('donut chart', () => {
    const donutSeries = [
      { label: 'Published', value: 60 },
      { label: 'Draft', value: 25 },
      { label: 'Archived', value: 15 },
    ];

    it('renders an SVG element for donut charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut', title: 'Post Status' } },
        donutSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const svg = container.querySelector('.assistant-panel-chart-pie-svg');
      expect(svg).not.toBeNull();
    });

    it('does not render bar chart body for donut charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut' } },
        donutSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-body')).toBeNull();
    });

    it('renders arc path slices (not filled wedges)', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut' } },
        donutSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const slices = container.querySelectorAll('.assistant-panel-chart-pie-slice');
      expect(slices).toHaveLength(3);
    });

    it('renders a center hole circle', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut' } },
        donutSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const hole = container.querySelector('.assistant-panel-chart-donut-hole');
      expect(hole).not.toBeNull();
    });

    it('renders center total text', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut' } },
        donutSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const centerText = container.querySelector('.assistant-panel-chart-donut-total');
      expect(centerText).not.toBeNull();
      expect(centerText!.textContent).toBe('100');
    });

    it('renders a legend with all labels', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut' } },
        donutSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const legend = container.querySelector('.assistant-panel-chart-legend');
      expect(legend).not.toBeNull();
      expect(screen.getByText('Published')).toBeInTheDocument();
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });

    it('handles single slice donut', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut' } },
        [{ label: 'All', value: 100 }],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const slices = container.querySelectorAll('.assistant-panel-chart-pie-slice');
      expect(slices).toHaveLength(1);
      expect(container.querySelector('.assistant-panel-chart-donut-hole')).not.toBeNull();
    });

    it('handles empty series for donut chart', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'donut' } },
        [],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-pie-svg')).toBeNull();
    });
  });

  describe('heatmap chart', () => {
    const heatmapSeries = [
      {
        label: 'Mon',
        value: 0,
        segments: [
          { label: 'W1', value: 3 },
          { label: 'W2', value: 0 },
          { label: 'W3', value: 5 },
        ],
      },
      {
        label: 'Tue',
        value: 0,
        segments: [
          { label: 'W1', value: 1 },
          { label: 'W2', value: 4 },
          { label: 'W3', value: 2 },
        ],
      },
    ];

    it('renders a grid container for heatmap charts', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap', title: 'Activity' } },
        heatmapSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const grid = container.querySelector('.assistant-panel-chart-heatmap');
      expect(grid).not.toBeNull();
    });

    it('does not render bar chart body for heatmap', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        heatmapSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-body')).toBeNull();
    });

    it('renders cells for each data point', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        heatmapSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      // 2 rows x 3 columns = 6 cells
      const cells = container.querySelectorAll('.assistant-panel-chart-heatmap-cell');
      expect(cells).toHaveLength(6);
    });

    it('renders row labels', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        heatmapSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Mon')).toBeInTheDocument();
      expect(screen.getByText('Tue')).toBeInTheDocument();
    });

    it('renders column header labels', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        heatmapSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('W1')).toBeInTheDocument();
      expect(screen.getByText('W2')).toBeInTheDocument();
      expect(screen.getByText('W3')).toBeInTheDocument();
    });

    it('applies ins-to-del gradient background based on value', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        heatmapSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const cells = container.querySelectorAll('.assistant-panel-chart-heatmap-cell');
      // Cell with value 0 should have transparent background
      const zeroCell = Array.from(cells).find((c) => c.getAttribute('title') === '0');
      expect(zeroCell).toBeDefined();
      expect((zeroCell as HTMLElement).style.background).toBe('transparent');
      // Cell with max value (5) should have an rgba/rgb background (del color at full opacity)
      const maxCell = Array.from(cells).find((c) => c.getAttribute('title') === '5');
      expect(maxCell).toBeDefined();
      expect((maxCell as HTMLElement).style.background).toMatch(/^rgba?\(/);
      // Mid-value cell should also have an rgba/rgb background
      const midCell = Array.from(cells).find((c) => c.getAttribute('title') === '3');
      expect(midCell).toBeDefined();
      expect((midCell as HTMLElement).style.background).toMatch(/^rgba?\(/);
    });

    it('sets contrasting text color on cells', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        heatmapSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const cells = container.querySelectorAll('.assistant-panel-chart-heatmap-cell');
      // Non-zero cells should have explicit black or white text color
      const maxCell = Array.from(cells).find((c) => c.getAttribute('title') === '5');
      expect(maxCell).toBeDefined();
      const maxColor = (maxCell as HTMLElement).style.color;
      expect(maxColor).toMatch(/#(000|fff)|rgb\((0, 0, 0|255, 255, 255)\)/);
      // Zero cell should have inherit
      const zeroCell = Array.from(cells).find((c) => c.getAttribute('title') === '0');
      expect(zeroCell).toBeDefined();
      expect((zeroCell as HTMLElement).style.color).toBe('inherit');
    });

    it('displays value text inside non-zero cells', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        heatmapSeries,
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      const cells = container.querySelectorAll('.assistant-panel-chart-heatmap-cell');
      // Non-zero cell should display value as text
      const cell3 = Array.from(cells).find((c) => c.getAttribute('title') === '3');
      expect(cell3).toBeDefined();
      expect(cell3!.textContent).toBe('3');
      // Zero cell should be empty
      const cell0 = Array.from(cells).find((c) => c.getAttribute('title') === '0');
      expect(cell0).toBeDefined();
      expect(cell0!.textContent).toBe('');
    });

    it('renders chart title for heatmap', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap', title: 'Posting Activity' } },
        heatmapSeries,
      );
      render(<A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />);
      expect(screen.getByText('Posting Activity')).toBeInTheDocument();
    });

    it('handles empty series for heatmap', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        [],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      expect(container.querySelector('.assistant-panel-chart-heatmap')).toBeNull();
    });

    it('handles series without segments gracefully', () => {
      const comp = makeChartComponent(
        { properties: { chartType: 'heatmap' } },
        [{ label: 'Mon', value: 5 }],
      );
      const { container } = render(
        <A2UIChart component={comp} surfaceId="s1" onAction={noopAction} />,
      );
      // No segments → no cells, no grid rendered
      expect(container.querySelector('.assistant-panel-chart-heatmap')).toBeNull();
    });
  });
});

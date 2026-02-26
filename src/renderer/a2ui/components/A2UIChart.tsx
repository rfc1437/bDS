import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

interface SegmentEntry {
  label: string;
  value: number;
}

interface SeriesEntry {
  label: string;
  value: number;
  segments?: SegmentEntry[];
}

const SEGMENT_COLORS = [
  'var(--vscode-charts-blue, #75beff)',
  'var(--vscode-charts-green, #89d185)',
  'var(--vscode-charts-orange, #d18616)',
  'var(--vscode-charts-red, #f14c4c)',
  'var(--vscode-charts-purple, #b180d7)',
  'var(--vscode-charts-yellow, #e2e210)',
];

function getSegmentColor(index: number): string {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length];
}

/** Collect unique segment labels across all series entries, preserving order. */
function collectSegmentLabels(series: SeriesEntry[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const entry of series) {
    if (entry.segments) {
      for (const seg of entry.segments) {
        if (!seen.has(seg.label)) {
          seen.add(seg.label);
          labels.push(seg.label);
        }
      }
    }
  }
  return labels;
}

export const A2UIChart: React.FC<A2UIComponentProps> = ({ component }) => {
  const chartType = String(component.properties.chartType ?? 'bar');
  const title = component.properties.title as string | undefined;
  const series = (component.boundValue as SeriesEntry[]) ?? (component.properties.series as SeriesEntry[]) ?? [];
  const isStacked = chartType === 'stacked-bar';

  const maxValue = Math.max(
    ...series.map((entry) => {
      if (isStacked && entry.segments) {
        return entry.segments.reduce((sum, s) => sum + s.value, 0);
      }
      return entry.value;
    }),
    0,
  );

  const segmentLabels = isStacked ? collectSegmentLabels(series) : [];

  return (
    <div className="assistant-panel-chart">
      {title && <p className="assistant-panel-chart-title">{title}</p>}
      <div className="assistant-panel-chart-type">{chartType}</div>
      <div className="assistant-panel-chart-body">
        {series.map((entry, index) => {
          const totalValue = isStacked && entry.segments
            ? entry.segments.reduce((sum, s) => sum + s.value, 0)
            : entry.value;

          return (
            <div key={`${component.id}-series-${index}`} className="assistant-panel-chart-item">
              <span className="assistant-panel-chart-label">{entry.label}</span>
              <div className="assistant-panel-chart-bar-track">
                {isStacked && entry.segments ? (
                  entry.segments.map((seg, si) => {
                    const segWidth = maxValue > 0 ? (seg.value / maxValue) * 100 : 0;
                    return (
                      <div
                        key={`${component.id}-seg-${index}-${si}`}
                        className="assistant-panel-chart-bar-segment"
                        style={{
                          width: `${segWidth}%`,
                          backgroundColor: getSegmentColor(segmentLabels.indexOf(seg.label)),
                        }}
                        title={`${seg.label}: ${seg.value}`}
                      />
                    );
                  })
                ) : (
                  <div
                    className="assistant-panel-chart-bar-fill"
                    style={{ width: `${maxValue > 0 ? (entry.value / maxValue) * 100 : 0}%` }}
                  />
                )}
              </div>
              <span className="assistant-panel-chart-value">{totalValue}</span>
            </div>
          );
        })}
      </div>
      {isStacked && segmentLabels.length > 0 && (
        <div className="assistant-panel-chart-legend">
          {segmentLabels.map((label, i) => (
            <span key={label} className="assistant-panel-chart-legend-item">
              <span
                className="assistant-panel-chart-legend-swatch"
                style={{ backgroundColor: getSegmentColor(i) }}
              />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

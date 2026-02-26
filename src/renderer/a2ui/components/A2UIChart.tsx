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

/* ── Heatmap colour helpers ── */

type RGB = [number, number, number];

const FALLBACK_INS: RGB = [53, 117, 56];
const FALLBACK_DEL: RGB = [183, 72, 72];

/** Parse a CSS color value (hex or rgb/rgba) into an [r,g,b] triple. */
function parseCssColor(raw: string): RGB | null {
  const v = raw.trim();
  const hexMatch = v.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgbMatch = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const channels = rgbMatch[1].split(',').map((c) => Math.round(Number.parseFloat(c.trim()))).slice(0, 3);
    if (channels.length === 3 && channels.every((c) => Number.isFinite(c))) {
      return channels.map((c) => Math.max(0, Math.min(255, c))) as RGB;
    }
  }
  return null;
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Relative luminance (0-255 scale) for contrast decision. */
function luminance(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function readPicoInsDelColors(): { ins: RGB; del: RGB } {
  try {
    const style = window.getComputedStyle(document.documentElement);
    const ins = parseCssColor(style.getPropertyValue('--pico-ins-color')) ?? FALLBACK_INS;
    const del = parseCssColor(style.getPropertyValue('--pico-del-color')) ?? FALLBACK_DEL;
    return { ins, del };
  } catch {
    return { ins: FALLBACK_INS, del: FALLBACK_DEL };
  }
}

/** Compute heatmap cell background and contrasting text color. */
function heatmapCellColors(alpha: number, ins: RGB, del: RGB): { bg: string; fg: string } {
  if (alpha <= 0) return { bg: 'transparent', fg: 'inherit' };
  const rgb = lerpRGB(ins, del, alpha);
  // Scale opacity so even low values are visible (0.25 → 1.0)
  const opacity = 0.25 + alpha * 0.75;
  const bg = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${opacity.toFixed(2)})`;
  // Blend the effective RGB with the assumed dark background (~30) for contrast calc
  const effective: RGB = [
    Math.round(rgb[0] * opacity + 30 * (1 - opacity)),
    Math.round(rgb[1] * opacity + 30 * (1 - opacity)),
    Math.round(rgb[2] * opacity + 30 * (1 - opacity)),
  ];
  const fg = luminance(effective) > 140 ? '#000' : '#fff';
  return { bg, fg };
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

/** Generate nice round tick values for the Y-axis. */
function computeYTicks(maxValue: number, tickCount: number = 4): number[] {
  if (maxValue <= 0) return [0];
  const rawStep = maxValue / (tickCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalised = rawStep / magnitude;
  let niceStep: number;
  if (normalised <= 1) niceStep = magnitude;
  else if (normalised <= 2) niceStep = 2 * magnitude;
  else if (normalised <= 5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + niceStep * 0.01; v += niceStep) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  if (ticks.length < 2) ticks.push(niceStep);
  return ticks;
}

const LINE_CHART_PADDING = { top: 8, right: 12, bottom: 24, left: 40 };
const LINE_CHART_HEIGHT = 140;

function renderLineChart(component: A2UIResolvedComponent, series: SeriesEntry[], showArea: boolean = false): React.ReactNode {
  if (series.length === 0) return null;

  const maxValue = Math.max(...series.map((e) => e.value), 0);
  const yTicks = computeYTicks(maxValue);
  const yMax = yTicks[yTicks.length - 1];

  const pad = LINE_CHART_PADDING;
  const plotWidth = 300 - pad.left - pad.right;
  const plotHeight = LINE_CHART_HEIGHT - pad.top - pad.bottom;

  const xStep = series.length > 1 ? plotWidth / (series.length - 1) : 0;

  const points = series.map((entry, i) => {
    const x = pad.left + (series.length > 1 ? i * xStep : plotWidth / 2);
    const y = pad.top + (yMax > 0 ? (1 - entry.value / yMax) * plotHeight : plotHeight);
    return { x, y, entry };
  });

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
  const baselineY = pad.top + plotHeight;
  const areaPoints = showArea
    ? `${points[0].x},${baselineY} ${polylinePoints} ${points[points.length - 1].x},${baselineY}`
    : '';

  return (
    <svg
      className="assistant-panel-chart-line-svg"
      viewBox={`0 0 300 ${LINE_CHART_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Horizontal grid lines + Y-axis labels */}
      {yTicks.map((tick) => {
        const y = pad.top + (yMax > 0 ? (1 - tick / yMax) * plotHeight : plotHeight);
        return (
          <g key={`grid-${tick}`}>
            <line
              className="assistant-panel-chart-line-grid"
              x1={pad.left}
              y1={y}
              x2={pad.left + plotWidth}
              y2={y}
            />
            <text
              className="assistant-panel-chart-line-y-label"
              x={pad.left - 4}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {tick}
            </text>
          </g>
        );
      })}

      {/* Area fill (when showArea is true) */}
      {showArea && (
        <polygon
          className="assistant-panel-chart-area-fill"
          points={areaPoints}
        />
      )}

      {/* Line */}
      <polyline
        className="assistant-panel-chart-line-path"
        points={polylinePoints}
        fill="none"
      />

      {/* Dots */}
      {points.map((p, i) => (
        <circle
          key={`${component.id}-dot-${i}`}
          className="assistant-panel-chart-line-dot"
          cx={p.x}
          cy={p.y}
          r={3}
        >
          <title>{`${p.entry.label}: ${p.entry.value}`}</title>
        </circle>
      ))}

      {/* X-axis labels */}
      {points.map((p, i) => (
        <text
          key={`${component.id}-xlabel-${i}`}
          className="assistant-panel-chart-line-x-label"
          x={p.x}
          y={LINE_CHART_HEIGHT - 4}
          textAnchor="middle"
        >
          {p.entry.label}
        </text>
      ))}
    </svg>
  );
}

const PIE_CHART_SIZE = 140;
const PIE_CHART_RADIUS = 56;
const PIE_CHART_CENTER = PIE_CHART_SIZE / 2;

function describePieSlice(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const startRad = (startAngle - 90) * (Math.PI / 180);
  const endRad = (endAngle - 90) * (Math.PI / 180);
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`;
}

function renderPieChart(component: A2UIResolvedComponent, series: SeriesEntry[], isDonut: boolean = false): React.ReactNode {
  if (series.length === 0) return null;

  const total = series.reduce((sum, e) => sum + e.value, 0);
  if (total <= 0) return null;

  let currentAngle = 0;
  const slices = series.map((entry, i) => {
    const sliceAngle = (entry.value / total) * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    // For a full circle (single slice), use a circle element instead
    if (sliceAngle >= 359.99) {
      return (
        <circle
          key={`${component.id}-slice-${i}`}
          className="assistant-panel-chart-pie-slice"
          cx={PIE_CHART_CENTER}
          cy={PIE_CHART_CENTER}
          r={PIE_CHART_RADIUS}
          fill={getSegmentColor(i)}
        >
          <title>{`${entry.label}: ${entry.value}`}</title>
        </circle>
      );
    }

    return (
      <path
        key={`${component.id}-slice-${i}`}
        className="assistant-panel-chart-pie-slice"
        d={describePieSlice(PIE_CHART_CENTER, PIE_CHART_CENTER, PIE_CHART_RADIUS, startAngle, endAngle)}
        fill={getSegmentColor(i)}
      >
        <title>{`${entry.label}: ${entry.value}`}</title>
      </path>
    );
  });

  const donutInnerRadius = PIE_CHART_RADIUS * 0.58;

  return (
    <>
      <svg
        className="assistant-panel-chart-pie-svg"
        viewBox={`0 0 ${PIE_CHART_SIZE} ${PIE_CHART_SIZE}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {slices}
        {isDonut && (
          <>
            <circle
              className="assistant-panel-chart-donut-hole"
              cx={PIE_CHART_CENTER}
              cy={PIE_CHART_CENTER}
              r={donutInnerRadius}
            />
            <text
              className="assistant-panel-chart-donut-total"
              x={PIE_CHART_CENTER}
              y={PIE_CHART_CENTER}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {total}
            </text>
          </>
        )}
      </svg>
      <div className="assistant-panel-chart-legend">
        {series.map((entry, i) => (
          <span key={entry.label} className="assistant-panel-chart-legend-item">
            <span
              className="assistant-panel-chart-legend-swatch"
              style={{ backgroundColor: getSegmentColor(i) }}
            />
            {entry.label}
          </span>
        ))}
      </div>
    </>
  );
}

function renderHeatmap(component: A2UIResolvedComponent, series: SeriesEntry[]): React.ReactNode {
  // Heatmap requires segments — each entry is a row, each segment is a column
  const rows = series.filter((e) => e.segments && e.segments.length > 0);
  if (rows.length === 0) return null;

  const columnLabels = collectSegmentLabels(rows);
  if (columnLabels.length === 0) return null;

  // Find global max for normalisation
  let globalMax = 0;
  for (const row of rows) {
    for (const seg of row.segments!) {
      if (seg.value > globalMax) globalMax = seg.value;
    }
  }

  const { ins, del } = readPicoInsDelColors();

  // Build a lookup for each row's segment values by column label
  const columnCount = columnLabels.length;

  return (
    <div
      className="assistant-panel-chart-heatmap"
      style={{
        gridTemplateColumns: `auto repeat(${columnCount}, 1fr)`,
      }}
    >
      {/* Header row: empty corner + column labels */}
      <span className="assistant-panel-chart-heatmap-corner" />
      {columnLabels.map((col) => (
        <span key={`col-${col}`} className="assistant-panel-chart-heatmap-col-label">
          {col}
        </span>
      ))}

      {/* Data rows */}
      {rows.map((row) => {
        const segMap = new Map<string, number>();
        for (const seg of row.segments!) {
          segMap.set(seg.label, seg.value);
        }
        return (
          <React.Fragment key={`${component.id}-row-${row.label}`}>
            <span className="assistant-panel-chart-heatmap-row-label">{row.label}</span>
            {columnLabels.map((col) => {
              const val = segMap.get(col) ?? 0;
              const alpha = globalMax > 0 ? val / globalMax : 0;
              const { bg, fg } = heatmapCellColors(alpha, ins, del);
              return (
                <span
                  key={`${component.id}-cell-${row.label}-${col}`}
                  className="assistant-panel-chart-heatmap-cell"
                  style={{ background: bg, color: fg }}
                  title={String(val)}
                >
                  {val > 0 ? val : ''}
                </span>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
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

  const isLine = chartType === 'line';
  const isArea = chartType === 'area';
  const isPie = chartType === 'pie';
  const isDonut = chartType === 'donut';
  const isHeatmap = chartType === 'heatmap';

  return (
    <div className="assistant-panel-chart">
      {title && <p className="assistant-panel-chart-title">{title}</p>}
      <div className="assistant-panel-chart-type">{chartType}</div>
      {isPie || isDonut ? (
        renderPieChart(component, series, isDonut)
      ) : isHeatmap ? (
        renderHeatmap(component, series)
      ) : isLine || isArea ? (
        renderLineChart(component, series, isArea)
      ) : (
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
      )}
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

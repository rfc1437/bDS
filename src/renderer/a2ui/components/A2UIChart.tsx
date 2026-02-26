import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

interface SeriesEntry {
  label: string;
  value: number;
}

export const A2UIChart: React.FC<A2UIComponentProps> = ({ component }) => {
  const chartType = String(component.properties.chartType ?? 'bar');
  const title = component.properties.title as string | undefined;
  const series = (component.boundValue as SeriesEntry[]) ?? (component.properties.series as SeriesEntry[]) ?? [];
  const maxValue = Math.max(...series.map((entry) => entry.value), 0);

  return (
    <div className="assistant-panel-chart">
      {title && <p className="assistant-panel-chart-title">{title}</p>}
      <div className="assistant-panel-chart-type">{chartType}</div>
      {series.map((entry, index) => (
        <div key={`${component.id}-series-${index}`} className="assistant-panel-chart-item">
          <span>{entry.label}</span>
          <progress value={entry.value} max={maxValue || 1} />
          <span>{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

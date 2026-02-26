import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UIMetric: React.FC<A2UIComponentProps> = ({ component }) => {
  const label = String(component.properties.label ?? '');
  const value = String(component.properties.value ?? '');

  return (
    <div className="assistant-panel-metric">
      <span className="assistant-panel-metric-label">{label}</span>
      <strong className="assistant-panel-metric-value">{value}</strong>
    </div>
  );
};

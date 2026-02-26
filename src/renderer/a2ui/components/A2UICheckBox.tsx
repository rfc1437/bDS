import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UICheckBox: React.FC<A2UIComponentProps> = ({ component, surfaceId, onDataChange }) => {
  const label = String(component.properties.label ?? '');
  const checked = Boolean(component.boundValue ?? false);

  const handleChange = (newChecked: boolean) => {
    if (onDataChange && component.dataBinding) {
      onDataChange(surfaceId, component.dataBinding, newChecked);
    }
  };

  return (
    <label className="assistant-panel-checkbox">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => handleChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
};

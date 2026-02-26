import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

interface ChoiceOption {
  label: string;
  value: string;
}

export const A2UIChoicePicker: React.FC<A2UIComponentProps> = ({ component, surfaceId, onDataChange }) => {
  const label = String(component.properties.label ?? '');
  const options = (component.properties.options as ChoiceOption[]) ?? [];
  const value = String(component.boundValue ?? options[0]?.value ?? '');

  const handleChange = (newValue: string) => {
    if (onDataChange && component.dataBinding) {
      onDataChange(surfaceId, component.dataBinding, newValue);
    }
  };

  return (
    <div className="assistant-panel-widget-block">
      <label className="assistant-panel-widget-label">{label}</label>
      <select
        className="assistant-panel-widget-input chat-surface-input"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={`${component.id}-opt-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

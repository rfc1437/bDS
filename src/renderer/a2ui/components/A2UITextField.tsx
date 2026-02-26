import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UITextField: React.FC<A2UIComponentProps> = ({ component, surfaceId, onDataChange }) => {
  const label = String(component.properties.label ?? '');
  const placeholder = (component.properties.placeholder as string) ?? '';
  const inputType = component.properties.inputType as string | undefined;
  const value = String(component.boundValue ?? '');

  const handleChange = (newValue: string) => {
    if (onDataChange && component.dataBinding) {
      onDataChange(surfaceId, component.dataBinding, newValue);
    }
  };

  if (inputType === 'textarea') {
    return (
      <div className="assistant-panel-widget-block">
        <label className="assistant-panel-widget-label">{label}</label>
        <textarea
          className="assistant-panel-widget-input chat-surface-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          rows={3}
        />
      </div>
    );
  }

  return (
    <div className="assistant-panel-widget-block">
      <label className="assistant-panel-widget-label">{label}</label>
      <input
        className="assistant-panel-widget-input chat-surface-input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
};

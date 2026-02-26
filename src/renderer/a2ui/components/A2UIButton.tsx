import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UIButton: React.FC<A2UIComponentProps> = ({ component, surfaceId, onAction }) => {
  const label = String(component.properties.label ?? '');

  const handleClick = () => {
    const actionDef = component.actions?.[0];
    if (!actionDef) {
      return;
    }

    if (actionDef.policy === 'confirm' || actionDef.policy === 'danger') {
      const confirmed = window.confirm(label || actionDef.action);
      if (!confirmed) {
        return;
      }
    }

    onAction({
      surfaceId,
      componentId: component.id,
      action: actionDef.action,
      payload: actionDef.payload,
    });
  };

  return (
    <button type="button" onClick={handleClick}>
      {label}
    </button>
  );
};

import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UIForm: React.FC<A2UIComponentProps> = ({ component, renderChildren }) => {
  const title = component.properties.title as string | undefined;

  return (
    <div className="assistant-panel-form">
      {title && <p className="assistant-panel-form-title">{title}</p>}
      {renderChildren?.(component.children)}
    </div>
  );
};

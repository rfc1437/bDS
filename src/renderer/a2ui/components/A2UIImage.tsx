import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UIImage: React.FC<A2UIComponentProps> = ({ component, surfaceId, onAction }) => {
  const src = String(component.properties.src ?? '');
  const alt = String(component.properties.alt ?? '');
  const caption = component.properties.caption as string | undefined;
  const actionDef = component.actions?.[0];

  const handleClick = () => {
    if (!actionDef) {
      return;
    }

    if (actionDef.policy === 'confirm' || actionDef.policy === 'danger') {
      const confirmed = window.confirm(caption || alt || actionDef.action);
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
    <figure className="assistant-panel-image">
      <img
        src={src}
        alt={alt}
        onClick={handleClick}
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
};

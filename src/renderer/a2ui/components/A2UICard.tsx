import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UICard: React.FC<A2UIComponentProps> = ({ component, surfaceId, onAction }) => {
  const title = String(component.properties.title ?? '');
  const body = String(component.properties.body ?? '');
  const subtitle = component.properties.subtitle as string | undefined;
  const actions = component.actions ?? [];

  const triggerAction = (actionDef: typeof actions[number]) => {
    if (actionDef.policy === 'confirm' || actionDef.policy === 'danger') {
      const confirmed = window.confirm(actionDef.action);
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
    <article className="assistant-panel-card">
      <h4>{title}</h4>
      {subtitle && <p className="assistant-panel-card-subtitle">{subtitle}</p>}
      <p>{body}</p>
      {actions.length > 0 && (
        <div className="assistant-panel-card-actions">
          {actions.map((actionDef, index) => (
            <button
              key={`${component.id}-action-${index}`}
              type="button"
              onClick={() => triggerAction(actionDef)}
            >
              {String(actionDef.payload?.label ?? actionDef.action)}
            </button>
          ))}
        </div>
      )}
    </article>
  );
};

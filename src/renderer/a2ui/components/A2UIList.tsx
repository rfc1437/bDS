import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UIList: React.FC<A2UIComponentProps> = ({ component }) => {
  const title = component.properties.title as string | undefined;
  const items = (component.boundValue as string[]) ?? [];

  return (
    <div>
      {title && <p>{title}</p>}
      <ul>
        {items.map((item, index) => (
          <li key={`${component.id}-item-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
};

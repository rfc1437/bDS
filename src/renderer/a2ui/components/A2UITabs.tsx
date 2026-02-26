import React, { useState } from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

export const A2UITabs: React.FC<A2UIComponentProps> = ({ component, renderChildren }) => {
  const tabLabels = (component.properties.tabLabels as string[]) ?? [];
  const [activeTab, setActiveTab] = useState(0);

  const children = component.children;

  return (
    <div className="assistant-panel-tabs">
      <div className="assistant-panel-tab-strip">
        {tabLabels.map((label, index) => (
          <button
            key={`${component.id}-tab-${index}`}
            type="button"
            className={`assistant-panel-tab-button ${index === activeTab ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="assistant-panel-tab-panel">
        {children[activeTab] && renderChildren?.([children[activeTab]])}
      </div>
    </div>
  );
};

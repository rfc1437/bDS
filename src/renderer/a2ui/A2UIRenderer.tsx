/**
 * A2UI Renderer
 *
 * Maps A2UI resolved component trees to React components.
 * Uses the component catalog to look up renderers for each component type.
 */

import React from 'react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../main/a2ui/types';
import { A2UIText } from './components/A2UIText';
import { A2UIButton } from './components/A2UIButton';
import { A2UICard } from './components/A2UICard';
import { A2UIChart } from './components/A2UIChart';
import { A2UITable } from './components/A2UITable';
import { A2UIForm } from './components/A2UIForm';
import { A2UITextField } from './components/A2UITextField';
import { A2UICheckBox } from './components/A2UICheckBox';
import { A2UIDateTimeInput } from './components/A2UIDateTimeInput';
import { A2UIChoicePicker } from './components/A2UIChoicePicker';
import { A2UIImage } from './components/A2UIImage';
import { A2UITabs } from './components/A2UITabs';
import { A2UIMetric } from './components/A2UIMetric';
import { A2UIList } from './components/A2UIList';
import { A2UIRow } from './components/A2UIRow';
import { A2UIColumn } from './components/A2UIColumn';
import { A2UIDivider } from './components/A2UIDivider';

export interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

type ComponentRenderer = React.FC<A2UIComponentProps>;

const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  text: A2UIText,
  button: A2UIButton,
  card: A2UICard,
  chart: A2UIChart,
  table: A2UITable,
  form: A2UIForm,
  textField: A2UITextField,
  checkBox: A2UICheckBox,
  dateTimeInput: A2UIDateTimeInput,
  choicePicker: A2UIChoicePicker,
  image: A2UIImage,
  tabs: A2UITabs,
  metric: A2UIMetric,
  list: A2UIList,
  row: A2UIRow,
  column: A2UIColumn,
  divider: A2UIDivider,
};

interface A2UIRendererProps {
  surfaceId: string;
  tree: A2UIResolvedComponent[];
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
}

export const A2UIRenderer: React.FC<A2UIRendererProps> = ({
  surfaceId,
  tree,
  onAction,
  onDataChange,
}) => {
  const renderComponent = (component: A2UIResolvedComponent): React.ReactNode => {
    const Renderer = COMPONENT_REGISTRY[component.type];
    if (!Renderer) {
      return null;
    }

    const renderChildren = (children: A2UIResolvedComponent[]): React.ReactNode =>
      children.map(renderComponent);

    return (
      <Renderer
        key={component.id}
        component={component}
        surfaceId={surfaceId}
        onAction={onAction}
        onDataChange={onDataChange}
        renderChildren={renderChildren}
      />
    );
  };

  if (tree.length === 0) {
    return null;
  }

  return (
    <div className="a2ui-surface assistant-panel-controls chat-surface-section">
      {tree.map(renderComponent)}
    </div>
  );
};

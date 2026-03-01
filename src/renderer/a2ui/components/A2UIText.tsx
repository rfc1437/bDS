import React, { type ReactNode } from 'react';
import Markdown from 'marked-react';
import type { A2UIResolvedComponent, A2UIClientAction } from '../../../main/a2ui/types';

interface A2UIComponentProps {
  component: A2UIResolvedComponent;
  surfaceId: string;
  onAction: (action: A2UIClientAction) => void;
  onDataChange?: (surfaceId: string, path: string, value: unknown) => void;
  renderChildren?: (children: A2UIResolvedComponent[]) => React.ReactNode;
}

const safeRenderer = {
  image(src: string, alt: string): ReactNode {
    if (/^https?:\/\//i.test(src)) {
      return <a href={src} key={src} title={alt}>{alt || src}</a>;
    }
    return <img src={src} alt={alt} key={src} />;
  },
};

export const A2UIText: React.FC<A2UIComponentProps> = ({ component }) => {
  const text = String(component.properties.text ?? '');
  return <Markdown renderer={safeRenderer}>{text}</Markdown>;
};

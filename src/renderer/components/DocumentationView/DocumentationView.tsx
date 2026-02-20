import React, { useEffect } from 'react';
import Markdown from 'marked-react';
import documentationContent from '../../../../DOCUMENTATION.md?raw';
import { useAppStore } from '../../store';
import { ensureRendererPicoThemeStylesheet, getRendererPicoTheme } from '../../utils/picoTheme';
import './DocumentationView.css';

export const DocumentationView: React.FC = () => {
  const { picoTheme } = useAppStore();
  const resolvedTheme = getRendererPicoTheme(picoTheme);

  useEffect(() => {
    ensureRendererPicoThemeStylesheet(resolvedTheme).catch((error) => {
      console.error('Failed to load documentation theme stylesheet:', error);
    });
  }, [resolvedTheme]);

  return (
    <div className="documentation-view">
      <div className="documentation-header">
        <h1>Documentation</h1>
        <p>User guide for this installed bDS version.</p>
      </div>
      <main className="documentation-scroll">
        <div className="documentation-content markdown-body pico" data-theme="auto" data-pico-theme={resolvedTheme}>
          <article className="documentation-article">
            <Markdown>{documentationContent}</Markdown>
          </article>
        </div>
      </main>
    </div>
  );
};

import React from 'react';
import Markdown from 'marked-react';
import documentationContent from '../../../../DOCUMENTATION.md?raw';
import '@picocss/pico/css/pico.conditional.slate.min.css';
import './DocumentationView.css';

export const DocumentationView: React.FC = () => {
  return (
    <div className="documentation-view">
      <div className="documentation-header">
        <h1>Documentation</h1>
        <p>User guide for this installed bDS version.</p>
      </div>
      <main className="documentation-scroll">
        <div className="documentation-content markdown-body pico" data-theme="auto">
          <article className="documentation-article">
            <Markdown>{documentationContent}</Markdown>
          </article>
        </div>
      </main>
    </div>
  );
};

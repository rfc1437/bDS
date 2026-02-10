import React from 'react';
import ReactDOM from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import App from './App';
import './styles/global.css';

// Configure Monaco to use local bundled version instead of CDN
// This avoids CSP issues in Electron
loader.config({ monaco });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { configureRepresentationProfiling } from './performance/representation-profiler.js';
import './styles.css';

configureRepresentationProfiling(
  new URLSearchParams(window.location.search).get('profile-performance') ===
    '1',
);

const root = document.getElementById('root');
if (!root) throw new Error('Application root element is missing.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

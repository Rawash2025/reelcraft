import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { useEditor } from './store/editorStore.js';

// Dev-only handle so the editor state can be driven from the console.
if (import.meta.env.DEV) window.__editor = useEditor;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

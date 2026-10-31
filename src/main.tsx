import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource-variable/outfit';
import { App } from './App';
import './stile.css';
import { applicaTema, leggiTema } from './ui/tema';

applicaTema(leggiTema());

createRoot(document.getElementById('radice')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

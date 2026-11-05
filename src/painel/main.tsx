import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/oswald/latin-500.css';
import '@fontsource/oswald/latin-600.css';
import '@fontsource/oswald/latin-ext-500.css';
import '@fontsource/oswald/latin-ext-600.css';
import '@fontsource/karla/latin-400.css';
import '@fontsource/karla/latin-600.css';
import '@fontsource/karla/latin-700.css';
import '@fontsource/karla/latin-ext-400.css';
import '@fontsource/karla/latin-ext-600.css';
import '@fontsource/karla/latin-ext-700.css';
import './painel.css';
import { App } from './App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

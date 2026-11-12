import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ThemeProvider, ToastProvider, TooltipProvider } from './ui';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './ui/tokens.css';
import './ui/base.css';

// Fuentes de Excalidraw autoalojadas (public/excalidraw-assets/fonts). Debe fijarse antes de que se cargue
// el motor, que es lazy: basta con hacerlo aquí, antes de montar nada.
window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);

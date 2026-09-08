import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient } from './lib/queryClient';
import { AppModeProvider } from './lib/appMode';
import { CountryProvider } from './lib/country';
import { LanguageProvider } from './lib/i18n';
import { AuthProvider } from './lib/auth';
import { Toaster } from './components/ui';
import './index.css';

// Dev-mode registration fights Vite's own module server (stale-asset
// caching, HMR confusion) for no benefit — installability only matters for
// the deployed build, so this only runs there.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability degrades gracefully without it — no user-facing error.
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppModeProvider>
            <CountryProvider>
              <LanguageProvider>
                <App />
                <Toaster />
              </LanguageProvider>
            </CountryProvider>
          </AppModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient } from './lib/queryClient';
import { AppModeProvider } from './lib/appMode';
import { CountryProvider } from './lib/country';
import { AuthProvider } from './lib/auth';
import { Toaster } from './components/ui';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppModeProvider>
            <CountryProvider>
              <App />
              <Toaster />
            </CountryProvider>
          </AppModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { AppModeProvider } from './lib/appMode';
import { CountryProvider } from './lib/country';
import { LanguageProvider } from './lib/i18n';
import { AuthProvider, useAuth } from './lib/auth';
import { useCurrentUser } from './lib/useCurrentUser';
import { Button, Spinner, Toaster } from './components/ui';
import { AdminPage } from './pages/AdminPage';
import { LoginPage } from './pages/LoginPage';
import { MAIN_URL } from './lib/siteUrls';
import './index.css';

/**
 * Entry point for the admin site — its own Cloudflare Pages project, built
 * from the same source as the marketplace (see `vite.admin.config.ts`).
 *
 * Same providers as `main.tsx`, so the admin page and the sign-in screen behave
 * exactly as they did inside the marketplace. No service worker: this site is
 * not installable and has no business caching an admin tool offline.
 *
 * It is a separate origin, so it has its own session — an admin signs in here
 * separately from the marketplace. That was the accepted cost of the split.
 */

/**
 * Only admins get past this.
 *
 * Not `RequireRole`: that sends a signed-in account without the role to `/`,
 * and on this site `/` *is* the admin page, so a non-admin would be bounced to
 * the gate they were just refused at, forever. Here they are told plainly and
 * given the two ways out — sign out, or go to the marketplace.
 */
function AdminGate({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const { pathname } = useLocation();
  const { data: profile, isLoading } = useCurrentUser();

  if (!loading && !user) {
    return <Navigate to="/login" replace state={{ from: pathname }} />;
  }
  if (loading || isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }
  if (!profile || profile.role !== 'admin') {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-h3 text-[var(--color-content)]">This account isn't an admin</h1>
        <p className="mt-2 text-body-sm text-[var(--color-content-muted)]">
          The admin site only opens for AutoHire admin accounts. Sign out to use a different
          account, or head back to AutoHire.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4">
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
          <a
            href={MAIN_URL}
            className="text-body-sm font-semibold text-[var(--color-content)] underline underline-offset-2"
          >
            Go to AutoHire
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** A thin bar naming the site, with the way back to the marketplace. */
function AdminShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-[var(--color-line)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="text-body font-semibold text-[var(--color-content)]">AutoHire Admin</span>
          <a
            href={MAIN_URL}
            className="text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
          >
            Open AutoHire
          </a>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppModeProvider>
            <CountryProvider>
              <LanguageProvider>
                <Routes>
                  <Route path="login" element={<LoginPage />} />
                  <Route
                    path="*"
                    element={
                      <AdminShell>
                        <AdminGate>
                          <AdminPage />
                        </AdminGate>
                      </AdminShell>
                    }
                  />
                </Routes>
                <Toaster />
              </LanguageProvider>
            </CountryProvider>
          </AppModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

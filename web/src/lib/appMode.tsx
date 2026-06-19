import { createContext, useContext, type ReactNode } from 'react';
import { useCurrentUser } from '@/lib/useCurrentUser';

export type AppMode = 'renter' | 'host';

interface AppModeValue {
  mode: AppMode;
}

const AppModeContext = createContext<AppModeValue | null>(null);

/**
 * The active experience — Renting vs Hosting — derived from the signed-in
 * account, not a manual toggle. Owners (Company accounts, and Personal accounts
 * that have listed a car) get the Hosting view; everyone else gets Renting.
 */
export function AppModeProvider({ children }: { children: ReactNode }) {
  const { data: profile } = useCurrentUser();
  const mode: AppMode = profile?.role === 'owner' ? 'host' : 'renter';
  return <AppModeContext.Provider value={{ mode }}>{children}</AppModeContext.Provider>;
}

export function useAppMode() {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error('useAppMode must be used within an AppModeProvider');
  return ctx;
}

/** The landing route for each mode. */
export const MODE_HOME: Record<AppMode, string> = {
  renter: '/',
  host: '/dashboard',
};

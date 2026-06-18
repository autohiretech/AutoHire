import { createContext, useContext, useState, type ReactNode } from 'react';

export type AppMode = 'renter' | 'host';

const STORAGE_KEY = 'autohire.mode';

interface AppModeValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeValue | null>(null);

/** Tracks whether the user is browsing as a renter or managing as a host. */
export function AppModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(() =>
    localStorage.getItem(STORAGE_KEY) === 'host' ? 'host' : 'renter',
  );

  function setMode(next: AppMode) {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return <AppModeContext.Provider value={{ mode, setMode }}>{children}</AppModeContext.Provider>;
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

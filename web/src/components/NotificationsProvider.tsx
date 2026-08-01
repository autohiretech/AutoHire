import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { NotificationsModal } from '@/components/NotificationsModal';

const NotificationsContext = createContext<{ open: () => void }>({ open: () => {} });

/** Opens the shared notifications modal from anywhere (header bell, right rail…). */
export const useNotifications = () => useContext(NotificationsContext);

/**
 * Holds the single notifications modal for the app shell so every trigger opens
 * the same instance instead of each mounting its own.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const value = useMemo(() => ({ open: () => setIsOpen(true) }), []);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationsModal open={isOpen} onClose={() => setIsOpen(false)} />
    </NotificationsContext.Provider>
  );
}

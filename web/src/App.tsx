import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { AdminPage } from '@/pages/AdminPage';
import { HomePage } from '@/pages/HomePage';
import { SearchResultsPage } from '@/pages/SearchResultsPage';
import { LoginPage } from '@/pages/LoginPage';
import { CarDetailPage } from '@/pages/CarDetailPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { MessagesPage } from '@/pages/MessagesPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { TripsPage } from '@/pages/TripsPage';
import { VerificationPage } from '@/pages/VerificationPage';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { BookingPage } from '@/pages/BookingPage';
import { ListCarPage } from '@/pages/ListCarPage';
import { AccountPage } from '@/pages/AccountPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { RequireAuth } from '@/components/RequireAuth';
import { RequireRole } from '@/components/RequireRole';

export default function App() {
  return (
    <Routes>
      {/* Public — outside the app shell */}
      <Route path="login" element={<LoginPage />} />

      {/* The app shell. Guests can browse it; account-only routes are gated
          individually with RequireAuth / RequireRole so a logged-out visitor
          can see what's on offer and decide to create an account after. */}
      <Route element={<AppLayout />}>
        {/* Public browse — no account needed */}
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchResultsPage />} />
        <Route path="cars/:id" element={<CarDetailPage />} />

        {/* Account-only routes — signing in required */}
        <Route
          path="dashboard"
          element={
            <RequireRole roles={['owner']}>
              <DashboardPage />
            </RequireRole>
          }
        />
        {/* "My trips" is a renter page; hosts see trips from their dashboard. */}
        <Route
          path="trips"
          element={
            <RequireRole roles={['renter', 'admin']}>
              <TripsPage />
            </RequireRole>
          }
        />
        {/* Trip detail stays open to both participants (host needs it for handoff). */}
        <Route
          path="trips/:id"
          element={
            <RequireAuth>
              <TripDetailPage />
            </RequireAuth>
          }
        />
        {/* Only hosts can list a car — a renter becomes a host first. */}
        <Route
          path="cars/new"
          element={
            <RequireRole roles={['owner', 'admin']}>
              <ListCarPage />
            </RequireRole>
          }
        />
        <Route
          path="cars/:id/edit"
          element={
            <RequireRole roles={['owner', 'admin']}>
              <ListCarPage />
            </RequireRole>
          }
        />
        <Route
          path="cars/:id/book"
          element={
            <RequireAuth>
              <BookingPage />
            </RequireAuth>
          }
        />
        <Route
          path="messages"
          element={
            <RequireAuth>
              <MessagesPage />
            </RequireAuth>
          }
        />
        <Route
          path="messages/:id"
          element={
            <RequireAuth>
              <MessagesPage />
            </RequireAuth>
          }
        />
        <Route
          path="verification"
          element={
            <RequireAuth>
              <VerificationPage />
            </RequireAuth>
          }
        />
        <Route
          path="account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route
          path="notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole roles={['admin']}>
              <AdminPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<PlaceholderPage title="Not found" part="—" />} />
      </Route>
    </Routes>
  );
}

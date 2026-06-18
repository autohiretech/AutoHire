import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { AdminPage } from '@/pages/AdminPage';
import { HomePage } from '@/pages/HomePage';
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
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export default function App() {
  return (
    <Routes>
      {/* Public — outside the gated layout */}
      <Route path="login" element={<LoginPage />} />

      {/* Everything else requires a Supabase session */}
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="trips" element={<TripsPage />} />
        <Route path="trips/:id" element={<TripDetailPage />} />
        <Route path="cars/new" element={<ListCarPage />} />
        <Route path="cars/:id" element={<CarDetailPage />} />
        <Route path="cars/:id/book" element={<BookingPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="messages/:id" element={<MessagesPage />} />
        <Route path="verification" element={<VerificationPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<PlaceholderPage title="Not found" part="—" />} />
      </Route>
    </Routes>
  );
}

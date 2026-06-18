import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomePage } from '@/pages/HomePage';
import { CarDetailPage } from '@/pages/CarDetailPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { TripsPage } from '@/pages/TripsPage';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { BookingPage } from '@/pages/BookingPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="trips" element={<TripsPage />} />
        <Route path="trips/:id" element={<TripDetailPage />} />
        <Route path="cars/:id" element={<CarDetailPage />} />
        <Route path="cars/:id/book" element={<BookingPage />} />
        <Route path="*" element={<PlaceholderPage title="Not found" part="—" />} />
      </Route>
    </Routes>
  );
}

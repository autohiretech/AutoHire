import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HomePage } from '@/pages/HomePage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="dashboard" element={<PlaceholderPage title="Host dashboard" part="A4" />} />
        <Route path="trips" element={<PlaceholderPage title="My trips" part="A3" />} />
        <Route path="*" element={<PlaceholderPage title="Not found" part="—" />} />
      </Route>
    </Routes>
  );
}

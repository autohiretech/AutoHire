import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-ink-500">
        <p className="font-medium text-ink-700">AutoHire — peer-to-peer car rental in Rwanda</p>
        <p>Kigali · MTN MoMo · Airtel Money · Local bank transfer</p>
        <Link to="/admin" className="mt-2 w-fit text-xs text-ink-400 hover:text-ink-700">
          Admin
        </Link>
      </div>
    </footer>
  );
}

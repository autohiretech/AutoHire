/** Format a whole-RWF amount, e.g. 45000 -> "RWF 45,000". */
export function formatRwf(amount: number): string {
  return `RWF ${amount.toLocaleString('en-RW')}`;
}

/** Format an ISO date as e.g. "17 Jun 2026". */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative-ish short time for chat/notifications, e.g. "2h ago". */
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

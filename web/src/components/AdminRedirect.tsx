import { useEffect } from 'react';
import { Spinner } from '@/components/ui';
import { ADMIN_URL } from '@/lib/siteUrls';

/**
 * Sends `/admin` to the admin site, which is its own Cloudflare Pages project.
 *
 * `replace`, not `assign`, so Back returns to wherever the admin came from
 * rather than to a page that immediately forwards again.
 */
export function AdminRedirect() {
  useEffect(() => {
    window.location.replace(ADMIN_URL);
  }, []);
  return (
    <div className="flex justify-center py-20">
      <Spinner size={28} />
    </div>
  );
}

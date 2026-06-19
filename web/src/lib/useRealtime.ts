import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

/**
 * Live updates via Supabase Realtime. Subscribes to Postgres changes on the
 * messages, conversations and notifications tables and invalidates the matching
 * React Query caches, so chat threads, unread badges and notifications refresh
 * without a manual reload. Refetches are still RLS-guarded, so a change event
 * only ever pulls the current user's own rows.
 *
 * supabase-js keeps the Realtime connection authenticated with the logged-in
 * session, so Postgres-changes are already filtered to rows the user can read.
 */
export function useRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const sb = getSupabase();

    const channel = sb
      .channel('autohire-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { conversation_id?: string };
          if (row?.conversation_id) {
            queryClient.invalidateQueries({ queryKey: ['messages', row.conversation_id] });
          }
          // Conversation previews + unread counts (derived from messages).
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
          queryClient.invalidateQueries({ queryKey: ['unreadMessages'] });
          queryClient.invalidateQueries({ queryKey: ['unreadByConversation'] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [user, queryClient]);
}

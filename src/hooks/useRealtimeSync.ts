'use client';

import { useEffect, useRef } from 'react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { useStore } from '@/store/useStore';

/**
 * Subscribes to Supabase Realtime changes on timer_state and daily_tasks.
 * When data changes on another device, the local store updates automatically.
 * Only activates for authenticated Supabase users.
 */
export function useRealtimeSync() {
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const refreshDailyTasks = useStore(s => s.refreshDailyTasks);
  const initializeApp = useStore(s => s.initializeApp);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let cancelled = false;

    async function setup() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      // Subscribe to daily_tasks changes for this user
      const channel = supabase
        .channel('realtime-sync')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'daily_tasks',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            // Another device modified daily tasks — refresh local state
            refreshDailyTasks();
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'timer_state',
            filter: `user_id=eq.${user.id}`,
          },
          (payload: { new: Record<string, unknown> | undefined; old: Record<string, unknown> | undefined; eventType: string }) => {
            // Another device changed timer state
            // Update the store with the remote timer info
            const store = useStore.getState();
            const newState = payload.new as Record<string, unknown> | undefined;
            if (!newState) return;

            const remoteDevice = newState.device as string;
            const isRunning = newState.is_running as boolean;
            const remaining = newState.remaining as number;

            // If the change came from another device, update our awareness
            if (remoteDevice !== 'web') {
              store.setRemoteTimerInfo({
                device: remoteDevice,
                isRunning,
                remaining,
                updatedAt: newState.updated_at as string,
              });
            }
          }
        )
        .subscribe();

      subscriptionRef.current = channel;
    }

    setup();

    return () => {
      cancelled = true;
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [refreshDailyTasks, initializeApp]);
}

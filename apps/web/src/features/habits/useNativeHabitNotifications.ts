import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCortex, useCortexData } from '@cortex/crdt';
import { nativeNotifSupported, onNotifPermissionChange, onHabitNotificationAction, reconcileHabitNotifications } from '@cortex/platform';
import { planHabitNotifications } from './reminderPlan';

/** OS schedules survive suspension; opening the app replenishes and reconciles
 * them against the active account, latest habit edits and completed check-ins. */
export function useNativeHabitNotifications(now: number, snoozes: Record<string, number>) {
  const store = useCortex();
  const data = useCortexData();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [permissionVersion, setPermissionVersion] = useState(0);
  useEffect(() => onNotifPermissionChange(() => setPermissionVersion(version => version + 1)), []);
  useEffect(() => {
    if (!nativeNotifSupported()) return;
    const plans = planHabitNotifications(store.userId, data.habits, data.habitLogs, Date.now(), snoozes);
    void reconcileHabitNotifications(store.userId, plans).catch(() => {
      // Keep check-ins and the in-app hint available if the OS is temporarily unavailable.
    });
  }, [store, data.habits, data.habitLogs, now, snoozes, permissionVersion]);
  useEffect(() => {
    if (!nativeNotifSupported()) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    void onHabitNotificationAction(({ ownerId, habitId }) => {
      if (disposed || ownerId !== store.userId || !store.getData().habits.some(habit => habit.id === habitId && !habit.deletedAt && !habit.archivedAt)) return;
      navigateRef.current(`/habits?habit=${encodeURIComponent(habitId)}`);
    }).then(cleanup => { if (disposed) cleanup(); else remove = cleanup; }).catch(() => {});
    return () => {
      disposed = true;
      remove?.();
      void reconcileHabitNotifications(null, []).catch(() => {});
    };
  }, [store]);
}

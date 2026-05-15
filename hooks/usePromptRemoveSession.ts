import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import { invalidateSessionRelatedQueries } from '@/hooks/useSessionData';
import { deleteSessionById } from '@/services/importPlan';

export type RemovableSession = {
  id: string;
  title?: string | null;
  scheduled_date: string;
  status?: string | null;
  completionStatus?: string | null;
};

/**
 * Confirmed delete for a session row, with shared invalidation for Plan / Journal / Today.
 */
export function usePromptRemoveSession(athleteId: string | undefined, onSuccess?: (message: string) => void) {
  const queryClient = useQueryClient();

  const executeRemove = useCallback(
    async (session: RemovableSession) => {
      if (!athleteId) return;
      try {
        await deleteSessionById(athleteId, session.id);
        await invalidateSessionRelatedQueries(queryClient, {
          sessionId: session.id,
          athleteId,
          scheduledDateIso: session.scheduled_date,
        });
        onSuccess?.('Session removed');
        if (!onSuccess && Platform.OS === 'android') {
          ToastAndroid.show('Session removed', ToastAndroid.SHORT);
        }
      } catch (error) {
        const msg = error instanceof Error && error.message.trim().length > 0 ? error.message : 'Unknown error';
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert(`Could not remove session\n\n${msg}`);
        } else {
          Alert.alert('Could not remove session', msg);
        }
      }
    },
    [athleteId, onSuccess, queryClient]
  );

  const promptRemoveSession = useCallback(
    (session: RemovableSession) => {
      if (!session.id) return;
      if (!athleteId) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.alert('Your athlete profile is still loading. Try again in a moment.');
        } else {
          Alert.alert('Could not remove', 'Your athlete profile is still loading. Try again in a moment.');
        }
        return;
      }
      const completed = (session.completionStatus ?? session.status) === 'completed';
      const label = session.title?.trim() || 'This session';

      // RN Web's Alert is unreliable in some browsers/embeds; use the native confirm dialog on web.
      if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
        const message = completed
          ? `Delete completed session?\n\n${label} will be removed from your plan and history.`
          : `Remove session?\n\n${label} will be removed from your plan.`;
        if (window.confirm(message)) {
          void executeRemove(session);
        }
        return;
      }

      if (completed) {
        Alert.alert('Delete completed session?', `${label} will be removed from your plan and history.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => void executeRemove(session),
          },
        ]);
        return;
      }
      Alert.alert('Remove session?', `${label} will be removed from your plan.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void executeRemove(session),
        },
      ]);
    },
    [athleteId, executeRemove]
  );

  return { promptRemoveSession };
}

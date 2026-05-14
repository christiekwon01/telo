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
        Alert.alert(
          'Could not remove session',
          error instanceof Error && error.message.trim().length > 0 ? error.message : 'Unknown error'
        );
      }
    },
    [athleteId, onSuccess, queryClient]
  );

  const promptRemoveSession = useCallback(
    (session: RemovableSession) => {
      if (!athleteId || !session.id) return;
      const completed = (session.completionStatus ?? session.status) === 'completed';
      const label = session.title?.trim() || 'This session';
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

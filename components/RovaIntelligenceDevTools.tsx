import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabase';
import { generateWeeklyChallenges } from '@/services/generateWeeklyChallenges';
import { saveChallenges } from '@/services/saveChallenges';

type FlexHistoryRow = {
  id: string;
  created_at: string;
  reason: string;
  moved_count: number;
  dropped_count: number;
  reason_detail: string | null;
  reshuffled_snapshot: unknown;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  athleteId: string | undefined;
};

function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert(message);
}

/**
 * Dev-only hub: Rova weekly challenges, flex history inspection, Rova chat (intelligence tab),
 * and client cache refresh. Invoked from Profile via a single button.
 */
export function RovaIntelligenceDevTools({ visible, onClose, athleteId }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingFlexHistory, setIsLoadingFlexHistory] = useState(false);
  const [flexRows, setFlexRows] = useState<FlexHistoryRow[]>([]);
  const [selectedFlexRow, setSelectedFlexRow] = useState<FlexHistoryRow | null>(null);

  const handleGenerateChallenges = async () => {
    if (!athleteId) {
      Alert.alert('No athlete found', 'Create an athlete first from onboarding.');
      return;
    }
    setIsGenerating(true);
    try {
      const generated = await generateWeeklyChallenges(athleteId);
      const savedCount = await saveChallenges(athleteId, generated);
      await queryClient.invalidateQueries({ queryKey: ['rova_challenges'] });
      showToast(`Saved ${savedCount} pending Rova challenge${savedCount === 1 ? '' : 's'} ✨`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Failed to generate challenges', message);
      if (__DEV__) console.error('[RovaIntelligenceDevTools] generate challenges failed:', message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleLoadFlexHistory = async () => {
    if (!athleteId) {
      Alert.alert('No athlete found', 'Create an athlete first from onboarding.');
      return;
    }
    setIsLoadingFlexHistory(true);
    try {
      const { data, error } = await supabase
        .from('flex_history')
        .select('id,created_at,reason,moved_count,dropped_count,reason_detail,reshuffled_snapshot')
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw new Error(error.message);
      setFlexRows(data ?? []);
    } catch (error) {
      Alert.alert('Failed to load flex history', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingFlexHistory(false);
    }
  };

  const handleRefreshCaches = async () => {
    await queryClient.invalidateQueries({ queryKey: ['rova_challenges'] });
    showToast('Rova challenge caches invalidated');
  };

  const openIntelligenceTab = () => {
    onClose();
    router.push('/(tabs)/intelligence');
  };

  return (
    <>
      <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={styles.sheetRoot}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) + 12 }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Rova intelligence</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={theme.primary} />
              </Pressable>
            </View>
            <Text style={styles.sheetSubtitle}>
              Dev tools for weekly challenges, flex week history, and Rova chat. All actions live here.
            </Text>

            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Pressable
                style={[styles.actionBtn, isGenerating ? styles.actionBtnDisabled : null]}
                disabled={isGenerating}
                onPress={() => void handleGenerateChallenges()}>
                <Text style={styles.actionBtnText}>{isGenerating ? 'Generating…' : 'Generate Rova challenges'}</Text>
              </Pressable>

              <Pressable
                style={[styles.actionBtn, isLoadingFlexHistory ? styles.actionBtnDisabled : null]}
                disabled={isLoadingFlexHistory}
                onPress={() => void handleLoadFlexHistory()}>
                <Text style={styles.actionBtnText}>{isLoadingFlexHistory ? 'Loading…' : 'Load flex history'}</Text>
              </Pressable>

              <Pressable style={styles.actionBtnSecondary} onPress={() => void handleRefreshCaches()}>
                <Text style={styles.actionBtnSecondaryText}>Refresh Rova challenge caches</Text>
              </Pressable>

              <Pressable style={styles.actionBtnPrimary} onPress={openIntelligenceTab}>
                <Text style={styles.actionBtnPrimaryText}>Open Rova chat</Text>
                <Ionicons name="chatbubbles-outline" size={18} color={theme.onPrimary} />
              </Pressable>

              {flexRows.length > 0 ? (
                <View style={styles.historySection}>
                  <Text style={styles.historySectionLabel}>Recent flex</Text>
                  {flexRows.map((row) => (
                    <Pressable key={row.id} style={styles.historyRow} onPress={() => setSelectedFlexRow(row)}>
                      <View style={styles.historyRowBody}>
                        <Text style={styles.historyTitle}>
                          {new Date(row.created_at).toLocaleDateString('en-AU')} · {row.reason}
                        </Text>
                        <Text style={styles.historyMeta}>
                          {row.moved_count} moved · {row.dropped_count} dropped
                        </Text>
                      </View>
                      <Text style={styles.historyStatus}>View</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={Boolean(selectedFlexRow)}
        animationType="fade"
        onRequestClose={() => setSelectedFlexRow(null)}>
        <View style={styles.detailRoot}>
          <Pressable style={styles.backdrop} onPress={() => setSelectedFlexRow(null)} />
          <View style={styles.detailCard}>
            <Pressable style={styles.detailClose} onPress={() => setSelectedFlexRow(null)} hitSlop={8}>
              <Ionicons name="close" size={16} color={theme.primary} />
            </Pressable>
            <Text style={styles.detailTitle}>Flex details</Text>
            <Text style={styles.detailBody}>Reason: {selectedFlexRow?.reason}</Text>
            <Text style={styles.detailBody}>Details: {selectedFlexRow?.reason_detail ?? '—'}</Text>
            <Text style={styles.detailBody}>Moved: {selectedFlexRow?.moved_count ?? 0}</Text>
            <Text style={styles.detailBody}>Dropped: {selectedFlexRow?.dropped_count ?? 0}</Text>
            <Text style={styles.historyMeta} numberOfLines={8}>
              Snapshot: {JSON.stringify(selectedFlexRow?.reshuffled_snapshot ?? {})}
            </Text>
            <Pressable style={styles.detailDone} onPress={() => setSelectedFlexRow(null)}>
              <Text style={styles.detailDoneText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    sheetRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 20,
      paddingTop: 8,
      maxHeight: '88%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border,
      marginBottom: 12,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    sheetTitle: {
      fontFamily: 'CormorantGaramond_700Bold',
      fontSize: 24,
      color: theme.primary,
    },
    sheetSubtitle: {
      fontFamily: 'DMSans-Regular',
      fontSize: 13,
      color: theme.textMuted,
      marginBottom: 16,
      lineHeight: 18,
    },
    scroll: {
      maxHeight: 420,
    },
    actionBtn: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 10,
      alignItems: 'center',
    },
    actionBtnDisabled: {
      opacity: 0.55,
    },
    actionBtnText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 14,
      color: theme.primary,
    },
    actionBtnSecondary: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginBottom: 10,
      alignItems: 'center',
      backgroundColor: theme.base,
    },
    actionBtnSecondaryText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 13,
      color: theme.textMuted,
    },
    actionBtnPrimary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 8,
      backgroundColor: theme.primary,
    },
    actionBtnPrimaryText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 15,
      color: theme.onPrimary,
    },
    historySection: {
      marginTop: 8,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.border,
    },
    historySectionLabel: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: theme.textMuted,
      marginBottom: 8,
    },
    historyRow: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      backgroundColor: theme.base,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 8,
    },
    historyRowBody: {
      flex: 1,
    },
    historyTitle: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
      color: theme.primary,
    },
    historyMeta: {
      marginTop: 2,
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.textMuted,
    },
    historyStatus: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 10,
      color: theme.accent,
      textTransform: 'uppercase',
    },
    detailRoot: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    detailCard: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    detailClose: {
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 1,
    },
    detailTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 16,
      color: theme.primary,
      marginBottom: 10,
      paddingRight: 28,
    },
    detailBody: {
      fontFamily: 'DMSans-Regular',
      fontSize: 13,
      color: theme.text,
      marginBottom: 6,
    },
    detailDone: {
      marginTop: 12,
      alignSelf: 'flex-start',
      backgroundColor: theme.primary,
      borderRadius: 999,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    detailDoneText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 14,
      color: theme.onPrimary,
    },
  });
}

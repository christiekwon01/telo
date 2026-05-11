import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { withAlpha } from '@/lib/theme-utils';
import { supabase } from '@/lib/supabase';
import { applyReshuffledPlan } from '@/services/applyFlexPlan';
import { reshuffleWeek, type FlexConstraints, type FlexReason, type ReshuffledPlan } from '@/services/flexWeek';

const REASONS: FlexReason[] = ['Catch up', 'Travel', 'Busy week', 'Low energy', 'Minor niggle', 'Other'];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day);
  return new Date(utcMs + days * 86_400_000).toISOString().slice(0, 10);
}

function toLocalIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert(message);
}

function shortDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' });
}

type Props = {
  visible: boolean;
  athleteId: string | null | undefined;
  weekStartDate: string;
  initialReason?: FlexReason;
  onClose: () => void;
  onManualModeRequested?: () => void;
};

export function FlexWeekSheet({
  visible,
  athleteId,
  weekStartDate,
  initialReason,
  onClose,
  onManualModeRequested,
}: Props) {
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const sheetY = useRef(new Animated.Value(420)).current;
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [reason, setReason] = useState<FlexReason>(initialReason ?? 'Busy week');
  const [travelDays, setTravelDays] = useState<string[]>([]);
  const [busyDays, setBusyDays] = useState<string[]>([]);
  const [tiredness, setTiredness] = useState(3);
  const [otherText, setOtherText] = useState('');
  const [allowOverride, setAllowOverride] = useState(false);
  const [hasRecentFlex, setHasRecentFlex] = useState(false);
  const [recentFlexMessage, setRecentFlexMessage] = useState<string | null>(null);
  const [reshuffledPlan, setReshuffledPlan] = useState<ReshuffledPlan | null>(null);

  useEffect(() => {
    if (!visible) return;
    Animated.spring(sheetY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 20,
      stiffness: 180,
      mass: 0.9,
    }).start();
  }, [sheetY, visible]);

  useEffect(() => {
    if (!visible) return;
    setStep('input');
    setReshuffledPlan(null);
    setReason(initialReason ?? 'Busy week');
    setTravelDays([]);
    setBusyDays([]);
    setTiredness(3);
    setOtherText('');
    setAllowOverride(false);
  }, [initialReason, visible]);

  useEffect(() => {
    if (!visible || !athleteId) return;
    const checkLimit = async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from('flex_history')
        .select('id,created_at,reason,moved_count')
        .eq('athlete_id', athleteId)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) return;
      const latest = data?.[0];
      if (latest) {
        setHasRecentFlex(true);
        setRecentFlexMessage(`Flex already used this week (${latest.reason}). Override to continue.`);
      } else {
        setHasRecentFlex(false);
        setRecentFlexMessage(null);
      }
    };
    void checkLimit();
  }, [athleteId, visible]);

  const closeSheet = () => {
    Animated.timing(sheetY, {
      toValue: 420,
      duration: 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onClose();
    });
  };

  const constraints: FlexConstraints = useMemo(
    () => ({
      travelDays,
      busyDays,
      tiredness,
      otherNotes: otherText.trim() || undefined,
    }),
    [busyDays, otherText, tiredness, travelDays]
  );

  const rollingWindowDates = useMemo(() => {
    const start = toLocalIsoDate();
    return Array.from({ length: 7 }, (_, idx) => addDays(start, idx));
  }, []);

  const previewBullets = useMemo(() => {
    const bullets: string[] = [];
    if (reason === 'Travel' && travelDays.length > 0) bullets.push(`Travel days: ${travelDays.join(', ')}`);
    if (reason === 'Busy week' && busyDays.length > 0) bullets.push(`Busy days: ${busyDays.join(', ')}`);
    if (reason === 'Low energy') bullets.push(`Energy slider: ${tiredness}/5`);
    if (otherText.trim().length > 0) bullets.push(otherText.trim());
    if (bullets.length === 0) bullets.push('No extra constraints, just rebalance this week.');
    return bullets;
  }, [busyDays, otherText, reason, tiredness, travelDays]);

  const runReshuffle = async () => {
    if (!athleteId) return;
    if (hasRecentFlex && !allowOverride) {
      showToast('You can flex once per week by default. Enable override to continue.');
      return;
    }
    setIsLoading(true);
    try {
      const plan = await reshuffleWeek({
        athleteId,
        weekStartDate,
        reason,
        constraints,
      });
      setReshuffledPlan(plan);
      setStep('preview');
    } catch (error) {
      Alert.alert('Could not reshuffle', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const applyChanges = async () => {
    if (!athleteId || !reshuffledPlan) return;
    setIsApplying(true);
    try {
      await applyReshuffledPlan({
        athleteId,
        weekStartDate,
        reason,
        constraints,
        reshuffledPlan,
        overrideLimit: allowOverride,
      });
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['plan'] });
      showToast('Week reshuffled successfully');
      closeSheet();
    } catch (error) {
      Alert.alert('Could not apply flex changes', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsApplying(false);
    }
  };

  const toggleDay = (state: string[], value: string, setter: (next: string[]) => void) => {
    setter(state.includes(value) ? state.filter((day) => day !== value) : [...state, value]);
  };

  const beforeAfterCounts = useMemo(() => {
    if (!reshuffledPlan) return [];
    return rollingWindowDates.map((date) => {
      const before = reshuffledPlan.before.filter((s) => s.scheduledDate === date && s.status === 'planned').length;
      const after = reshuffledPlan.after.filter((s) => s.scheduledDate === date && s.status === 'planned').length;
      return { date, before, after };
    });
  }, [rollingWindowDates, reshuffledPlan]);

  const themed = useMemo(
    () => ({
      overlay: { backgroundColor: withAlpha('#000000', 0.42) },
      sheet: { backgroundColor: theme.base },
      handle: { backgroundColor: withAlpha(theme.primary, 0.2) },
      text: { color: theme.text },
      mutedText: { color: theme.textMuted },
      accentText: { color: theme.accent },
      chip: { borderColor: withAlpha(theme.primary, 0.2), backgroundColor: theme.surface },
      chipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
      chipText: { color: theme.text },
      chipTextActive: { color: theme.onPrimary },
      input: { borderColor: withAlpha(theme.primary, 0.14), backgroundColor: theme.surface, color: theme.text },
      warning: { color: theme.accent },
      dot: { borderColor: theme.primary },
      dotActive: { backgroundColor: theme.primary },
      primaryButton: { backgroundColor: theme.primary },
      primaryButtonText: { color: theme.onPrimary },
      secondaryButton: { borderColor: withAlpha(theme.primary, 0.2) },
      secondaryButtonText: { color: theme.primary },
      fallbackBanner: { borderColor: withAlpha(theme.accent, 0.3), backgroundColor: withAlpha(theme.accent, 0.1) },
      card: { borderColor: withAlpha(theme.primary, 0.1), backgroundColor: theme.surface },
      subtleText: { color: withAlpha(theme.primary, 0.62) },
      cancelText: { color: withAlpha(theme.primary, 0.45) },
      emptyText: { color: withAlpha(theme.primary, 0.5) },
      compareValue: { color: withAlpha(theme.primary, 0.65) },
    }),
    [theme]
  );

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={closeSheet}>
      <View style={styles.modalRoot}>
        <Pressable style={[styles.overlay, themed.overlay]} onPress={closeSheet} />
        <Animated.View style={[styles.sheet, themed.sheet, { transform: [{ translateY: sheetY }] }]}>
          <View style={[styles.handle, themed.handle]} />
          <Pressable style={styles.closeButton} onPress={closeSheet} hitSlop={8}>
            <Ionicons name="close" size={16} color={theme.primary} />
          </Pressable>
          {step === 'input' ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.title, themed.text]}>Flex this week</Text>
              <Text style={[styles.description, themed.mutedText]}>Tell Rova what changed and it will rebalance your week.</Text>

              <Text style={[styles.sectionLabel, themed.accentText]}>REASON</Text>
              <View style={styles.chipWrap}>
                {REASONS.map((item) => (
                  <Pressable
                    key={item}
                    style={[styles.chip, themed.chip, reason === item ? styles.chipActive : null, reason === item ? themed.chipActive : null]}
                    onPress={() => setReason(item)}>
                    <Text style={[styles.chipText, themed.chipText, reason === item ? styles.chipTextActive : null, reason === item ? themed.chipTextActive : null]}>{item}</Text>
                  </Pressable>
                ))}
              </View>

              {reason === 'Travel' ? (
                <>
                  <Text style={[styles.sectionLabel, themed.accentText]}>TRAVEL DAYS</Text>
                  <View style={styles.chipWrap}>
                    {WEEKDAY_LABELS.map((day) => (
                      <Pressable
                        key={day}
                        style={[styles.smallChip, themed.chip, travelDays.includes(day) ? styles.chipActive : null, travelDays.includes(day) ? themed.chipActive : null]}
                        onPress={() => toggleDay(travelDays, day, setTravelDays)}>
                        <Text style={[styles.chipText, themed.chipText, travelDays.includes(day) ? styles.chipTextActive : null, travelDays.includes(day) ? themed.chipTextActive : null]}>{day}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {reason === 'Busy week' ? (
                <>
                  <Text style={[styles.sectionLabel, themed.accentText]}>BUSY DAYS</Text>
                  <View style={styles.chipWrap}>
                    {WEEKDAY_LABELS.map((day) => (
                      <Pressable
                        key={day}
                        style={[styles.smallChip, themed.chip, busyDays.includes(day) ? styles.chipActive : null, busyDays.includes(day) ? themed.chipActive : null]}
                        onPress={() => toggleDay(busyDays, day, setBusyDays)}>
                        <Text style={[styles.chipText, themed.chipText, busyDays.includes(day) ? styles.chipTextActive : null, busyDays.includes(day) ? themed.chipTextActive : null]}>{day}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              {reason === 'Low energy' ? (
                <>
                  <Text style={[styles.sectionLabel, themed.accentText]}>TIREDNESS</Text>
                  <View style={styles.tiredRow}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <Pressable
                        key={value}
                        style={[styles.tiredPill, themed.chip, tiredness === value ? styles.chipActive : null, tiredness === value ? themed.chipActive : null]}
                        onPress={() => setTiredness(value)}>
                        <Text style={[styles.chipText, themed.chipText, tiredness === value ? styles.chipTextActive : null, tiredness === value ? themed.chipTextActive : null]}>{value}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={[styles.sectionLabel, themed.accentText]}>OTHER NOTES</Text>
              <TextInput
                value={otherText}
                onChangeText={setOtherText}
                placeholder="Any extra context for Rova..."
                placeholderTextColor={withAlpha(theme.primary, 0.45)}
                style={[styles.input, themed.input]}
                multiline
              />

              <Text style={[styles.sectionLabel, themed.accentText]}>PREVIEW INPUT</Text>
              {previewBullets.map((bullet) => (
                <Text key={bullet} style={[styles.previewBullet, themed.subtleText]}>
                  • {bullet}
                </Text>
              ))}

              {recentFlexMessage ? <Text style={[styles.warningText, themed.warning]}>{recentFlexMessage}</Text> : null}
              {hasRecentFlex ? (
                <Pressable style={styles.overrideRow} onPress={() => setAllowOverride((prev) => !prev)}>
                  <View style={[styles.overrideDot, themed.dot, allowOverride ? styles.overrideDotActive : null, allowOverride ? themed.dotActive : null]} />
                  <Text style={[styles.overrideText, themed.text]}>Allow override and flex anyway</Text>
                </Pressable>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.9}
                disabled={isLoading}
                style={[styles.primaryButton, themed.primaryButton, isLoading ? styles.disabledButton : null]}
                onPress={() => void runReshuffle()}>
                <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>{isLoading ? 'Reshuffling...' : 'Reshuffle plan'}</Text>
              </TouchableOpacity>
              <Pressable onPress={closeSheet}>
                <Text style={[styles.cancelText, themed.cancelText]}>Cancel</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.title, themed.text]}>Here&apos;s your new plan</Text>
              <Text style={[styles.description, themed.mutedText]}>{reshuffledPlan?.summary}</Text>

              {reshuffledPlan?.aiStatus === 'fallback' ? (
                <View style={[styles.fallbackBanner, themed.fallbackBanner]}>
                  <Text style={[styles.fallbackBannerText, themed.text]}>
                    AI was unavailable, so this is a safe fallback reshuffle. You can still use manual week drag-and-drop.
                  </Text>
                  <Pressable
                    onPress={() => {
                      closeSheet();
                      onManualModeRequested?.();
                    }}>
                    <Text style={[styles.manualLink, themed.text]}>Open manual week planner</Text>
                  </Pressable>
                </View>
              ) : null}

              <Text style={[styles.sectionLabel, themed.accentText]}>MOVED SESSIONS</Text>
              {(reshuffledPlan?.movedSessions.length ?? 0) === 0 ? (
                <Text style={[styles.emptyText, themed.emptyText]}>No sessions moved.</Text>
              ) : (
                reshuffledPlan?.movedSessions.map((item) => (
                  <View key={item.sessionId} style={[styles.rowCard, themed.card]}>
                    <Text style={[styles.rowTitle, themed.text]}>
                      {shortDate(item.fromDate)} {'->'} {shortDate(item.toDate)}
                    </Text>
                    <Text style={[styles.rowMeta, themed.mutedText]}>{item.reason}</Text>
                  </View>
                ))
              )}

              <Text style={[styles.sectionLabel, themed.accentText]}>DROPPED SESSIONS</Text>
              {(reshuffledPlan?.droppedSessions.length ?? 0) === 0 ? (
                <Text style={[styles.emptyText, themed.emptyText]}>No sessions dropped.</Text>
              ) : (
                reshuffledPlan?.droppedSessions.map((item) => (
                  <View key={item.sessionId} style={[styles.rowCard, themed.card, styles.deemphasized]}>
                    <Text style={[styles.rowTitle, themed.text]}>{shortDate(item.date)}</Text>
                    <Text style={[styles.rowMeta, themed.mutedText]}>{item.reason}</Text>
                  </View>
                ))
              )}

              <Text style={[styles.sectionLabel, themed.accentText]}>UPCOMING WINDOW COMPARISON (BEFORE {'->'} AFTER)</Text>
              <View style={[styles.comparisonWrap, themed.card]}>
                {beforeAfterCounts.length === 0 ? (
                  <Text style={[styles.emptyText, themed.emptyText]}>No upcoming days in this selected week.</Text>
                ) : (
                  beforeAfterCounts.map((entry) => (
                    <View key={entry.date} style={styles.compareRow}>
                      <Text style={[styles.compareDay, themed.text]}>{shortDate(entry.date)}</Text>
                      <Text style={[styles.compareValue, themed.compareValue]}>
                        {entry.before} {'->'} {entry.after}
                      </Text>
                    </View>
                  ))
                )}
              </View>

              <TouchableOpacity
                activeOpacity={0.9}
                disabled={isApplying}
                style={[styles.primaryButton, themed.primaryButton, isApplying ? styles.disabledButton : null]}
                onPress={() => void applyChanges()}>
                <Text style={[styles.primaryButtonText, themed.primaryButtonText]}>{isApplying ? 'Applying...' : 'Apply changes'}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.9} style={[styles.secondaryButton, themed.secondaryButton]} onPress={() => void runReshuffle()}>
                <Text style={[styles.secondaryButtonText, themed.secondaryButtonText]}>Try again</Text>
              </TouchableOpacity>
              <Pressable onPress={closeSheet}>
                <Text style={[styles.cancelText, themed.cancelText]}>Cancel</Text>
              </Pressable>
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: '#F6F3EE',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15,40,64,0.2)',
    marginBottom: 16,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { textAlign: 'center', fontFamily: 'CormorantGaramond_700Bold', fontSize: 34, color: '#0F2840', marginBottom: 8 },
  description: {
    textAlign: 'center',
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(15,40,64,0.55)',
    marginBottom: 14,
  },
  sectionLabel: {
    fontFamily: 'DMSans_600SemiBold',
    fontSize: 11,
    color: '#C97E2F',
    letterSpacing: 0.9,
    marginTop: 6,
    marginBottom: 8,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: '#0F2840', borderColor: '#0F2840' },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#0F2840' },
  chipTextActive: { color: '#F6F3EE' },
  tiredRow: { flexDirection: 'row', gap: 8 },
  tiredPill: {
    width: 38,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    backgroundColor: '#FFFFFF',
  },
  input: {
    minHeight: 88,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.14)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#0F2840',
  },
  previewBullet: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(15,40,64,0.62)', marginBottom: 4 },
  warningText: { marginTop: 10, fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#C97E2F' },
  overrideRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  overrideDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.2, borderColor: '#0F2840' },
  overrideDotActive: { backgroundColor: '#0F2840' },
  overrideText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#0F2840' },
  primaryButton: {
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#0F2840',
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  disabledButton: { opacity: 0.6 },
  primaryButtonText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#F6F3EE' },
  secondaryButton: {
    width: '100%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#0F2840' },
  cancelText: {
    marginTop: 10,
    textAlign: 'center',
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: 'rgba(15,40,64,0.45)',
  },
  fallbackBanner: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(201,126,47,0.3)',
    backgroundColor: 'rgba(201,126,47,0.1)',
    padding: 10,
    marginBottom: 8,
  },
  fallbackBannerText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#0F2840', lineHeight: 18 },
  manualLink: { marginTop: 6, fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#0F2840', textDecorationLine: 'underline' },
  emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(15,40,64,0.5)' },
  rowCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  deemphasized: { opacity: 0.65 },
  rowTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#0F2840' },
  rowMeta: { marginTop: 3, fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(15,40,64,0.55)' },
  comparisonWrap: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  compareRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  compareDay: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: '#0F2840' },
  compareValue: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: 'rgba(15,40,64,0.65)' },
});

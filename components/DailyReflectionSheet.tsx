import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type AppTheme } from '@/contexts/ThemeContext';
import {
  calendarDayStreak,
  useDailyReflectionQuery,
  useJournalHabits,
  useJournalStreakData,
  useMonthJournalIndicators,
  useToggleHabitCompletionMutation,
  useUpsertReflectionMutation,
} from '@/hooks/useJournalAndHabits';
import { normalizeCompletionStatus } from '@/hooks/useSessionData';
import { withAlpha } from '@/lib/theme-utils';
import { supabase } from '@/lib/supabase';
import { JOURNAL_TEMPLATE_LIBRARY } from '@/services/journalTemplates';

const MOOD_EMOJIS = ['😫', '😕', '😐', '🙂', '😊'];

type Props = {
  visible: boolean;
  onClose: () => void;
  athleteId: string;
  entryDateIso: string;
  onSaved?: () => void;
};

export function DailyReflectionSheet({ visible, onClose, athleteId, entryDateIso, onSaved }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { data: remote } = useDailyReflectionQuery(athleteId, entryDateIso);
  const { data: habits = [] } = useJournalHabits(athleteId);
  const y = Number(entryDateIso.slice(0, 4));
  const m = Number(entryDateIso.slice(5, 7)) - 1;
  const { data: monthBundle } = useMonthJournalIndicators(athleteId, y, m);
  const { data: streakData } = useJournalStreakData(athleteId);

  const [bodyText, setBodyText] = useState('');
  const [mood, setMood] = useState<number>(3);
  const [energy, setEnergy] = useState<number>(3);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (remote) {
      setBodyText(remote.body_text ?? '');
      setMood(remote.mood ?? 3);
      setEnergy(remote.energy ?? 3);
      setSleepQuality(remote.sleep_quality ?? null);
    } else {
      setBodyText('');
      setMood(3);
      setEnergy(3);
      setSleepQuality(null);
    }
  }, [visible, remote]);

  const { data: completedContext = [] } = useQuery({
    queryKey: ['journal', 'context-sessions', athleteId, entryDateIso],
    enabled: visible && Boolean(athleteId) && Boolean(entryDateIso),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, title, sport, duration_mins, status, session_logs(id, completed_at)')
        .eq('athlete_id', athleteId)
        .eq('scheduled_date', entryDateIso);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      return rows.filter((s) => normalizeCompletionStatus(s.status, s.session_logs as never) === 'completed');
    },
  });

  const upsert = useUpsertReflectionMutation(athleteId);
  const toggleHabit = useToggleHabitCompletionMutation(athleteId);

  const doneForDay = useMemo(() => {
    return monthBundle?.habitCompletionsByDate.get(entryDateIso) ?? new Set<string>();
  }, [monthBundle, entryDateIso]);

  const onSave = useCallback(async () => {
    const trimmed = bodyText.trim();
    try {
      await upsert.mutateAsync({
        entry_date: entryDateIso,
        body_text: trimmed,
        mood,
        energy,
        sleep_quality: sleepQuality,
      });
      onSaved?.();
      onClose();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [bodyText, energy, entryDateIso, mood, onClose, onSaved, sleepQuality, upsert]);

  const applyTemplate = useCallback((body: string) => {
    setBodyText((prev) => (prev.trim() ? `${prev.trim()}\n\n${body}` : body));
    setTemplatesOpen(false);
  }, []);

  const onToggleHabit = useCallback(
    (habitId: string) => {
      const completed = !doneForDay.has(habitId);
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      void toggleHabit.mutateAsync({ habitId, dateIso: entryDateIso, completed });
    },
    [doneForDay, entryDateIso, toggleHabit]
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>Close</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Reflect</Text>
          <Pressable onPress={() => void onSave()} hitSlop={10} style={styles.headerBtn} disabled={upsert.isPending}>
            <Text style={[styles.headerBtnText, styles.saveText]}>{upsert.isPending ? '…' : 'Save'}</Text>
          </Pressable>
        </View>
        <Text style={styles.dateLabel}>{entryDateIso}</Text>

        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 52 : 0}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}>
          {completedContext.length > 0 ? (
            <View style={styles.contextCard}>
              <Text style={styles.contextTitle}>Completed today</Text>
              {completedContext.map((s) => (
                <Text key={s.id} style={styles.contextLine}>
                  • {s.title} ({s.sport})
                  {s.duration_mins != null ? ` · ${s.duration_mins} min` : ''}
                </Text>
              ))}
            </View>
          ) : null}

          <Text style={styles.fieldLabel}>Mood</Text>
          <View style={styles.moodRow}>
            {MOOD_EMOJIS.map((emo, idx) => {
              const val = idx + 1;
              const on = mood === val;
              return (
                <Pressable key={emo} onPress={() => setMood(val)} style={[styles.moodBtn, on ? styles.moodBtnOn : null]}>
                  <Text style={styles.moodEmoji}>{emo}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>Energy</Text>
          <StarRow value={energy} onChange={setEnergy} theme={theme} />

          <Text style={styles.fieldLabel}>Sleep quality (optional)</Text>
          <StarRow value={sleepQuality ?? 0} onChange={(v) => setSleepQuality(v === 0 ? null : v)} theme={theme} allowClear />
          {sleepQuality != null ? (
            <Pressable onPress={() => setSleepQuality(null)}>
              <Text style={styles.clearSleep}>Clear sleep rating</Text>
            </Pressable>
          ) : null}

          <Text style={styles.fieldLabel}>Reflection</Text>
          <TextInput
            style={styles.textArea}
            multiline
            textAlignVertical="top"
            placeholder="How did today go? (optional)"
            placeholderTextColor={theme.textMuted}
            value={bodyText}
            onChangeText={setBodyText}
          />

          <Pressable style={styles.templateBtn} onPress={() => setTemplatesOpen(true)}>
            <Ionicons name="document-text-outline" size={16} color={theme.accent} />
            <Text style={styles.templateBtnText}>Use a template</Text>
          </Pressable>

          <Text style={styles.fieldLabel}>Habits</Text>
          <Text style={styles.hint}>Tap to mark done for this day · aim for 5–7 habits you’ll actually keep.</Text>
          {habits.map((h) => {
            const done = doneForDay.has(h.id);
            const dates = streakData?.habitCompletionByHabit.get(h.id) ?? new Set<string>();
            const streak = calendarDayStreak(dates, entryDateIso);
            const streakLabel = streak >= 3 ? `${streak} day streak` : null;
            return (
              <Pressable
                key={h.id}
                onPress={() => onToggleHabit(h.id)}
                style={[styles.habitCard, { backgroundColor: done ? withAlpha(theme.accent, 0.18) : withAlpha(theme.primary, 0.06) }]}>
                <Text style={styles.habitEmoji}>{h.icon_emoji}</Text>
                <View style={styles.habitCopy}>
                  <Text style={styles.habitName}>{h.name}</Text>
                  {streakLabel ? <Text style={styles.habitStreak}>{streakLabel}</Text> : null}
                </View>
                <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={done ? theme.accent : theme.textMuted} />
              </Pressable>
            );
          })}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      <Modal transparent visible={templatesOpen} animationType="fade" onRequestClose={() => setTemplatesOpen(false)}>
        <View style={styles.tplRoot}>
          <Pressable style={styles.tplBackdrop} onPress={() => setTemplatesOpen(false)} />
          <View style={[styles.tplSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.tplTitle}>Templates</Text>
            {JOURNAL_TEMPLATE_LIBRARY.map((t) => (
              <Pressable key={t.id} style={styles.tplRow} onPress={() => applyTemplate(t.body)}>
                <Text style={styles.tplRowTitle}>{t.title}</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
              </Pressable>
            ))}
            <Pressable style={styles.tplCancel} onPress={() => setTemplatesOpen(false)}>
              <Text style={styles.tplCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function StarRow({
  value,
  onChange,
  theme,
  allowClear,
}: {
  value: number;
  onChange: (n: number) => void;
  theme: AppTheme;
  allowClear?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value >= n;
        return (
          <Pressable key={n} onPress={() => onChange(allowClear && value === n ? 0 : n)} hitSlop={4}>
            <Ionicons name={filled ? 'star' : 'star-outline'} size={26} color={filled ? theme.accent : theme.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.base },
    keyboardAvoid: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginBottom: 4,
    },
    headerBtn: { paddingVertical: 6, paddingHorizontal: 4 },
    headerBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: theme.textMuted },
    saveText: { color: theme.accent },
    headerTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 22, color: theme.text },
    dateLabel: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    scroll: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
    contextCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.surface,
      padding: 12,
      marginBottom: 4,
    },
    contextTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 12, color: theme.accent, marginBottom: 6 },
    contextLine: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: theme.text, marginBottom: 2 },
    fieldLabel: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: theme.accent,
      marginTop: 6,
    },
    moodRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    moodBtn: {
      flex: 1,
      marginHorizontal: 3,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: theme.surface,
    },
    moodBtnOn: { borderColor: theme.accent, backgroundColor: withAlpha(theme.accent, 0.12) },
    moodEmoji: { fontSize: 26 },
    textArea: {
      minHeight: 140,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.14),
      padding: 12,
      fontFamily: 'DMSans_400Regular',
      fontSize: 14,
      color: theme.text,
      backgroundColor: theme.surface,
    },
    templateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    templateBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: theme.accent },
    hint: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: theme.textMuted, marginBottom: 4 },
    habitCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.08),
    },
    habitEmoji: { fontSize: 22 },
    habitCopy: { flex: 1 },
    habitName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: theme.text },
    habitStreak: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: theme.textMuted, marginTop: 2 },
    clearSleep: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: theme.accent, marginTop: 4 },
    tplRoot: { flex: 1, justifyContent: 'flex-end' },
    tplBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
    tplSheet: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 40,
      borderRadius: 16,
      backgroundColor: theme.surface,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    tplTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 22, color: theme.text, marginBottom: 8 },
    tplRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    tplRowTitle: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: theme.text, flex: 1, marginRight: 8 },
    tplCancel: { marginTop: 12, alignSelf: 'center', padding: 8 },
    tplCancelText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: theme.textMuted },
  });
}

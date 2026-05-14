import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DailyReflectionSheet } from '@/components/DailyReflectionSheet';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { JournalHabitManagerModal } from '@/components/JournalHabitManagerModal';
import { SessionRemoveIconButton } from '@/components/session-remove-icon-button';
import { StatusAreaFade } from '@/components/status-area-fade';
import { TabHeader, TAB_SCREEN_CONTENT_PADDING_TOP, TAB_SCREEN_PADDING_HORIZONTAL } from '@/components/tab-header';
import { useTheme } from '@/contexts/ThemeContext';
import {
  calendarDayStreak,
  daysReflectedInMonth,
  journalQueryKeys,
  useDailyReflectionQuery,
  useJournalHabits,
  useJournalStreakData,
  useMonthJournalIndicators,
  useToggleHabitCompletionMutation,
} from '@/hooks/useJournalAndHabits';
import { usePromptRemoveSession, type RemovableSession } from '@/hooks/usePromptRemoveSession';
import {
  useActiveAthlete,
  useMonthSessions,
  normalizeCompletionStatus,
  type SessionWithCompletion,
} from '@/hooks/useSessionData';
import { mondayBasedMonthLeadingDayCount, toLocalIsoDate } from '@/lib/dates';
import { withAlpha } from '@/lib/theme-utils';
import { shareJournalMarkdownExport } from '@/services/exportJournalMarkdown';

const DOT = { session: '#2E7D32', journal: '#7B2D42', both: '#D4A5A5' };

export default function JournalScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { data: athlete } = useActiveAthlete();
  const athleteId = athlete?.id ?? '';
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { promptRemoveSession } = usePromptRemoveSession(athleteId || undefined);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isWeb = Platform.OS === 'web';

  const [monthAnchor, setMonthAnchor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const todayIso = useMemo(() => toLocalIsoDate(new Date()), []);

  const { data: sessions = [] } = useMonthSessions(year, month);
  const { data: monthBundle, isLoading: monthLoading } = useMonthJournalIndicators(athleteId || null, year, month);
  const { data: streakData } = useJournalStreakData(athleteId || null);
  const { data: habits = [] } = useJournalHabits(athleteId || null);
  const toggleHabit = useToggleHabitCompletionMutation(athleteId || undefined);

  const todaysSessionsByStatus = useMemo(() => {
    const all = sessions.filter((s) => s.scheduled_date === todayIso);
    const completed = all.filter((s) => normalizeCompletionStatus(s.status, s.session_logs as never) === 'completed');
    const planned = all.filter((s) => normalizeCompletionStatus(s.status, s.session_logs as never) !== 'completed');
    return { planned, completed };
  }, [sessions, todayIso]);

  const onToggleTodayHabit = useCallback(
    (habitId: string) => {
      const done = monthBundle?.habitCompletionsByDate.get(todayIso) ?? new Set<string>();
      const completed = !done.has(habitId);
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      void toggleHabit.mutateAsync({ habitId, dateIso: todayIso, completed });
    },
    [monthBundle, todayIso, toggleHabit]
  );

  const [dayDetailIso, setDayDetailIso] = useState<string | null>(null);
  const [reflectIso, setReflectIso] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportKind, setExportKind] = useState<'markdown' | 'pdf'>('markdown');
  const [managerOpen, setManagerOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const sessionCompletedByDate = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sessions) {
      if (normalizeCompletionStatus(s.status, s.session_logs as never) === 'completed') {
        m.set(s.scheduled_date, true);
      }
    }
    return m;
  }, [sessions]);

  const reflectionDates = monthBundle?.reflectionDates ?? new Set<string>();

  const reflectionStreak =
    streakData && athleteId ? calendarDayStreak(streakData.reflectionDates, todayIso) : 0;
  const reflectedDaysThisMonth = daysReflectedInMonth(reflectionDates, year, month);

  const goToday = useCallback(() => {
    const n = new Date();
    setMonthAnchor(new Date(n.getFullYear(), n.getMonth(), 1));
  }, []);

  const shiftMonth = useCallback((delta: number) => {
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, []);

  const swipeMonthGesture = useMemo(() => {
    if (Platform.OS === 'web') return null;
    return Gesture.Pan()
      .activeOffsetX([-32, 32])
      .failOffsetY([-14, 14])
      .onEnd((e) => {
        'worklet';
        if (e.translationX < -52) {
          runOnJS(shiftMonth)(1);
        } else if (e.translationX > 52) {
          runOnJS(shiftMonth)(-1);
        }
      });
  }, [shiftMonth]);

  const monthLabel = monthAnchor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const grid = useMemo(() => {
    const start = new Date(year, month, 1);
    const lead = mondayBasedMonthLeadingDayCount(start);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: ({ iso: string; inMonth: boolean } | null)[] = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = toLocalIsoDate(new Date(year, month, d));
      cells.push({ iso, inMonth: true });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    while (cells.length < 42) cells.push(null);
    return cells.slice(0, 42);
  }, [year, month]);

  const onExportRange = useCallback(
    async (fromIso: string, toIso: string, kind: 'markdown' | 'pdf') => {
      if (!athleteId) return;
      setExportBusy(true);
      try {
        if (kind === 'markdown') {
          await shareJournalMarkdownExport({ athleteId, fromIso, toIso, athleteName: athlete?.name });
        } else {
          const { shareJournalPdfExport } = await import('@/services/exportJournalPdf');
          await shareJournalPdfExport({ athleteId, fromIso, toIso, athleteName: athlete?.name });
        }
        setExportOpen(false);
      } catch (e) {
        Alert.alert('Export failed', e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setExportBusy(false);
      }
    },
    [athlete?.name, athleteId]
  );

  const exportPresets = useCallback(() => {
    const t = new Date();
    const today = toLocalIsoDate(t);
    const d7 = new Date(t);
    d7.setDate(d7.getDate() - 6);
    const d30 = new Date(t);
    d30.setDate(d30.getDate() - 29);
    const monthStart = toLocalIsoDate(new Date(t.getFullYear(), t.getMonth(), 1));
    const monthEnd = toLocalIsoDate(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    return [
      { label: 'Last 7 days', from: toLocalIsoDate(d7), to: today },
      { label: 'Last 30 days', from: toLocalIsoDate(d30), to: today },
      { label: 'This month', from: monthStart, to: monthEnd },
    ];
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <StatusAreaFade height={insets.top + 8} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={styles.titleWrap}>
            <TabHeader title="Journal" />
          </View>
          <View style={styles.topActions}>
            <Pressable style={styles.iconBtn} onPress={goToday}>
              <Text style={styles.todayPill}>Today</Text>
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setExportOpen(true)}>
              <Ionicons name="share-outline" size={20} color={theme.primary} />
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setManagerOpen(true)}>
              <Ionicons name="settings-outline" size={20} color={theme.primary} />
            </Pressable>
          </View>
        </View>

        {!athleteId ? (
          <Text style={styles.muted}>Sign in to use your journal.</Text>
        ) : (
          <>
            <View style={styles.streakCard}>
              <Text style={styles.streakTitle}>This month</Text>
              <Text style={styles.streakBody}>
                You&apos;ve reflected on <Text style={styles.streakEm}>{reflectedDaysThisMonth}</Text> day
                {reflectedDaysThisMonth === 1 ? '' : 's'}.
              </Text>
              {reflectionStreak >= 3 ? (
                <Text style={styles.streakFire}>{reflectionStreak} day reflection streak</Text>
              ) : null}
            </View>

            {(() => {
              const weekdayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

              const renderDayCell = (cell: { iso: string; inMonth: boolean } | null, idx: number) => {
                if (!cell) {
                  return <View key={`e-${idx}`} style={isWeb ? styles.dayCellEmptyWeb : styles.cell} />;
                }
                const { iso } = cell;
                const jr = reflectionDates.has(iso);
                const sc = sessionCompletedByDate.get(iso);
                let dotColor: string | null = null;
                if (jr && sc) dotColor = DOT.both;
                else if (jr) dotColor = DOT.journal;
                else if (sc) dotColor = DOT.session;
                const isTodayCell = iso === todayIso;
                const isSelectedCell = dayDetailIso === iso;
                const isHighlightedCell = isTodayCell || isSelectedCell;

                const cellShellStyle = isWeb
                  ? [
                      styles.dayCellWeb,
                      isSelectedCell ? styles.dayCellSelectedWeb : null,
                      isTodayCell && !isSelectedCell ? styles.dayCellTodayRingWeb : null,
                    ]
                  : [
                      styles.cell,
                      isTodayCell ? styles.cellToday : null,
                      isSelectedCell && !isTodayCell ? styles.cellSelected : null,
                    ];

                const numStyle = isWeb
                  ? [
                      styles.cellNumWeb,
                      isSelectedCell ? styles.cellNumWebSelected : null,
                      isTodayCell && !isSelectedCell ? styles.cellNumWebToday : null,
                    ]
                  : [
                      styles.cellNum,
                      isTodayCell ? styles.cellNumToday : null,
                      isSelectedCell && !isTodayCell ? styles.cellNumSelected : null,
                    ];

                const dotRowStyle = isWeb ? [styles.dotRow, styles.dotRowWeb] : styles.dotRow;

                return (
                  <Pressable key={iso} style={cellShellStyle} onPress={() => setDayDetailIso(iso)}>
                    <Text style={numStyle}>{Number(iso.slice(8, 10))}</Text>
                    <View style={dotRowStyle}>
                      {dotColor ? (
                        isHighlightedCell ? (
                          <View
                            style={[
                              styles.dotHalo,
                              {
                                borderColor: withAlpha(theme.accent, 0.5),
                                backgroundColor: withAlpha(theme.accent, 0.22),
                              },
                            ]}>
                            <View style={[styles.dotInner, { backgroundColor: dotColor }]} />
                          </View>
                        ) : (
                          <View style={[styles.dot, { backgroundColor: dotColor }]} />
                        )
                      ) : (
                        <View style={styles.dotPlaceholder} />
                      )}
                    </View>
                  </Pressable>
                );
              };

              const monthCalendar = isWeb ? (
                <View style={styles.calendarCardWeb}>
                  <View style={styles.monthRowWeb}>
                    <Text style={styles.monthTitleWeb}>{monthLabel}</Text>
                    <View style={styles.monthControlsWeb}>
                      <Pressable hitSlop={8} onPress={() => shiftMonth(-1)}>
                        <Ionicons name="chevron-back" size={18} color={theme.primary} />
                      </Pressable>
                      <Pressable hitSlop={8} onPress={() => shiftMonth(1)}>
                        <Ionicons name="chevron-forward" size={18} color={theme.primary} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.weekdayRowWeb}>
                    {weekdayLabels.map((d, i) => (
                      <Text key={`${d}-${i}`} style={styles.weekdayWeb}>
                        {d}
                      </Text>
                    ))}
                  </View>

                  {monthLoading ? <ActivityIndicator color={theme.accent} style={{ marginVertical: 16 }} /> : null}

                  <View style={styles.gridWeb}>{grid.map((cell, idx) => renderDayCell(cell, idx))}</View>

                  <View style={styles.legendRowWeb}>
                    <View style={styles.legendItemWeb}>
                      <View style={[styles.dot, { backgroundColor: DOT.session }]} />
                      <Text style={styles.legendTextWeb}>Session</Text>
                    </View>
                    <View style={styles.legendItemWeb}>
                      <View style={[styles.dot, { backgroundColor: DOT.journal }]} />
                      <Text style={styles.legendTextWeb}>Reflection</Text>
                    </View>
                    <View style={styles.legendItemWeb}>
                      <View style={[styles.dot, { backgroundColor: DOT.both }]} />
                      <Text style={styles.legendTextWeb}>Both</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View>
                  <View style={styles.monthNav}>
                    <Pressable onPress={() => shiftMonth(-1)} hitSlop={12} style={styles.monthArrow}>
                      <Ionicons name="chevron-back" size={22} color={theme.primary} />
                    </Pressable>
                    <Text style={styles.monthTitle}>{monthLabel}</Text>
                    <Pressable onPress={() => shiftMonth(1)} hitSlop={12} style={styles.monthArrow}>
                      <Ionicons name="chevron-forward" size={22} color={theme.primary} />
                    </Pressable>
                  </View>

                  <View style={styles.weekdayRow}>
                    {weekdayLabels.map((d, i) => (
                      <Text key={`${d}-${i}`} style={styles.weekday}>
                        {d}
                      </Text>
                    ))}
                  </View>

                  {monthLoading ? <ActivityIndicator color={theme.accent} style={{ marginVertical: 16 }} /> : null}

                  <View style={styles.grid}>
                    {Array.from({ length: 6 }, (_, row) => (
                      <View key={`row-${row}`} style={styles.gridRow}>
                        {grid.slice(row * 7, row * 7 + 7).map((cell, colIdx) => renderDayCell(cell, row * 7 + colIdx))}
                      </View>
                    ))}
                  </View>
                </View>
              );

              return swipeMonthGesture ? (
                <GestureDetector gesture={swipeMonthGesture}>{monthCalendar}</GestureDetector>
              ) : (
                monthCalendar
              );
            })()}

            {athleteId &&
            (habits.length > 0 ||
              todaysSessionsByStatus.planned.length > 0 ||
              todaysSessionsByStatus.completed.length > 0) ? (
              <View style={styles.todayCard}>
                <Text style={styles.todayCardTitle}>Today</Text>
                {todaysSessionsByStatus.planned.length > 0 ? (
                  <View style={styles.todayBlock}>
                    <Text style={styles.todayBlockLabel}>Planned</Text>
                    {todaysSessionsByStatus.planned.map((s) => (
                      <View key={s.id} style={styles.todaySessionRow}>
                        <Pressable
                          style={styles.todaySessionMainPressable}
                          onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                          <Text style={styles.todaySessionText} numberOfLines={2}>
                            • {s.title} ({s.sport})
                          </Text>
                        </Pressable>
                        <SessionRemoveIconButton
                          iconColor={theme.textMuted}
                          onPress={() =>
                            promptRemoveSession({
                              id: s.id,
                              title: s.title,
                              scheduled_date: s.scheduled_date,
                              status: s.status,
                              completionStatus: s.completionStatus,
                            })
                          }
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Session details"
                          hitSlop={8}
                          onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                {todaysSessionsByStatus.completed.length > 0 ? (
                  <View style={styles.todayBlock}>
                    <Text style={styles.todayBlockLabel}>Completed</Text>
                    {todaysSessionsByStatus.completed.map((s) => (
                      <View key={s.id} style={styles.todaySessionRow}>
                        <Pressable
                          style={styles.todaySessionMainPressable}
                          onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                          <Text style={styles.todaySessionText} numberOfLines={2}>
                            • {s.title} ({s.sport})
                            {s.duration_mins != null ? ` · ${s.duration_mins} min` : ''}
                          </Text>
                        </Pressable>
                        <SessionRemoveIconButton
                          iconColor={theme.textMuted}
                          onPress={() =>
                            promptRemoveSession({
                              id: s.id,
                              title: s.title,
                              scheduled_date: s.scheduled_date,
                              status: s.status,
                              completionStatus: s.completionStatus,
                            })
                          }
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Session details"
                          hitSlop={8}
                          onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                          <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                {habits.length > 0 ? (
                  <View style={styles.todayBlock}>
                    <Text style={styles.todayBlockLabel}>Habits</Text>
                    <Text style={styles.todayHabitHint}>Tap to mark done for today.</Text>
                    {habits.map((h) => {
                      const done = (monthBundle?.habitCompletionsByDate.get(todayIso) ?? new Set<string>()).has(h.id);
                      const dates = streakData?.habitCompletionByHabit.get(h.id) ?? new Set<string>();
                      const streak = calendarDayStreak(dates, todayIso);
                      const streakLabel = streak >= 3 ? `${streak} day streak` : null;
                      return (
                        <Pressable
                          key={h.id}
                          onPress={() => onToggleTodayHabit(h.id)}
                          style={[
                            styles.todayHabitCard,
                            { backgroundColor: done ? withAlpha(theme.accent, 0.18) : withAlpha(theme.primary, 0.06) },
                          ]}>
                          <Text style={styles.todayHabitEmoji}>{h.icon_emoji}</Text>
                          <View style={styles.todayHabitCopy}>
                            <Text style={styles.todayHabitName}>{h.name}</Text>
                            {streakLabel ? <Text style={styles.todayHabitStreak}>{streakLabel}</Text> : null}
                          </View>
                          <Ionicons
                            name={done ? 'checkmark-circle' : 'ellipse-outline'}
                            size={22}
                            color={done ? theme.accent : theme.textMuted}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}

            <Pressable style={styles.reflectCta} onPress={() => setReflectIso(todayIso)}>
              <Ionicons name="create-outline" size={18} color={theme.onPrimary} />
              <Text style={styles.reflectCtaText}>Reflect on today</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <FloatingPillNav active="journal" />

      {athleteId && reflectIso ? (
        <DailyReflectionSheet
          visible
          athleteId={athleteId}
          entryDateIso={reflectIso}
          onClose={() => setReflectIso(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: journalQueryKeys.all });
          }}
        />
      ) : null}

      {athleteId && dayDetailIso ? (
        <JournalDayDetailModal
          iso={dayDetailIso}
          athleteId={athleteId}
          sessions={sessions.filter((s) => s.scheduled_date === dayDetailIso)}
          habitIdsDone={monthBundle?.habitCompletionsByDate.get(dayDetailIso) ?? new Set()}
          habits={habits}
          onRemoveSession={promptRemoveSession}
          onClose={() => setDayDetailIso(null)}
          onEditReflection={(dateIso) => {
            setDayDetailIso(null);
            setReflectIso(dateIso);
          }}
        />
      ) : null}

      {athleteId ? (
        <JournalHabitManagerModal visible={managerOpen} athleteId={athleteId} onClose={() => setManagerOpen(false)} />
      ) : null}

      <Modal transparent visible={exportOpen} animationType="fade" onRequestClose={() => !exportBusy && setExportOpen(false)}>
        <View style={styles.exportRoot}>
          <Pressable style={styles.exportBackdrop} onPress={() => !exportBusy && setExportOpen(false)} />
          <View style={[styles.exportSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.exportTitle}>Export journal</Text>
            {Platform.OS === 'web' ? (
              <Text style={styles.exportSub}>Markdown · share sheet</Text>
            ) : (
              <View style={styles.exportKindRow}>
                <Pressable
                  style={[styles.exportKindBtn, exportKind === 'markdown' ? styles.exportKindBtnOn : null]}
                  disabled={exportBusy}
                  onPress={() => setExportKind('markdown')}>
                  <Text style={[styles.exportKindText, exportKind === 'markdown' ? styles.exportKindTextOn : null]}>Markdown</Text>
                </Pressable>
                <Pressable
                  style={[styles.exportKindBtn, exportKind === 'pdf' ? styles.exportKindBtnOn : null]}
                  disabled={exportBusy}
                  onPress={() => setExportKind('pdf')}>
                  <Text style={[styles.exportKindText, exportKind === 'pdf' ? styles.exportKindTextOn : null]}>PDF</Text>
                </Pressable>
              </View>
            )}
            <Text style={styles.exportSub}>
              {Platform.OS === 'web'
                ? 'Opens the share / download flow for Markdown.'
                : exportKind === 'pdf'
                  ? 'Telo-styled PDF (cover, one page per day with data, habit summary).'
                  : 'Plain Markdown for other apps.'}
            </Text>
            {exportPresets().map((p) => (
              <Pressable
                key={p.label}
                style={styles.exportRow}
                disabled={exportBusy}
                onPress={() => void onExportRange(p.from, p.to, Platform.OS === 'web' ? 'markdown' : exportKind)}>
                <Text style={styles.exportRowText}>{p.label}</Text>
                <Ionicons name="download-outline" size={18} color={theme.textMuted} />
              </Pressable>
            ))}
            {exportBusy ? <ActivityIndicator style={{ marginTop: 12 }} color={theme.accent} /> : null}
            <Pressable style={styles.exportCancel} disabled={exportBusy} onPress={() => setExportOpen(false)}>
              <Text style={styles.exportCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function JournalDayDetailModal({
  iso,
  athleteId,
  sessions,
  habitIdsDone,
  habits,
  onRemoveSession,
  onClose,
  onEditReflection,
}: {
  iso: string;
  athleteId: string;
  sessions: SessionWithCompletion[];
  habitIdsDone: Set<string>;
  habits: { id: string; name: string; icon_emoji: string }[];
  onRemoveSession: (session: RemovableSession) => void;
  onClose: () => void;
  onEditReflection: (dateIso: string) => void;
}) {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { data: reflection } = useDailyReflectionQuery(athleteId, iso);
  const toggleHabitDay = useToggleHabitCompletionMutation(athleteId);
  const { data: habitStreakData } = useJournalStreakData(athleteId);

  const onToggleDayHabit = useCallback(
    (habitId: string) => {
      const completed = !habitIdsDone.has(habitId);
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      void toggleHabitDay.mutateAsync({ habitId, dateIso: iso, completed });
    },
    [habitIdsDone, iso, toggleHabitDay]
  );

  const planned = sessions.filter((s) => normalizeCompletionStatus(s.status, s.session_logs as never) !== 'completed');
  const completed = sessions.filter((s) => normalizeCompletionStatus(s.status, s.session_logs as never) === 'completed');

  const hasAnything =
    reflection != null ||
    completed.length > 0 ||
    planned.length > 0 ||
    habits.length > 0;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.detailRoot, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.detailHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.closeLink}>Close</Text>
          </Pressable>
          <Text style={styles.detailTitle}>{iso}</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={styles.detailScroll}>
          {!hasAnything ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Nothing logged yet. Tap below to add a reflection.</Text>
              <Pressable style={styles.reflectCta} onPress={() => onEditReflection(iso)}>
                <Text style={styles.reflectCtaText}>Add reflection</Text>
              </Pressable>
            </View>
          ) : null}

          {planned.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Planned</Text>
              {planned.map((s) => (
                <View key={s.id} style={styles.sessionRowPressable}>
                  <Pressable
                    style={styles.sessionRowMainPressable}
                    onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                    <Text style={styles.sessionLineText} numberOfLines={2}>
                      • {s.title} ({s.sport})
                    </Text>
                  </Pressable>
                  <SessionRemoveIconButton
                    iconColor={theme.textMuted}
                    onPress={() =>
                      onRemoveSession({
                        id: s.id,
                        title: s.title,
                        scheduled_date: s.scheduled_date,
                        status: s.status,
                        completionStatus: s.completionStatus,
                      })
                    }
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Session details"
                    hitSlop={8}
                    onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {completed.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Completed</Text>
              {completed.map((s) => (
                <View key={s.id} style={styles.sessionRowPressable}>
                  <Pressable
                    style={styles.sessionRowMainPressable}
                    onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                    <Text style={styles.sessionLineText} numberOfLines={2}>
                      • {s.title} ({s.sport})
                      {s.duration_mins != null ? ` · ${s.duration_mins} min` : ''}
                    </Text>
                  </Pressable>
                  <SessionRemoveIconButton
                    iconColor={theme.textMuted}
                    onPress={() =>
                      onRemoveSession({
                        id: s.id,
                        title: s.title,
                        scheduled_date: s.scheduled_date,
                        status: s.status,
                        completionStatus: s.completionStatus,
                      })
                    }
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Session details"
                    hitSlop={8}
                    onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {reflection ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Reflection</Text>
              <Text style={styles.metaLine}>
                Mood {reflection.mood ?? '—'}/5 · Energy {reflection.energy ?? '—'}/5
                {reflection.sleep_quality != null ? ` · Sleep ${reflection.sleep_quality}/5` : ''}
              </Text>
              <Text style={styles.bodyText}>{reflection.body_text || '—'}</Text>
            </View>
          ) : null}

          {habits.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Habits</Text>
              <Text style={styles.detailHabitHint}>Tap to mark done for this day.</Text>
              {habits.map((h) => {
                const done = habitIdsDone.has(h.id);
                const dates = habitStreakData?.habitCompletionByHabit.get(h.id) ?? new Set<string>();
                const streak = calendarDayStreak(dates, iso);
                const streakLabel = streak >= 3 ? `${streak} day streak` : null;
                return (
                  <Pressable
                    key={h.id}
                    onPress={() => onToggleDayHabit(h.id)}
                    style={[
                      styles.detailHabitCard,
                      { backgroundColor: done ? withAlpha(theme.accent, 0.18) : withAlpha(theme.primary, 0.06) },
                    ]}>
                    <Text style={styles.detailHabitEmoji}>{h.icon_emoji}</Text>
                    <View style={styles.detailHabitCopy}>
                      <Text style={styles.detailHabitName}>{h.name}</Text>
                      {streakLabel ? <Text style={styles.detailHabitStreak}>{streakLabel}</Text> : null}
                    </View>
                    <Ionicons
                      name={done ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={done ? theme.accent : theme.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {hasAnything ? (
            <Pressable style={[styles.secondaryBtn, { marginTop: 16 }]} onPress={() => onEditReflection(iso)}>
              <Text style={styles.secondaryBtnText}>Edit reflection</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.base },
    content: {
      paddingHorizontal: TAB_SCREEN_PADDING_HORIZONTAL,
      paddingTop: TAB_SCREEN_CONTENT_PADDING_TOP,
      paddingBottom: 140,
    },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
    titleWrap: { flex: 1, minWidth: 0 },
    topActions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
    iconBtn: { padding: 8 },
    todayPill: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.primary,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.2),
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
    },
    muted: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: theme.textMuted, marginTop: 12 },
    streakCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.surface,
      padding: 14,
      marginTop: 8,
      marginBottom: 12,
    },
    streakTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 11, letterSpacing: 0.6, color: theme.accent, marginBottom: 6 },
    streakBody: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: theme.text },
    streakEm: { fontFamily: 'DMSans_600SemiBold', color: theme.primary },
    streakFire: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: theme.primary, marginTop: 8 },
    todayCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.surface,
      padding: 14,
      marginTop: 12,
      marginBottom: 4,
    },
    todayCardTitle: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 13,
      color: theme.text,
      marginBottom: 10,
    },
    todayBlock: { marginBottom: 12 },
    todayBlockLabel: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.5,
      color: theme.accent,
      marginBottom: 6,
    },
    todaySessionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 4,
    },
    todaySessionMainPressable: {
      flex: 1,
      minWidth: 0,
    },
    todaySessionText: {
      flex: 1,
      fontFamily: 'DMSans_400Regular',
      fontSize: 14,
      color: theme.primary,
    },
    todayHabitHint: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
      marginBottom: 8,
    },
    todayHabitCard: {
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
    todayHabitEmoji: { fontSize: 22 },
    todayHabitCopy: { flex: 1 },
    todayHabitName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: theme.text },
    todayHabitStreak: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: theme.textMuted, marginTop: 2 },
    calendarCardWeb: {
      backgroundColor: theme.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.1),
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 10,
      marginTop: 8,
    },
    monthRowWeb: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    monthTitleWeb: {
      flex: 1,
      marginRight: 8,
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 15,
      color: theme.text,
    },
    monthControlsWeb: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    weekdayRowWeb: { flexDirection: 'row', marginBottom: 8 },
    weekdayWeb: {
      width: `${100 / 7}%`,
      textAlign: 'center',
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      color: theme.textMuted,
    },
    gridWeb: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 4,
      paddingHorizontal: 2,
      paddingVertical: 0,
    },
    dayCellWeb: {
      width: '13.5%',
      height: 54,
      borderRadius: 10,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    dayCellEmptyWeb: {
      width: '13.5%',
      height: 56,
      backgroundColor: 'transparent',
      borderWidth: 0,
    },
    dayCellTodayRingWeb: {
      borderColor: theme.primary,
      backgroundColor: theme.surface,
    },
    dayCellSelectedWeb: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    cellNumWeb: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 14,
      color: theme.text,
      marginBottom: 1,
    },
    cellNumWebToday: {
      color: theme.text,
    },
    cellNumWebSelected: {
      fontFamily: 'DMSans_600SemiBold',
      color: theme.onPrimary,
    },
    dotRowWeb: {
      minHeight: 12,
      marginTop: 0,
    },
    legendRowWeb: {
      marginTop: 4,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      columnGap: 10,
      rowGap: 6,
    },
    legendItemWeb: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendTextWeb: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 10,
      color: theme.textMuted,
    },
    monthNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    monthArrow: { padding: 4 },
    monthTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 22, color: theme.text },
    weekdayRow: { flexDirection: 'row', marginBottom: 0 },
    weekday: { flex: 1, textAlign: 'center', fontFamily: 'DMSans_500Medium', fontSize: 10, color: theme.textMuted },
    grid: { marginTop: 0 },
    gridRow: { flexDirection: 'row' },
    cell: {
      flex: 1,
      aspectRatio: 0.56,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 0,
    },
    cellToday: { backgroundColor: withAlpha(theme.accent, 0.12), borderRadius: 8 },
    cellSelected: { backgroundColor: withAlpha(theme.primary, 0.1), borderRadius: 8 },
    cellNum: { fontFamily: 'DMSans_500Medium', fontSize: 11, color: theme.text },
    cellNumToday: { color: theme.primary },
    cellNumSelected: { color: theme.primary, fontFamily: 'DMSans_600SemiBold' },
    dotRow: {
      minHeight: 9,
      marginTop: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: { width: 4, height: 4, borderRadius: 2 },
    dotInner: { width: 4, height: 4, borderRadius: 2 },
    dotHalo: {
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dotPlaceholder: { width: 4, height: 4 },
    reflectCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 20,
      backgroundColor: theme.primary,
      paddingVertical: 18,
      paddingHorizontal: 28,
      borderRadius: 999,
    },
    reflectCtaText: { fontFamily: 'DMSans_600SemiBold', fontSize: 15, color: theme.onPrimary },
    exportRoot: { flex: 1, justifyContent: 'flex-end' },
    exportBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
    exportSheet: {
      marginHorizontal: 16,
      marginBottom: 24,
      borderRadius: 16,
      backgroundColor: theme.surface,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    exportTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 24, color: theme.text },
    exportSub: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: theme.textMuted, marginBottom: 12, marginTop: 4 },
    exportKindRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
    },
    exportKindBtn: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.18),
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: theme.base,
    },
    exportKindBtnOn: {
      borderColor: theme.accent,
      backgroundColor: withAlpha(theme.accent, 0.12),
    },
    exportKindText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: theme.textMuted },
    exportKindTextOn: { color: theme.primary },
    exportRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    exportRowText: { fontFamily: 'DMSans_500Medium', fontSize: 15, color: theme.text },
    exportCancel: { alignSelf: 'center', marginTop: 12, padding: 8 },
    exportCancelText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: theme.textMuted },
    detailRoot: { flex: 1, backgroundColor: theme.base },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      marginBottom: 8,
    },
    closeLink: { fontFamily: 'DMSans_500Medium', fontSize: 16, color: theme.accent },
    detailTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 20, color: theme.text },
    detailScroll: { paddingHorizontal: 16, paddingBottom: 32 },
    empty: { paddingVertical: 24, alignItems: 'center' },
    emptyText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: theme.textMuted, textAlign: 'center', marginBottom: 16 },
    block: { marginBottom: 18 },
    blockTitle: { fontFamily: 'DMSans_600SemiBold', fontSize: 12, color: theme.accent, marginBottom: 6 },
    line: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: theme.text, marginBottom: 4 },
    sessionRowPressable: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
    },
    sessionRowMainPressable: {
      flex: 1,
      minWidth: 0,
    },
    sessionLineText: {
      flex: 1,
      fontFamily: 'DMSans_400Regular',
      fontSize: 14,
      color: theme.primary,
    },
    detailHabitHint: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
      marginBottom: 8,
    },
    detailHabitCard: {
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
    detailHabitEmoji: { fontSize: 22 },
    detailHabitCopy: { flex: 1 },
    detailHabitName: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: theme.text },
    detailHabitStreak: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: theme.textMuted, marginTop: 2 },
    metaLine: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: theme.textMuted, marginBottom: 8 },
    bodyText: { fontFamily: 'DMSans_400Regular', fontSize: 14, color: theme.text, lineHeight: 22 },
    secondaryBtn: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    secondaryBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: theme.primary },
  });
}

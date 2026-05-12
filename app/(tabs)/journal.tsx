import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
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
} from '@/hooks/useJournalAndHabits';
import { useActiveAthlete, useMonthSessions, normalizeCompletionStatus, type SessionWithCompletion } from '@/hooks/useSessionData';
import { mondayBasedMonthLeadingDayCount, toLocalIsoDate } from '@/lib/dates';
import { withAlpha } from '@/lib/theme-utils';
import { shareJournalMarkdownExport } from '@/services/exportJournalMarkdown';

const DOT = { session: '#2E7D32', journal: '#7B2D42', both: '#D4A5A5' };

export default function JournalScreen() {
  const { theme } = useTheme();
  const { data: athlete } = useActiveAthlete();
  const athleteId = athlete?.id ?? '';
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
              const monthCalendar = (
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
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                      <Text key={`${d}-${i}`} style={styles.weekday}>
                        {d}
                      </Text>
                    ))}
                  </View>

                  {monthLoading ? <ActivityIndicator color={theme.accent} style={{ marginVertical: 16 }} /> : null}

                  <View style={styles.grid}>
                    {Array.from({ length: 6 }, (_, row) => (
                      <View key={`row-${row}`} style={styles.gridRow}>
                        {grid.slice(row * 7, row * 7 + 7).map((cell, colIdx) => {
                          const idx = row * 7 + colIdx;
                          if (!cell) {
                            return <View key={`e-${idx}`} style={styles.cell} />;
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
                          return (
                            <Pressable
                              key={iso}
                              style={[
                                styles.cell,
                                isTodayCell ? styles.cellToday : null,
                                isSelectedCell && !isTodayCell ? styles.cellSelected : null,
                              ]}
                              onPress={() => setDayDetailIso(iso)}>
                              <Text
                                style={[
                                  styles.cellNum,
                                  isTodayCell ? styles.cellNumToday : null,
                                  isSelectedCell && !isTodayCell ? styles.cellNumSelected : null,
                                ]}>
                                {Number(iso.slice(8, 10))}
                              </Text>
                              <View style={styles.dotRow}>
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
                        })}
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
  onClose,
  onEditReflection,
}: {
  iso: string;
  athleteId: string;
  sessions: SessionWithCompletion[];
  habitIdsDone: Set<string>;
  habits: { id: string; name: string; icon_emoji: string }[];
  onClose: () => void;
  onEditReflection: (dateIso: string) => void;
}) {
  const router = useRouter();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { data: reflection } = useDailyReflectionQuery(athleteId, iso);

  const planned = sessions.filter((s) => normalizeCompletionStatus(s.status, s.session_logs as never) !== 'completed');
  const completed = sessions.filter((s) => normalizeCompletionStatus(s.status, s.session_logs as never) === 'completed');

  const hasAnything =
    reflection != null ||
    completed.length > 0 ||
    planned.length > 0 ||
    habits.some((h) => habitIdsDone.has(h.id));

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
                <Pressable
                  key={s.id}
                  onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}
                  style={styles.sessionRowPressable}>
                  <Text style={[styles.line, styles.sessionLine]}>
                    • {s.title} ({s.sport})
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {completed.length > 0 ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Completed</Text>
              {completed.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => router.push(`/SessionDetail?sessionId=${s.id}`)}
                  style={styles.sessionRowPressable}>
                  <Text style={[styles.line, styles.sessionLine]}>
                    • {s.title} ({s.sport})
                    {s.duration_mins != null ? ` · ${s.duration_mins} min` : ''}
                  </Text>
                </Pressable>
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
              {habits.map((h) => (
                <Text key={h.id} style={styles.line}>
                  {habitIdsDone.has(h.id) ? '✓' : '○'} {h.icon_emoji} {h.name}
                </Text>
              ))}
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
      paddingVertical: 14,
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
    sessionRowPressable: { paddingVertical: 2 },
    sessionLine: { color: theme.primary },
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

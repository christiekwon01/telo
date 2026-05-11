import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { StatusAreaFade } from '@/components/status-area-fade';
import { useTheme } from '@/contexts/ThemeContext';
import { invalidateSessionRelatedQueries, useActiveAthlete } from '@/hooks/useSessionData';
import { ensureAthleteRowExists, ensureSupabaseAuthUser } from '@/lib/supabase-auth';
import { withAlpha } from '@/lib/theme-utils';
import { supabase } from '@/lib/supabase';
import {
  askRova,
  buildRovaShortcutContext,
  type RovaLogSessionPayload,
  type RovaMessageTurn,
  type RovaShortcutKind,
} from '@/services/rovaIntelligence';
import { pickCelebrationImprovement, syncPersonalBestsAfterSessionLogsChange } from '@/services/personalBests';
import { usePersonalBestCelebrationStore } from '@/store/personal-best-celebration-store';

type ChatRow =
  | { id: string; role: 'user'; message: string; createdAt: string }
  | {
      id: string;
      role: 'assistant';
      message: string;
      createdAt: string;
      source?: 'template' | 'claude';
      pendingLog?: RovaLogSessionPayload;
    }
  | { id: string; role: 'error'; message: string };

function isMissingRovaConversationsTable(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the table 'public.rova_conversations'") ||
    m.includes('schema cache') ||
    m.includes('relation "public.rova_conversations" does not exist') ||
    m.includes('relation "rova_conversations" does not exist')
  );
}

function stripErrorRows(rows: ChatRow[]): ChatRow[] {
  return rows.filter((m) => m.role !== 'error');
}

function toFriendlyRovaErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const msg = raw.trim();

  // Default fallback (also used when we can't infer anything).
  if (!msg) return "I couldn't process that. Check your connection and try again.";

  const lower = msg.toLowerCase();
  if (lower.includes('network request failed') || lower.includes('failed to fetch')) {
    return "I can't reach Rova right now. Check your connection and try again.";
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Rova is taking too long to respond. Please try again.';
  }
  if (lower.includes('api key missing') || lower.includes('not configured')) {
    return "Rova isn't configured yet. Add EXPO_PUBLIC_ANTHROPIC_API_KEY and restart the app.";
  }
  if (lower.includes('api key is invalid') || lower.includes('invalid api key') || lower.includes('unauthorized')) {
    return 'Rova API key is invalid. Update EXPO_PUBLIC_ANTHROPIC_API_KEY and restart the app.';
  }
  if (lower.includes('authentication failed') || lower.includes('anthropic_api_key')) {
    return 'Rova authentication failed. Check EXPO_PUBLIC_ANTHROPIC_API_KEY and restart the app.';
  }
  if (lower.includes('returned invalid json') || lower.includes('returned an empty response')) {
    return "Rova returned an unexpected response. Please try again in a moment.";
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return "Rova is getting a lot of requests. Try again in a moment.";
  }
  if (lower.includes('rova request failed')) {
    return "Rova couldn't answer that right now. Please try again.";
  }

  // If we got here, the message might be safe/user-meaningful (e.g. Supabase errors).
  return msg;
}

const STARTERS = [
  "How's my fatigue this week?",
  'Am I race-ready right now?',
  'Give me a quick training overview',
  "Should I skip today's session?",
  'How should I pace race day?',
  'How should I adjust for hot weather?',
];

const SHORTCUTS: { kind: RovaShortcutKind; label: string }[] = [
  { kind: 'week', label: "Share this week's data" },
  { kind: 'last7', label: 'Show last 7 days' },
  { kind: 'planCompare', label: 'Compare to plan' },
];

const QUICK_LOG_PILLS: { label: string; sendText: string }[] = [
  { label: 'Log a session', sendText: 'Log a session — help me log what I did.' },
  { label: 'I just trained', sendText: 'I just trained — help me log what I did.' },
];

const INTENSITY_OPTIONS = ['Easy', 'Steady', 'Tempo', 'Threshold', 'Sprint'] as const;

async function fetchActivePlanMetaForLog(athleteId: string): Promise<{
  id: string;
  athlete_id: string;
  start_date: string;
  phase: string | null;
  total_weeks: number;
} | null> {
  const { data, error } = await supabase
    .from('plans')
    .select('id,athlete_id,start_date,phase,total_weeks')
    .eq('athlete_id', athleteId)
    .eq('status', 'active')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    athlete_id: data.athlete_id,
    start_date: data.start_date,
    phase: data.phase,
    total_weeks: data.total_weeks ?? 12,
  };
}

function computeWeekNumberForLog(planStartIso: string, scheduledIso: string, totalWeeks: number): number {
  const [y1, m1, d1] = planStartIso.split('-').map(Number);
  const [y2, m2, d2] = scheduledIso.split('-').map(Number);
  const start = new Date(y1, m1 - 1, d1);
  const sched = new Date(y2, m2 - 1, d2);
  const diffDays = Math.round((sched.getTime() - start.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  const clampedLow = Math.max(1, week);
  return Math.min(clampedLow, Math.max(1, totalWeeks));
}

function normalizeIntensityForLog(raw: string): (typeof INTENSITY_OPTIONS)[number] {
  const t = raw.trim().toLowerCase();
  const hit = INTENSITY_OPTIONS.find((i) => i.toLowerCase() === t);
  return hit ?? 'Steady';
}

function formatPreviewDuration(mins: number | null) {
  if (mins == null) return '—';
  return `${mins} min`;
}

function formatPreviewDistance(distance: number | null, unit: 'm' | 'km' | null) {
  if (distance == null) return '—';
  const u = unit ?? 'km';
  return `${distance} ${u}`;
}

function formatTimeLabel(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function TypingDots({ color }: { color: string }) {
  const v1 = useRef(new Animated.Value(0)).current;
  const v2 = useRef(new Animated.Value(0)).current;
  const v3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const mkLoop = (v: Animated.Value, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 320, useNativeDriver: true }),
          Animated.delay(280),
        ])
      );
    const l1 = mkLoop(v1, 0);
    const l2 = mkLoop(v2, 110);
    const l3 = mkLoop(v3, 220);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, [v1, v2, v3]);
  const dot = (v: Animated.Value) => (
    <Animated.View
      style={[
        styles.typingDot,
        {
          backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] }),
        },
      ]}
    />
  );
  return (
    <View style={styles.typingRow}>
      {dot(v1)}
      {dot(v2)}
      {dot(v3)}
    </View>
  );
}

export default function IntelligenceScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isLoading: athleteLoading } = useActiveAthlete();
  const [authAthleteId, setAuthAthleteId] = useState<string | null>(null);
  const athleteId = authAthleteId;

  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [shortcutLoading, setShortcutLoading] = useState<RovaShortcutKind | null>(null);
  const [attachmentPrefix, setAttachmentPrefix] = useState<string | null>(null);
  const [confirmingLogMessageId, setConfirmingLogMessageId] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  /** Sync guard — `isLoading` can lag one frame, so double-send still races without this. */
  const sendInFlightRef = useRef(false);
  /** Same pattern: guard confirm while async save runs (state lags one frame). */
  const confirmLogInFlightRef = useRef(false);

  const stylesThemed = useMemo(
    () =>
      StyleSheet.create({
        safe: { flex: 1, backgroundColor: theme.base },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          // Extra top padding prevents TabHeader title from clipping under the notch/status area.
          paddingTop: Math.max(insets.top, 12) + 6,
          paddingBottom: 12,
          minHeight: Math.max(insets.top, 12) + 52,
          backgroundColor: theme.base,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
        headerTitle: {
          fontFamily: 'CormorantGaramond_700Bold',
          fontSize: 36,
          lineHeight: 40,
          color: theme.primary,
          flex: 1,
        },
        headerClearBtn: {
          width: 44,
          height: 44,
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: 8,
        },
        suggestionPill: {
          flexGrow: 1,
          flexBasis: '42%',
          paddingVertical: 12,
          paddingHorizontal: 12,
          borderRadius: 14,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: withAlpha(theme.primary, 0.12),
        },
        suggestionText: {
          fontFamily: 'DMSans-Medium',
          fontSize: 13,
          color: theme.text,
          textAlign: 'center',
        },
        shortcutPill: {
          paddingVertical: 5,
          paddingHorizontal: 8,
          borderRadius: 10,
          backgroundColor: withAlpha(theme.primary, 0.06),
          borderWidth: 1,
          borderColor: withAlpha(theme.text, 0.1),
        },
        shortcutText: {
          fontFamily: 'DMSans-Medium',
          fontSize: 11,
          color: theme.text,
        },
        inputWrap: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.border,
          backgroundColor: theme.base,
        },
        input: {
          flex: 1,
          minHeight: 44,
          maxHeight: 120,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 10,
          fontFamily: 'DMSans-Medium',
          fontSize: 15,
          color: theme.text,
          backgroundColor: theme.base,
          borderWidth: 1,
          borderColor: withAlpha(theme.primary, 0.45),
        },
        sendBtn: {
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
        },
        thinkingCaption: {
          fontFamily: 'DMSans-Medium',
          fontSize: 12,
          color: theme.textMuted,
          textAlign: 'center',
          paddingBottom: 6,
          backgroundColor: theme.base,
        },
        bubbleUser: {
          alignSelf: 'flex-end',
          maxWidth: '80%',
          backgroundColor: theme.primary,
          borderRadius: 18,
          paddingVertical: 10,
          paddingHorizontal: 14,
        },
        bubbleUserText: {
          fontFamily: 'DMSans-Medium',
          fontSize: 15,
          color: theme.onPrimary,
        },
        bubbleAssist: {
          alignSelf: 'flex-start',
          maxWidth: '85%',
          backgroundColor: theme.surface,
          borderRadius: 18,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: withAlpha(theme.text, 0.1),
        },
        bubbleAssistText: {
          fontFamily: 'DMSans-Medium',
          fontSize: 15,
          color: theme.text,
        },
        bubbleError: {
          alignSelf: 'flex-start',
          maxWidth: '85%',
          backgroundColor: withAlpha(theme.danger, 0.08),
          borderRadius: 18,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: withAlpha(theme.danger, 0.35),
        },
        bubbleErrorText: {
          fontFamily: 'DMSans-Medium',
          fontSize: 15,
          color: theme.danger,
        },
        ts: {
          fontFamily: 'DMSans-Medium',
          fontSize: 11,
          color: withAlpha(theme.text, 0.78),
          marginTop: 4,
        },
        logPreviewCard: {
          marginTop: 10,
          alignSelf: 'stretch',
          maxWidth: '85%',
          backgroundColor: withAlpha(theme.surface, 1),
          borderRadius: 14,
          borderWidth: 1,
          borderColor: withAlpha(theme.primary, 0.14),
          padding: 14,
          gap: 8,
        },
        logPreviewTitle: {
          fontFamily: 'DMSans-SemiBold',
          fontSize: 12,
          letterSpacing: 0.4,
          color: theme.accent,
          textTransform: 'uppercase',
        },
        sourceTag: {
          marginTop: 4,
          alignSelf: 'flex-start',
          borderRadius: 999,
          borderWidth: 1,
          borderColor: withAlpha(theme.accent, 0.42),
          backgroundColor: withAlpha(theme.accent, 0.12),
          paddingHorizontal: 8,
          paddingVertical: 2,
        },
        sourceTagText: {
          fontFamily: 'DMSans-SemiBold',
          fontSize: 11,
          color: theme.accent,
          letterSpacing: 0.2,
        },
        sourceSparkleWrap: {
          marginTop: 6,
          alignSelf: 'flex-start',
          width: 18,
          height: 18,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.accent, 0.12),
        },
        logPreviewRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          gap: 12,
        },
        logPreviewLabel: {
          fontFamily: 'DMSans-Medium',
          fontSize: 12,
          color: theme.textMuted,
          flexShrink: 0,
        },
        logPreviewValue: {
          fontFamily: 'DMSans-Medium',
          fontSize: 13,
          color: theme.text,
          flex: 1,
          textAlign: 'right',
        },
        confirmLogBtn: {
          marginTop: 6,
          borderRadius: 999,
          backgroundColor: theme.primary,
          paddingVertical: 12,
          alignItems: 'center',
        },
        confirmLogBtnDisabled: {
          opacity: 0.45,
        },
        confirmLogBtnText: {
          fontFamily: 'DMSans-Medium',
          fontSize: 14,
          color: theme.onPrimary,
        },
      }),
    [insets.top, theme]
  );

  const scrollBottom = () => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  };

  useEffect(() => {
    scrollBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    let mounted = true;
    const loadAuthUser = async () => {
      try {
        const authUser = await ensureSupabaseAuthUser();
        await ensureAthleteRowExists(authUser.id);
        if (!mounted) return;
        setAuthAthleteId(authUser.id);
      } catch {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!mounted) return;
        setAuthAthleteId(session?.user?.id ?? null);
      }
    };
    void loadAuthUser();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!athleteId) {
        setLoadingHistory(false);
        setMessages([]);
        return;
      }
      setLoadingHistory(true);
      const { data, error } = await supabase
        .from('rova_conversations')
        .select('id, role, message, created_at')
        .eq('athlete_id', athleteId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!cancelled) setLoadingHistory(false);
      if (error) {
        if (isMissingRovaConversationsTable(error.message)) {
          if (!cancelled) setMessages([]);
          return;
        }
        if (__DEV__) {
          console.warn('[Rova] load history', error.message);
        }
        return;
      }
      const rows = (data ?? []).slice().reverse();
      const mapped: ChatRow[] = rows
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .map((r) => ({
          id: r.id,
          role: r.role as 'user' | 'assistant',
          message: r.message,
          createdAt: r.created_at,
        }));
      if (!cancelled) setMessages(mapped);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  const historyForApi = useCallback((): RovaMessageTurn[] => {
    return messages
      .filter((m): m is Exclude<ChatRow, { role: 'error' }> => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map((m) => ({ role: m.role, message: m.message }));
  }, [messages]);

  const persistMessage = async (role: 'user' | 'assistant', message: string) => {
    let athleteIdForWrite = athleteId;
    if (!athleteIdForWrite) {
      const authUser = await ensureSupabaseAuthUser();
      await ensureAthleteRowExists(authUser.id);
      athleteIdForWrite = authUser.id;
      setAuthAthleteId(authUser.id);
    }
    if (!athleteIdForWrite) throw new Error('No athlete.');
    const { data, error } = await supabase
      .from('rova_conversations')
      .insert({ athlete_id: athleteIdForWrite, role, message })
      .select('id, created_at')
      .single();
    if (error) {
      if (isMissingRovaConversationsTable(error.message)) {
        return { id: `local-${role}-${Date.now()}`, createdAt: new Date().toISOString() };
      }
      throw new Error(error.message);
    }
    return { id: data.id, createdAt: data.created_at };
  };

  const sendMessage = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || !athleteId || isLoading || sendInFlightRef.current) return;
    sendInFlightRef.current = true;

    let question = trimmed;
    if (attachmentPrefix) {
      question = `${attachmentPrefix}\n\n${trimmed}`.trim();
      setAttachmentPrefix(null);
    }

    const turnsBefore = historyForApi();

    setInputText('');
    setIsLoading(true);

    try {
      const savedUser = await persistMessage('user', question);
      setMessages((prev) => [
        ...stripErrorRows(prev),
        { id: savedUser.id, role: 'user', message: question, createdAt: savedUser.createdAt },
      ]);

      const { parsed, source } = await askRova({
        athleteId,
        question,
        conversationHistory: turnsBefore,
      });

      const assistantBubbleText = parsed.message;
      const pendingLog =
        parsed.kind === 'log_session' && parsed.needsConfirmation ? parsed.sessionData : undefined;

      const savedAssistant = await persistMessage('assistant', assistantBubbleText);
      setMessages((prev) => [
        ...stripErrorRows(prev),
        {
          id: savedAssistant.id,
          role: 'assistant',
          message: assistantBubbleText,
          createdAt: savedAssistant.createdAt,
          source,
          ...(pendingLog ? { pendingLog } : {}),
        },
      ]);
    } catch (e) {
      const friendly = toFriendlyRovaErrorMessage(e);
      const msg = friendly.length > 160 ? `${friendly.slice(0, 160)}…` : friendly;
      if (__DEV__) {
        console.warn('[Rova] send failed', e);
      }
      setMessages((prev) => [...stripErrorRows(prev), { id: `err-${Date.now()}`, role: 'error', message: msg }]);
    } finally {
      sendInFlightRef.current = false;
      setIsLoading(false);
      scrollBottom();
    }
  };

  const confirmRovaSessionLog = async (assistantMessageId: string, data: RovaLogSessionPayload) => {
    if (!athleteId || confirmLogInFlightRef.current) return;
    confirmLogInFlightRef.current = true;
    setConfirmingLogMessageId(assistantMessageId);
    try {
      const planMeta = await fetchActivePlanMetaForLog(athleteId);
      if (!planMeta) {
        Alert.alert(
          'Plan unavailable',
          'Could not find an active training plan. Try again after your plan is loaded.'
        );
        return;
      }

      const completedAt = new Date().toISOString();
      const duration_mins =
        data.durationMins != null && Number.isFinite(data.durationMins) ? Math.round(data.durationMins) : null;
      const intensity = normalizeIntensityForLog(data.intensity);
      const week_number = computeWeekNumberForLog(planMeta.start_date, data.date, planMeta.total_weeks);

      const { data: inserted, error: insertError } = await supabase
        .from('sessions')
        .insert({
          plan_id: planMeta.id,
          athlete_id: planMeta.athlete_id,
          title: data.title,
          sport: data.sport,
          scheduled_date: data.date,
          duration_mins,
          distance: data.distance != null && Number.isFinite(data.distance) ? data.distance : null,
          distance_unit:
            data.distance != null && Number.isFinite(data.distance) ? data.distanceUnit ?? 'km' : null,
          intensity,
          status: 'completed',
          completed_at: completedAt,
          week_number,
          phase: planMeta.phase,
        })
        .select('id')
        .single();

      if (insertError || !inserted) {
        Alert.alert('Could not save session', insertError?.message ?? 'Unknown error');
        return;
      }

      const sessionRowId = inserted.id;

      const { error: logError } = await supabase.from('session_logs').insert({
        session_id: sessionRowId,
        athlete_id: planMeta.athlete_id,
        completed_at: completedAt,
        notes: data.notes,
        media_uris: null,
        actual_duration_mins: duration_mins,
        actual_distance: data.distance != null && Number.isFinite(data.distance) ? data.distance : null,
        avg_heart_rate: null,
        rpe: data.estimatedRPE,
      });

      if (logError) {
        Alert.alert('Session saved but log failed', logError.message);
      }

      await invalidateSessionRelatedQueries(queryClient, {
        sessionId: sessionRowId,
        athleteId: planMeta.athlete_id,
        scheduledDateIso: data.date,
      });

      try {
        const improvements = await syncPersonalBestsAfterSessionLogsChange(queryClient, planMeta.athlete_id);
        const top = pickCelebrationImprovement(improvements);
        if (top) usePersonalBestCelebrationStore.getState().show(top);
      } catch (e) {
        if (__DEV__) {
          console.warn('[personal_bests] sync after Rova log failed', e);
        }
      }

      const followUp = await persistMessage('assistant', 'Session logged ✓ Nice work!');
      setMessages((prev) => {
        const next = stripErrorRows(prev).map((row) =>
          row.id === assistantMessageId && row.role === 'assistant'
            ? { ...row, pendingLog: undefined }
            : row
        );
        return [
          ...next,
          {
            id: followUp.id,
            role: 'assistant' as const,
            message: 'Session logged ✓ Nice work!',
            createdAt: followUp.createdAt,
          },
        ];
      });
    } catch (e) {
      if (__DEV__) {
        console.warn('[Rova] confirm log failed', e);
      }
      Alert.alert('Could not log session', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      confirmLogInFlightRef.current = false;
      setConfirmingLogMessageId(null);
      scrollBottom();
    }
  };

  const onClear = () => {
    if (!athleteId || messages.length === 0) return;
    Alert.alert(
      'Clear conversation?',
      'This will clear your chat history with Rova. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('rova_conversations').delete().eq('athlete_id', athleteId);
            if (error) {
              if (!isMissingRovaConversationsTable(error.message)) {
                Alert.alert('Could not clear', error.message);
                return;
              }
            }
            setMessages([]);
          },
        },
      ]
    );
  };

  const onShortcut = async (kind: RovaShortcutKind) => {
    if (!athleteId || isLoading) return;
    try {
      setShortcutLoading(kind);
      const ctx = await buildRovaShortcutContext(athleteId, kind);
      setAttachmentPrefix(ctx);
      scrollBottom();
    } catch (e) {
      Alert.alert('Could not load shortcut', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setShortcutLoading(null);
    }
  };

  const showStarters = messages.length === 0 && !loadingHistory;
  const hasText = inputText.trim().length > 0;
  const bottomPad = Math.max(insets.bottom, 12) + 88;

  return (
    <View style={stylesThemed.safe}>
      <StatusAreaFade height={60} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
        <View style={stylesThemed.header}>
          <Text style={stylesThemed.headerTitle}>Rova</Text>
          {messages.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear conversation"
              onPress={onClear}
              hitSlop={12}
              style={stylesThemed.headerClearBtn}>
              <Ionicons name="refresh-outline" size={22} color={withAlpha(theme.text, 0.55)} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={scrollBottom}>
          {athleteLoading || loadingHistory ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : null}

          {!athleteId && !athleteLoading ? (
            <Text style={{ fontFamily: 'DMSans-Medium', color: theme.textMuted, textAlign: 'center', marginTop: 24 }}>
              Set up your athlete profile to chat with Rova.
            </Text>
          ) : null}

          {showStarters ? (
            <>
              <View style={styles.starterGrid}>
                {STARTERS.map((q) => (
                  <Pressable
                    key={q}
                    style={stylesThemed.suggestionPill}
                    onPress={() => void sendMessage(q)}
                    disabled={isLoading || !athleteId}>
                    <Text style={stylesThemed.suggestionText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.starterGrid, { marginTop: 8 }]}>
                {QUICK_LOG_PILLS.map((p) => (
                  <Pressable
                    key={p.label}
                    style={stylesThemed.suggestionPill}
                    onPress={() => void sendMessage(p.sendText)}
                    disabled={isLoading || !athleteId}>
                    <Text style={stylesThemed.suggestionText}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {messages.map((m) => {
            if (m.role === 'error') {
              return (
                <View key={m.id} style={{ marginBottom: 14, alignItems: 'flex-start' }}>
                  <View style={stylesThemed.bubbleError}>
                    <Text style={stylesThemed.bubbleErrorText}>{m.message}</Text>
                  </View>
                </View>
              );
            }
            const isUser = m.role === 'user';
            const pendingLog = !isUser ? m.pendingLog : undefined;
            const busyThisConfirm = confirmingLogMessageId === m.id;
            return (
              <View key={m.id} style={{ marginBottom: 14, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                <View style={isUser ? stylesThemed.bubbleUser : stylesThemed.bubbleAssist}>
                  <Text style={isUser ? stylesThemed.bubbleUserText : stylesThemed.bubbleAssistText}>{m.message}</Text>
                  {!isUser && m.source === 'template' ? (
                    <View style={stylesThemed.sourceTag}>
                      <Text style={stylesThemed.sourceTagText}>Rova</Text>
                    </View>
                  ) : null}
                  {!isUser && m.source === 'claude' ? (
                    <View style={stylesThemed.sourceSparkleWrap}>
                      <Ionicons name="sparkles" size={12} color={theme.accent} />
                    </View>
                  ) : null}
                </View>
                <Text style={[stylesThemed.ts, { alignSelf: isUser ? 'flex-end' : 'flex-start' }]}>{formatTimeLabel(m.createdAt)}</Text>
                {pendingLog ? (
                  <View style={stylesThemed.logPreviewCard}>
                    <Text style={stylesThemed.logPreviewTitle}>Session preview</Text>
                    <View style={stylesThemed.logPreviewRow}>
                      <Text style={stylesThemed.logPreviewLabel}>Sport</Text>
                      <Text style={stylesThemed.logPreviewValue}>{pendingLog.sport}</Text>
                    </View>
                    <View style={stylesThemed.logPreviewRow}>
                      <Text style={stylesThemed.logPreviewLabel}>Duration</Text>
                      <Text style={stylesThemed.logPreviewValue}>{formatPreviewDuration(pendingLog.durationMins)}</Text>
                    </View>
                    <View style={stylesThemed.logPreviewRow}>
                      <Text style={stylesThemed.logPreviewLabel}>Distance</Text>
                      <Text style={stylesThemed.logPreviewValue}>
                        {formatPreviewDistance(pendingLog.distance, pendingLog.distanceUnit)}
                      </Text>
                    </View>
                    <View style={stylesThemed.logPreviewRow}>
                      <Text style={stylesThemed.logPreviewLabel}>Intensity</Text>
                      <Text style={stylesThemed.logPreviewValue}>{pendingLog.intensity}</Text>
                    </View>
                    <View style={stylesThemed.logPreviewRow}>
                      <Text style={stylesThemed.logPreviewLabel}>RPE (est.)</Text>
                      <Text style={stylesThemed.logPreviewValue}>
                        {pendingLog.estimatedRPE != null ? String(pendingLog.estimatedRPE) : '—'}
                      </Text>
                    </View>
                    <View style={stylesThemed.logPreviewRow}>
                      <Text style={stylesThemed.logPreviewLabel}>Notes</Text>
                      <Text style={stylesThemed.logPreviewValue}>{pendingLog.notes?.trim() ? pendingLog.notes : '—'}</Text>
                    </View>
                    <View style={stylesThemed.logPreviewRow}>
                      <Text style={stylesThemed.logPreviewLabel}>Date</Text>
                      <Text style={stylesThemed.logPreviewValue}>{pendingLog.date}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Confirm and save session"
                      style={[
                        stylesThemed.confirmLogBtn,
                        confirmingLogMessageId !== null ? stylesThemed.confirmLogBtnDisabled : null,
                      ]}
                      disabled={confirmingLogMessageId !== null}
                      onPress={() => void confirmRovaSessionLog(m.id, pendingLog)}>
                      {busyThisConfirm ? (
                        <ActivityIndicator color={theme.onPrimary} />
                      ) : (
                        <Text style={stylesThemed.confirmLogBtnText}>Confirm & save</Text>
                      )}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}

          {isLoading ? (
            <View style={{ marginBottom: 14, alignItems: 'flex-start' }}>
              <View style={stylesThemed.bubbleAssist}>
                <TypingDots color={theme.text} />
              </View>
            </View>
          ) : null}
        </ScrollView>

        {attachmentPrefix ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
            <Text style={{ fontFamily: 'DMSans-Medium', fontSize: 12, color: theme.textMuted }}>
              Context ready — it will be sent with your next message.
            </Text>
            <Pressable onPress={() => setAttachmentPrefix(null)} style={{ marginTop: 4 }}>
              <Text style={{ fontFamily: 'DMSans-Medium', fontSize: 12, color: theme.accent, textDecorationLine: 'underline' }}>
                Remove attached context
              </Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingVertical: 2, alignItems: 'center' }}>
          {QUICK_LOG_PILLS.map((p) => (
            <Pressable
              key={p.label}
              style={stylesThemed.shortcutPill}
              disabled={!athleteId || isLoading || shortcutLoading !== null || confirmingLogMessageId !== null}
              onPress={() => void sendMessage(p.sendText)}>
              <Text style={stylesThemed.shortcutText}>{p.label}</Text>
            </Pressable>
          ))}
          {SHORTCUTS.map((s) => (
            <Pressable
              key={s.kind}
              style={stylesThemed.shortcutPill}
              disabled={!athleteId || isLoading || shortcutLoading !== null || confirmingLogMessageId !== null}
              onPress={() => void onShortcut(s.kind)}>
              {shortcutLoading === s.kind ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Text style={stylesThemed.shortcutText}>{s.label}</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>

        <View style={[stylesThemed.inputWrap, { paddingBottom: bottomPad }]}>
          <View style={{ flex: 1 }}>
            {isLoading ? (
              <Text style={[stylesThemed.thinkingCaption, { textAlign: 'left', paddingBottom: 6, backgroundColor: 'transparent' }]}>
                Rova is thinking…
              </Text>
            ) : null}
            <TextInput
              style={stylesThemed.input}
              placeholder="Ask Rova anything..."
              placeholderTextColor={withAlpha(theme.text, 0.38)}
              value={inputText}
              onChangeText={setInputText}
              editable={!isLoading && Boolean(athleteId)}
              multiline
              onSubmitEditing={() => void sendMessage(inputText)}
            />
          </View>
          <Pressable
            style={[
              stylesThemed.sendBtn,
              { backgroundColor: hasText && !isLoading ? theme.accent : withAlpha(theme.text, 0.12) },
            ]}
            disabled={!hasText || isLoading || !athleteId}
            onPress={() => void sendMessage(inputText)}>
            <Ionicons
              name="arrow-forward"
              size={22}
              color={hasText && !isLoading ? theme.onAccent : withAlpha(theme.text, 0.35)}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <FloatingPillNav active="rova" />
    </View>
  );
}

const styles = StyleSheet.create({
  starterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  typingRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 4 },
  typingDot: { width: 8, height: 8, borderRadius: 4 },
});

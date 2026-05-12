import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import type { AppTheme } from '@/contexts/ThemeContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useActiveAthlete } from '@/hooks/useSessionData';
import { withAlpha } from '@/lib/theme-utils';
import { supabase } from '@/lib/supabase';
import { assignTemplatePlan } from '@/services/assignTemplatePlan';
import {
  importSessions,
  parseTemplatePlan,
  templateImportExample,
  type ConflictResolution,
  type ParsedSession,
} from '@/services/importPlan';
import { AthleteLevel } from '@/store/onboarding-store';

const TEMPLATE_PLAN_DRAFT_KEY = '@telo/template_plan_draft_v1';

function showFeedback(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert(message);
  }
}

export default function TemplatePlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const { data: athlete } = useActiveAthlete();

  const [templateText, setTemplateText] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [parseIssues, setParseIssues] = useState<{ lineNumber: number; line: string; reason: string }[]>([]);
  const [previewSessions, setPreviewSessions] = useState<ParsedSession[]>([]);
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>('skip');
  const [conflictDates, setConflictDates] = useState<string[]>([]);
  const [loadingConflicts, setLoadingConflicts] = useState(false);
  const [importing, setImporting] = useState(false);
  const [reapplying, setReapplying] = useState(false);

  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(TEMPLATE_PLAN_DRAFT_KEY);
        if (!cancelled) {
          setTemplateText(stored ?? templateImportExample());
        }
      } catch {
        if (!cancelled) setTemplateText(templateImportExample());
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      void AsyncStorage.setItem(TEMPLATE_PLAN_DRAFT_KEY, templateText).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [templateText, hydrated]);

  const updateConflictDates = useCallback(async (sessions: ParsedSession[]) => {
    if (!athlete?.id || sessions.length === 0) {
      setConflictDates([]);
      return;
    }
    setLoadingConflicts(true);
    try {
      const dates = Array.from(new Set(sessions.map((s) => s.date)));
      const { data, error } = await supabase
        .from('sessions')
        .select('scheduled_date')
        .eq('athlete_id', athlete.id)
        .eq('status', 'planned')
        .in('scheduled_date', dates);
      if (error) throw new Error(error.message);
      setConflictDates(Array.from(new Set((data ?? []).map((row) => row.scheduled_date))));
    } catch {
      setConflictDates([]);
    } finally {
      setLoadingConflicts(false);
    }
  }, [athlete?.id]);

  const onParseTemplate = () => {
    const { sessions, issues } = parseTemplatePlan(templateText);
    setParseIssues(issues);
    setPreviewSessions(sessions);
    void updateConflictDates(sessions);
  };

  const conflictingPreviewDateCount = useMemo(() => {
    const busy = new Set(conflictDates);
    return new Set(previewSessions.filter((s) => busy.has(s.date)).map((s) => s.date)).size;
  }, [previewSessions, conflictDates]);

  const onApply = async () => {
    if (!athlete?.id) {
      Alert.alert('No athlete profile', 'Please complete onboarding first.');
      return;
    }
    if (!previewSessions.length) {
      Alert.alert('Nothing to apply', 'Tap “Parse plan” first and fix any errors.');
      return;
    }
    if (conflictResolution === 'replace' && conflictingPreviewDateCount > 0) {
      const ok = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Replace planned sessions?',
          `This will delete existing planned sessions on ${conflictingPreviewDateCount} date(s) that overlap your import, then add the new rows.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
          ]
        );
      });
      if (!ok) return;
    }
    setImporting(true);
    try {
      const result = await importSessions(athlete.id, previewSessions, conflictResolution);
      if (result.errors.length > 0) {
        Alert.alert('Imported with issues', result.errors.slice(0, 5).join('\n'));
      } else {
        showFeedback(`${result.imported} sessions applied`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
      ]);
      void updateConflictDates(previewSessions);
    } catch (error) {
      Alert.alert('Apply failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setImporting(false);
    }
  };

  const onReapplyBuiltIn = async () => {
    if (!athlete?.id) {
      Alert.alert('No athlete profile', 'Please complete onboarding first.');
      return;
    }
    setReapplying(true);
    try {
      const raceDate = athlete.goal_race_date ?? new Date(Date.now() + 12 * 7 * 86_400_000).toISOString().slice(0, 10);
      const raceName = athlete.goal_race_name?.trim() || 'Goal race';
      const { data: currentSessions, error } = await supabase
        .from('sessions')
        .select('scheduled_date')
        .eq('athlete_id', athlete.id)
        .eq('status', 'planned')
        .order('scheduled_date', { ascending: true })
        .limit(84);
      if (error) throw new Error(error.message);
      const daySet = new Set<string>();
      for (const row of currentSessions ?? []) {
        const day = new Date(`${row.scheduled_date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short' });
        daySet.add(day);
      }
      const trainingDays = daySet.size > 0 ? Array.from(daySet) : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      await assignTemplatePlan({
        athleteId: athlete.id,
        level: (athlete.level as AthleteLevel | undefined) ?? 'fara',
        raceDate,
        raceName,
        trainingDays,
        replaceFuturePlannedOnly: true,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
      ]);
      Alert.alert(
        'Plan updated',
        'Telo’s built-in template has been re-applied. Only future planned sessions were replaced; completed sessions were kept.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Could not update plan', message);
    } finally {
      setReapplying(false);
    }
  };

  const conflictPills: { key: ConflictResolution; label: string }[] = [
    { key: 'skip', label: 'Skip overlaps' },
    { key: 'replace', label: 'Replace day' },
    { key: 'alongside', label: 'Add alongside' },
  ];

  return (
    <SafeAreaView style={[styles.screen, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={theme.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>Template plan</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 28 + insets.bottom }]}
          showsVerticalScrollIndicator={false}>
          <Text style={styles.lead}>
            Edit your plan as pipe-separated rows, then parse and apply. Your draft is saved on this device.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>Format</Text>
            <Text style={styles.monoHint} selectable>
              {templateImportExample()}
            </Text>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                void Clipboard.setStringAsync(templateImportExample());
                showFeedback('Example copied');
              }}>
              <Text style={styles.secondaryBtnText}>Copy example</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>Plan text</Text>
          <View style={styles.textAreaWrap}>
            <View style={styles.textStrip} />
            <TextInput
              multiline
              value={templateText}
              onChangeText={setTemplateText}
              style={styles.textArea}
              placeholder={templateImportExample()}
              placeholderTextColor={withAlpha(theme.text, 0.35)}
              editable={hydrated}
            />
          </View>

          <View style={styles.rowGap}>
            <Pressable style={[styles.primaryBtn, !hydrated ? styles.btnDisabled : null]} disabled={!hydrated} onPress={onParseTemplate}>
              <Text style={styles.primaryBtnText}>Parse plan</Text>
            </Pressable>
            <Pressable
              style={styles.ghostBtn}
              onPress={() => {
                setTemplateText(templateImportExample());
                setParseIssues([]);
                setPreviewSessions([]);
                setConflictDates([]);
              }}>
              <Text style={styles.ghostBtnText}>Reset to example</Text>
            </Pressable>
          </View>

          {parseIssues.map((issue) => (
            <View key={`${issue.lineNumber}-${issue.reason}`} style={styles.issue}>
              <Text style={styles.issueText}>
                Line {issue.lineNumber}: {issue.reason}
              </Text>
            </View>
          ))}

          {previewSessions.length > 0 ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Preview</Text>
              <Text style={styles.summaryMeta}>
                {previewSessions.length} session{previewSessions.length === 1 ? '' : 's'}
                {loadingConflicts ? ' · checking overlaps…' : conflictingPreviewDateCount > 0 ? ` · ${conflictingPreviewDateCount} date(s) with planned sessions` : ' · no overlaps'}
              </Text>
              <Text style={styles.sectionLabelSmall}>If a date already has a planned session</Text>
              <View style={styles.pillRow}>
                {conflictPills.map((p) => {
                  const on = conflictResolution === p.key;
                  return (
                    <Pressable
                      key={p.key}
                      style={[styles.pill, on ? styles.pillOn : null]}
                      onPress={() => setConflictResolution(p.key)}>
                      <Text style={[styles.pillText, on ? styles.pillTextOn : null]}>{p.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                style={[styles.primaryBtn, styles.applyBtn, importing ? styles.btnDisabled : null]}
                disabled={importing}
                onPress={() => void onApply()}>
                {importing ? <ActivityIndicator color={theme.surface} /> : <Text style={styles.primaryBtnText}>Apply to calendar</Text>}
              </Pressable>
            </View>
          ) : null}

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>Built-in template</Text>
          <Text style={styles.leadSmall}>
            Regenerate sessions from your level and goal race using Telo’s structured template (replaces the active generated plan flow).
          </Text>
          <Pressable style={[styles.secondaryBtn, reapplying ? styles.btnDisabled : null]} disabled={reapplying} onPress={() => void onReapplyBuiltIn()}>
            {reapplying ? <ActivityIndicator color={theme.primary} /> : <Text style={styles.secondaryBtnText}>Re-apply Telo template</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <FloatingPillNav active="profile" />
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.base },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: withAlpha(theme.primary, 0.12),
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontFamily: 'CormorantGaramond_700Bold',
      fontSize: 22,
      color: theme.text,
    },
    headerSpacer: { width: 40 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 12 },
    lead: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 14,
      lineHeight: 20,
      color: theme.textMuted,
      marginBottom: 16,
    },
    leadSmall: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 13,
      lineHeight: 19,
      color: theme.textMuted,
      marginBottom: 12,
    },
    card: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.surface,
      padding: 12,
      marginBottom: 16,
    },
    cardLabel: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 11,
      letterSpacing: 0.6,
      color: theme.primary,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    monoHint: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      fontSize: 11,
      lineHeight: 16,
      color: theme.text,
    },
    sectionLabel: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 12,
      color: theme.text,
      marginBottom: 8,
    },
    sectionLabelSmall: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      color: theme.textMuted,
      marginTop: 10,
      marginBottom: 8,
    },
    textAreaWrap: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.15),
      backgroundColor: theme.surface,
      minHeight: 220,
      overflow: 'hidden',
      flexDirection: 'row',
    },
    textStrip: { width: 4, backgroundColor: theme.accent },
    textArea: {
      flex: 1,
      minHeight: 220,
      textAlignVertical: 'top',
      padding: 12,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      fontSize: 12,
      color: theme.text,
    },
    rowGap: { gap: 10, marginTop: 12 },
    primaryBtn: {
      height: 48,
      borderRadius: 999,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    applyBtn: { marginTop: 4 },
    primaryBtnText: { fontFamily: 'DMSans_600SemiBold', fontSize: 15, color: theme.surface },
    secondaryBtn: {
      marginTop: 10,
      alignSelf: 'flex-start',
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.35),
    },
    secondaryBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: theme.primary },
    ghostBtn: {
      alignItems: 'center',
      paddingVertical: 8,
    },
    ghostBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: theme.textMuted },
    btnDisabled: { opacity: 0.55 },
    issue: {
      marginTop: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: withAlpha('#c94040', 0.45),
      backgroundColor: withAlpha('#c94040', 0.1),
      padding: 10,
    },
    issueText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: theme.text },
    summaryCard: {
      marginTop: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.surface,
      padding: 14,
    },
    summaryTitle: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 22, color: theme.text },
    summaryMeta: { marginTop: 4, fontFamily: 'DMSans_400Regular', fontSize: 13, color: theme.textMuted },
    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.2),
      backgroundColor: theme.base,
    },
    pillOn: { backgroundColor: theme.primary, borderColor: theme.primary },
    pillText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: theme.text },
    pillTextOn: { color: theme.surface },
    divider: {
      marginVertical: 22,
      height: StyleSheet.hairlineWidth,
      backgroundColor: withAlpha(theme.primary, 0.12),
    },
  });
}

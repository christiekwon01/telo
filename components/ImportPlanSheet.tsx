import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { withAlpha } from '@/lib/theme-utils';
import { getSportIcon } from '@/components/sport-icon';
import {
  buildRepeatedSessions,
  deleteSessionById,
  importSessions,
  loadSessionForEdit,
  parseTemplatePlan,
  templateImportExample,
  type ConflictResolution,
  type ParsedSession,
  type SupportedIntensity,
  type SupportedSport,
  upsertManualSession,
} from '@/services/importPlan';

type Mode = 'template' | 'manual';

type Props = {
  visible: boolean;
  athleteId?: string | null;
  onClose: () => void;
  onImported?: (firstDate?: string) => void;
  initialMode?: Mode;
  editingSessionId?: string | null;
  initialDate?: string;
};

type EditableBlock = { key: string; blockType: string; title: string; expanded: boolean; steps: string[] };

const SPORTS: SupportedSport[] = ['swim', 'bike', 'run', 'brick', 'gym', 'rest'];
const INTENSITIES: SupportedIntensity[] = ['easy', 'steady', 'tempo', 'threshold', 'intervals'];

function toIsoDate(value: Date) {
  const y = value.getFullYear();
  const m = `${value.getMonth() + 1}`.padStart(2, '0');
  const d = `${value.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDistance(input: string) {
  const n = Number(input);
  return Number.isFinite(n) ? n : null;
}

function showFeedback(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert(message);
  }
}

function toShortPreview(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function weekdayName(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long' });
}

function weekStartMondayIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return toIsoDate(date);
}

export function ImportPlanSheet({
  visible,
  athleteId,
  onClose,
  onImported,
  initialMode = 'template',
  editingSessionId = null,
  initialDate,
}: Props) {
  const insets = useSafeAreaInsets();
  const sheetY = useRef(new Animated.Value(720)).current;
  const [mode, setMode] = useState<Mode>(initialMode);
  const [templateText, setTemplateText] = useState('');
  const [parseIssues, setParseIssues] = useState<{ lineNumber: number; line: string; reason: string }[]>([]);
  const [previewSessions, setPreviewSessions] = useState<ParsedSession[]>([]);
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>('skip');
  const [conflictDates, setConflictDates] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [loadingConflicts, setLoadingConflicts] = useState(false);

  const [manualDate, setManualDate] = useState(initialDate ?? toIsoDate(new Date(Date.now() + 86_400_000)));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sport, setSport] = useState<SupportedSport>('swim');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('45');
  const [durationUnit, setDurationUnit] = useState<'min' | 'hr'>('min');
  const [distance, setDistance] = useState('');
  const [distanceUnit, setDistanceUnit] = useState<'m' | 'km'>('m');
  const [intensity, setIntensity] = useState<SupportedIntensity>('steady');
  const [description, setDescription] = useState('');
  const [coachNote, setCoachNote] = useState('');
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatEveryDays, setRepeatEveryDays] = useState('7');
  const [repeatWeeks, setRepeatWeeks] = useState('8');
  const [manualBlocks, setManualBlocks] = useState<EditableBlock[]>([
    { key: 'warmup', blockType: 'warmup', title: 'Warm up', expanded: true, steps: [] },
    { key: 'main', blockType: 'main', title: 'Main set', expanded: true, steps: [''] },
    { key: 'cooldown', blockType: 'cooldown', title: 'Cool down', expanded: false, steps: [] },
  ]);
  const [expandedPreviewKeys, setExpandedPreviewKeys] = useState<Set<string>>(new Set());

  const updateConflictDates = useCallback(async (sessions: ParsedSession[]) => {
    if (!athleteId || sessions.length === 0) {
      setConflictDates([]);
      return;
    }
    setLoadingConflicts(true);
    try {
      const dates = Array.from(new Set(sessions.map((s) => s.date)));
      const { data, error } = await supabase
        .from('sessions')
        .select('scheduled_date')
        .eq('athlete_id', athleteId)
        .eq('status', 'planned')
        .in('scheduled_date', dates);
      if (error) throw new Error(error.message);
      setConflictDates(Array.from(new Set((data ?? []).map((row) => row.scheduled_date))));
    } catch {
      setConflictDates([]);
    } finally {
      setLoadingConflicts(false);
    }
  }, [athleteId]);

  useEffect(() => {
    if (!visible) return;
    Animated.spring(sheetY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
  }, [sheetY, visible]);

  /** Fresh sheet (not editing): reset preview and align manual date with Plan selection. */
  useEffect(() => {
    if (!visible || editingSessionId) return;
    setMode(initialMode);
    setParseIssues([]);
    setPreviewSessions([]);
    setConflictDates([]);
    setExpandedPreviewKeys(new Set());
    setManualDate(initialDate ?? toIsoDate(new Date(Date.now() + 86_400_000)));
  }, [visible, editingSessionId, initialMode, initialDate]);

  useEffect(() => {
    if (!visible || !editingSessionId) return;
    const run = async () => {
      setParseIssues([]);
      setPreviewSessions([]);
      setConflictDates([]);
      setExpandedPreviewKeys(new Set());
      const existing = await loadSessionForEdit(editingSessionId);
      if (!existing) return;
      setMode('manual');
      setManualDate(existing.date);
      setSport(existing.sport);
      setTitle(existing.title);
      setDuration(existing.durationMins != null ? String(existing.durationMins) : '');
      setDurationUnit('min');
      setDistance(existing.distance != null ? String(existing.distance) : '');
      setDistanceUnit(existing.distanceUnit === 'km' ? 'km' : 'm');
      setIntensity(existing.intensity);
      setDescription(existing.description ?? '');
      setCoachNote(existing.coachNote ?? '');
      setRepeatOn(false);
      setManualBlocks(
        existing.blocks.length
          ? existing.blocks.map((b, idx) => ({
              key: `${b.blockType}-${idx}`,
              blockType: b.blockType,
              title: b.title,
              expanded: true,
              steps: b.steps.length ? b.steps : [''],
            }))
          : [
              { key: 'warmup', blockType: 'warmup', title: 'Warm up', expanded: true, steps: [] },
              { key: 'main', blockType: 'main', title: 'Main set', expanded: true, steps: [''] },
              { key: 'cooldown', blockType: 'cooldown', title: 'Cool down', expanded: false, steps: [] },
            ]
      );
      setPreviewSessions([existing]);
      void updateConflictDates([existing]);
    };
    void run();
  }, [editingSessionId, visible, updateConflictDates]);

  const closeSheet = () => {
    Animated.timing(sheetY, { toValue: 720, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onClose();
    });
  };

  const canDistance = sport === 'swim' || sport === 'bike' || sport === 'run' || sport === 'brick';
  const resolvedDurationMins = useMemo(() => {
    const n = Number(duration);
    if (!Number.isFinite(n)) return null;
    return durationUnit === 'hr' ? Math.round(n * 60) : Math.round(n);
  }, [duration, durationUnit]);
  const repeatPreview = useMemo(() => {
    if (!repeatOn) return '';
    return `Creates ${Math.max(1, Math.floor((Number(repeatWeeks || '0') * 7) / Math.max(1, Number(repeatEveryDays || '7'))))} sessions on ${weekdayName(manualDate)}s`;
  }, [manualDate, repeatEveryDays, repeatOn, repeatWeeks]);

  const previewWeekCount = useMemo(() => {
    if (!previewSessions.length) return 0;
    const weekStarts = new Set(previewSessions.map((s) => weekStartMondayIso(s.date)));
    return weekStarts.size;
  }, [previewSessions]);

  const conflictingPreviewDateCount = useMemo(() => {
    const busy = new Set(conflictDates);
    const hit = new Set(previewSessions.filter((s) => busy.has(s.date)).map((s) => s.date));
    return hit.size;
  }, [previewSessions, conflictDates]);

  const applyParsedSessionToManual = (s: ParsedSession) => {
    setManualDate(s.date);
    setSport(s.sport);
    setTitle(s.title);
    setDuration(s.durationMins != null ? String(s.durationMins) : '');
    setDurationUnit('min');
    setDistance(s.distance != null ? String(s.distance) : '');
    setDistanceUnit(s.distanceUnit === 'km' ? 'km' : 'm');
    setIntensity(s.intensity);
    setDescription(s.description ?? '');
    setCoachNote(s.coachNote ?? '');
    setRepeatOn(false);
    setManualBlocks(
      s.blocks.length
        ? s.blocks.map((b, idx) => ({
            key: `from-preview-${idx}-${b.blockType}`,
            blockType: b.blockType,
            title: b.title || 'Block',
            expanded: true,
            steps: b.steps.length ? b.steps : [''],
          }))
        : [
            { key: 'warmup', blockType: 'warmup', title: 'Warm up', expanded: true, steps: [] },
            { key: 'main', blockType: 'main', title: 'Main set', expanded: true, steps: [''] },
            { key: 'cooldown', blockType: 'cooldown', title: 'Cool down', expanded: false, steps: [] },
          ]
    );
    setMode('manual');
    showFeedback('Loaded into Manual — adjust and tap Add session');
  };

  const togglePreviewExpanded = (key: string) => {
    setExpandedPreviewKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onParseTemplate = async () => {
    const { sessions, issues } = parseTemplatePlan(templateText);
    setParseIssues(issues);
    setPreviewSessions(sessions);
    await updateConflictDates(sessions);
  };

  const onBuildManualPreview = async () => {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a session title.');
      return;
    }
    if (!manualDate) {
      Alert.alert('Missing date', 'Please choose a date.');
      return;
    }
    const base: ParsedSession = {
      id: editingSessionId ?? undefined,
      date: manualDate,
      sport,
      title: title.trim(),
      durationMins: resolvedDurationMins,
      distance: canDistance ? parseDistance(distance) : null,
      distanceUnit: canDistance ? distanceUnit : null,
      intensity,
      description: description.trim() || null,
      coachNote: coachNote.trim() || null,
      blocks: manualBlocks.map((block) => ({
        blockType: block.blockType,
        title: block.title,
        steps: block.steps.map((step) => step.trim()).filter(Boolean),
      })),
      source: 'manual',
    };
    const sessions = repeatOn ? buildRepeatedSessions(base, Number(repeatEveryDays || '7'), Number(repeatWeeks || '8')) : [base];
    setPreviewSessions(sessions);
    setParseIssues([]);
    await updateConflictDates(sessions);
  };

  const doImport = async () => {
    if (!athleteId) {
      Alert.alert('No athlete profile', 'Please complete onboarding first.');
      return;
    }
    if (!previewSessions.length) {
      Alert.alert('No sessions', 'Please parse or build sessions first.');
      return;
    }
    setImporting(true);
    try {
      let imported = 0;
      const isSingleEdit = Boolean(mode === 'manual' && editingSessionId && previewSessions.length === 1);
      if (isSingleEdit && editingSessionId) {
        await upsertManualSession(athleteId, previewSessions[0], 'edit', editingSessionId);
        imported = 1;
      } else {
        const result = await importSessions(athleteId, previewSessions, conflictResolution);
        imported = result.imported;
        if (result.errors.length > 0) {
          Alert.alert('Imported with some issues', result.errors.slice(0, 4).join('\n'));
        }
      }
      showFeedback(isSingleEdit ? 'Session updated ✓' : `${imported} sessions imported ✓`);
      onImported?.(previewSessions[0]?.date);
      closeSheet();
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setImporting(false);
    }
  };

  const onDeleteEditingSession = async () => {
    if (!athleteId || !editingSessionId) return;
    Alert.alert('Delete session?', 'This will remove the session permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteSessionById(athleteId, editingSessionId);
            showFeedback('Session deleted');
            onImported?.();
            closeSheet();
          })();
        },
      },
    ]);
  };

  const removePreviewSession = (index: number) => {
    const next = previewSessions.filter((_, i) => i !== index);
    setPreviewSessions(next);
    void updateConflictDates(next);
  };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, justifyContent: 'flex-end' },
        overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
        sheet: {
          maxHeight: '95%',
          backgroundColor: '#F6F3EE',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 20,
          paddingTop: 10,
        },
        handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: 'rgba(15,40,64,0.2)' },
        close: { position: 'absolute', right: 12, top: 10, padding: 8, zIndex: 2 },
        title: { marginTop: 10, textAlign: 'center', fontFamily: 'CormorantGaramond_700Bold', fontSize: 28, color: '#0F2840' },
        subtitle: { textAlign: 'center', marginTop: 6, marginBottom: 12, fontFamily: 'DMSans_400Regular', fontSize: 13, color: 'rgba(15,40,64,0.5)' },
        tabRow: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(15,40,64,0.12)', padding: 4, backgroundColor: '#F6F3EE' },
        tab: { flex: 1, borderRadius: 9, height: 34, alignItems: 'center', justifyContent: 'center' },
        tabActive: { backgroundColor: '#0F2840' },
        tabText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: 'rgba(15,40,64,0.65)' },
        tabTextActive: { color: '#FFFFFF' },
        sectionCard: {
          marginTop: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(15,40,64,0.12)',
          backgroundColor: '#FFFFFF',
          padding: 10,
        },
        instructions: {
          borderLeftWidth: 4,
          borderLeftColor: '#C97E2F',
          borderRadius: 8,
          backgroundColor: '#FFFFFF',
          padding: 10,
          marginTop: 12,
        },
        instructionsText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(15,40,64,0.6)', lineHeight: 18 },
        textAreaWrap: { marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(15,40,64,0.15)', backgroundColor: '#F6F3EE', minHeight: 210, overflow: 'hidden', flexDirection: 'row' },
        textStrip: { width: 4, backgroundColor: '#C97E2F' },
        textArea: { flex: 1, minHeight: 210, textAlignVertical: 'top', padding: 10, fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }), fontSize: 12, color: '#0F2840' },
        copyBtn: { alignSelf: 'flex-end', marginTop: 8 },
        copyText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#C97E2F' },
        fullBtn: { marginTop: 10, height: 44, borderRadius: 999, backgroundColor: '#0F2840', alignItems: 'center', justifyContent: 'center' },
        fullBtnText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#FFFFFF' },
        label: { marginTop: 10, marginBottom: 6, fontFamily: 'DMSans_500Medium', fontSize: 10, letterSpacing: 0.7, color: '#C97E2F', textTransform: 'uppercase' },
        input: { height: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(15,40,64,0.15)', backgroundColor: '#F6F3EE', paddingHorizontal: 10, fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#0F2840' },
        row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        pill: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(15,40,64,0.2)', paddingHorizontal: 12, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F3EE' },
        pillSelected: { backgroundColor: '#0F2840', borderColor: '#0F2840' },
        pillText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#0F2840' },
        pillTextSelected: { color: '#FFFFFF' },
        blockHeading: { marginTop: 14, fontFamily: 'CormorantGaramond_700Bold', fontSize: 20, color: '#0F2840' },
        blockSub: { marginTop: 2, fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(15,40,64,0.5)' },
        blockCard: { marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(15,40,64,0.12)', backgroundColor: '#FFFFFF' },
        blockHead: { minHeight: 42, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        blockTitle: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#0F2840' },
        stepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 8 },
        stepInput: { flex: 1, minHeight: 38, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(15,40,64,0.12)', backgroundColor: '#F6F3EE', paddingHorizontal: 10, fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#0F2840' },
        link: { paddingHorizontal: 10, paddingBottom: 8 },
        linkText: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#C97E2F' },
        previewTitle: { marginTop: 16, fontFamily: 'CormorantGaramond_700Bold', fontSize: 24, color: '#0F2840' },
        previewSub: { marginTop: 2, fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(15,40,64,0.5)' },
        warnBanner: { marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: withAlpha('#C97E2F', 0.5), backgroundColor: withAlpha('#C97E2F', 0.12), padding: 10 },
        warnText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#0F2840' },
        previewCard: { marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(15,40,64,0.1)', backgroundColor: '#FFFFFF', padding: 10 },
        previewMeta: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#C97E2F' },
        previewHeader: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
        iconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#0F2840', alignItems: 'center', justifyContent: 'center' },
        previewTitleText: { flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#0F2840' },
        previewSmall: { marginTop: 2, fontFamily: 'DMSans_400Regular', fontSize: 12, color: 'rgba(15,40,64,0.45)' },
        previewExpand: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(15,40,64,0.08)' },
        previewBlockTitle: { fontFamily: 'DMSans_500Medium', fontSize: 12, color: '#0F2840', marginBottom: 4 },
        previewStep: { fontFamily: 'DMSans_400Regular', fontSize: 11, color: 'rgba(15,40,64,0.65)', marginBottom: 2 },
        issue: { marginTop: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(201,64,64,0.5)', backgroundColor: 'rgba(201,64,64,0.08)', padding: 8 },
        issueText: { fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#8A1F1F' },
      }),
    []
  );

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={closeSheet}>
      <View style={styles.root}>
        <Pressable style={styles.overlay} onPress={closeSheet} />
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: sheetY }], paddingBottom: Math.max(insets.bottom, 16) + 8 },
          ]}>
          <View style={styles.handle} />
          <Pressable style={styles.close} onPress={closeSheet}>
            <Ionicons name="close" size={18} color="#0F2840" />
          </Pressable>
          <Text style={styles.title}>{editingSessionId ? 'Edit session' : 'Import training plan'}</Text>
          <Text style={styles.subtitle}>Add sessions from an existing plan</Text>

          <View style={styles.tabRow}>
            <Pressable style={[styles.tab, mode === 'template' ? styles.tabActive : null]} onPress={() => setMode('template')}>
              <Text style={[styles.tabText, mode === 'template' ? styles.tabTextActive : null]}>Template</Text>
            </Pressable>
            <Pressable style={[styles.tab, mode === 'manual' ? styles.tabActive : null]} onPress={() => setMode('manual')}>
              <Text style={[styles.tabText, mode === 'manual' ? styles.tabTextActive : null]}>Manual</Text>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}>
            {mode === 'template' ? (
              <>
                <View style={styles.instructions}>
                  <Text style={styles.instructionsText}>
                    Paste your plan below using this format:{'\n\n'}
                    {templateImportExample()}
                    {'\n\n'}Supported sports: swim, bike, run, brick, gym, rest
                    {'\n'}Date format: YYYY-MM-DD or DD/MM/YYYY or DD Mon YYYY
                  </Text>
                </View>
                <Pressable
                  style={styles.copyBtn}
                  onPress={() => {
                    void Clipboard.setStringAsync(templateImportExample());
                    showFeedback('Format template copied');
                  }}>
                  <Text style={styles.copyText}>Copy format template</Text>
                </Pressable>
                <View style={styles.textAreaWrap}>
                  <View style={styles.textStrip} />
                  <TextInput
                    multiline
                    value={templateText}
                    onChangeText={setTemplateText}
                    style={styles.textArea}
                    placeholder={templateImportExample()}
                    placeholderTextColor="rgba(15,40,64,0.35)"
                  />
                </View>
                <Pressable style={styles.fullBtn} onPress={() => void onParseTemplate()}>
                  <Text style={styles.fullBtnText}>Parse plan</Text>
                </Pressable>
                {parseIssues.map((issue) => (
                  <View key={`${issue.lineNumber}-${issue.reason}`} style={styles.issue}>
                    <Text style={styles.issueText}>
                      Line {issue.lineNumber}: {issue.reason}
                    </Text>
                  </View>
                ))}
              </>
            ) : (
              <>
                <Text style={styles.label}>Date</Text>
                <Pressable style={styles.input} onPress={() => setShowDatePicker(true)}>
                  <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: '#0F2840' }}>{manualDate}</Text>
                </Pressable>
                {showDatePicker ? (
                  <DateTimePicker
                    value={new Date(`${manualDate}T00:00:00`)}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
                    onChange={(_event, date) => {
                      if (Platform.OS !== 'ios') setShowDatePicker(false);
                      if (date) setManualDate(toIsoDate(date));
                    }}
                  />
                ) : null}

                <Text style={styles.label}>Sport</Text>
                <View style={styles.pillRow}>
                  {SPORTS.map((item) => (
                    <Pressable key={item} style={[styles.pill, sport === item ? styles.pillSelected : null]} onPress={() => setSport(item)}>
                      <Text style={[styles.pillText, sport === item ? styles.pillTextSelected : null]}>{item[0].toUpperCase() + item.slice(1)}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Session title</Text>
                <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Threshold intervals" placeholderTextColor="rgba(15,40,64,0.35)" />

                <Text style={styles.label}>Duration</Text>
                <View style={styles.row}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={duration} keyboardType="decimal-pad" onChangeText={setDuration} />
                  <View style={styles.row}>
                    <Pressable style={[styles.pill, durationUnit === 'min' ? styles.pillSelected : null]} onPress={() => setDurationUnit('min')}>
                      <Text style={[styles.pillText, durationUnit === 'min' ? styles.pillTextSelected : null]}>min</Text>
                    </Pressable>
                    <Pressable style={[styles.pill, durationUnit === 'hr' ? styles.pillSelected : null]} onPress={() => setDurationUnit('hr')}>
                      <Text style={[styles.pillText, durationUnit === 'hr' ? styles.pillTextSelected : null]}>hr</Text>
                    </Pressable>
                  </View>
                </View>

                {canDistance ? (
                  <>
                    <Text style={styles.label}>Distance</Text>
                    <View style={styles.row}>
                      <TextInput style={[styles.input, { flex: 1 }]} value={distance} keyboardType="decimal-pad" onChangeText={setDistance} />
                      <View style={styles.row}>
                        <Pressable style={[styles.pill, distanceUnit === 'm' ? styles.pillSelected : null]} onPress={() => setDistanceUnit('m')}>
                          <Text style={[styles.pillText, distanceUnit === 'm' ? styles.pillTextSelected : null]}>m</Text>
                        </Pressable>
                        <Pressable style={[styles.pill, distanceUnit === 'km' ? styles.pillSelected : null]} onPress={() => setDistanceUnit('km')}>
                          <Text style={[styles.pillText, distanceUnit === 'km' ? styles.pillTextSelected : null]}>km</Text>
                        </Pressable>
                      </View>
                    </View>
                  </>
                ) : null}

                <Text style={styles.label}>Intensity</Text>
                <View style={styles.pillRow}>
                  {INTENSITIES.map((item) => (
                    <Pressable key={item} style={[styles.pill, intensity === item ? styles.pillSelected : null]} onPress={() => setIntensity(item)}>
                      <Text style={[styles.pillText, intensity === item ? styles.pillTextSelected : null]}>
                        {item[0].toUpperCase() + item.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>Description</Text>
                <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Brief overview of the session" placeholderTextColor="rgba(15,40,64,0.35)" />

                <Text style={styles.label}>Coach note</Text>
                <TextInput style={styles.input} value={coachNote} onChangeText={setCoachNote} placeholder="Why this session matters" placeholderTextColor="rgba(15,40,64,0.35)" />

                <Text style={styles.blockHeading}>Session blocks</Text>
                <Text style={styles.blockSub}>Add warmup, main set, and cooldown</Text>
                {manualBlocks.map((block, blockIdx) => (
                  <View key={block.key} style={styles.blockCard}>
                    <Pressable
                      style={styles.blockHead}
                      onPress={() =>
                        setManualBlocks((prev) =>
                          prev.map((item, idx) => (idx === blockIdx ? { ...item, expanded: !item.expanded } : item))
                        )
                      }>
                      <Text style={styles.blockTitle}>{block.title}</Text>
                      <Ionicons name={block.expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#0F2840" />
                    </Pressable>
                    {block.expanded
                      ? block.steps.map((step, stepIdx) => (
                          <View key={`${block.key}-step-${stepIdx}`} style={styles.stepRow}>
                            <Ionicons name="reorder-three" size={16} color={withAlpha('#0F2840', 0.45)} />
                            <TextInput
                              style={styles.stepInput}
                              value={step}
                              onChangeText={(value) =>
                                setManualBlocks((prev) => {
                                  const next = [...prev];
                                  next[blockIdx] = { ...next[blockIdx], steps: [...next[blockIdx].steps] };
                                  next[blockIdx].steps[stepIdx] = value;
                                  return next;
                                })
                              }
                              placeholder="Step instruction"
                              placeholderTextColor="rgba(15,40,64,0.35)"
                            />
                            <Pressable
                              onPress={() =>
                                setManualBlocks((prev) => {
                                  if (stepIdx === 0) return prev;
                                  const next = [...prev];
                                  next[blockIdx] = { ...next[blockIdx], steps: [...next[blockIdx].steps] };
                                  const tmp = next[blockIdx].steps[stepIdx - 1];
                                  next[blockIdx].steps[stepIdx - 1] = next[blockIdx].steps[stepIdx];
                                  next[blockIdx].steps[stepIdx] = tmp;
                                  return next;
                                })
                              }>
                              <Ionicons name="arrow-up" size={14} color="#0F2840" />
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                setManualBlocks((prev) => {
                                  const next = [...prev];
                                  if (stepIdx >= next[blockIdx].steps.length - 1) return prev;
                                  next[blockIdx] = { ...next[blockIdx], steps: [...next[blockIdx].steps] };
                                  const tmp = next[blockIdx].steps[stepIdx + 1];
                                  next[blockIdx].steps[stepIdx + 1] = next[blockIdx].steps[stepIdx];
                                  next[blockIdx].steps[stepIdx] = tmp;
                                  return next;
                                })
                              }>
                              <Ionicons name="arrow-down" size={14} color="#0F2840" />
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                setManualBlocks((prev) => {
                                  const next = [...prev];
                                  next[blockIdx] = {
                                    ...next[blockIdx],
                                    steps: next[blockIdx].steps.filter((_, idx) => idx !== stepIdx),
                                  };
                                  return next;
                                })
                              }>
                              <Ionicons name="close" size={16} color="#0F2840" />
                            </Pressable>
                          </View>
                        ))
                      : null}
                    {block.expanded ? (
                      <Pressable
                        style={styles.link}
                        onPress={() =>
                          setManualBlocks((prev) => {
                            const next = [...prev];
                            next[blockIdx] = { ...next[blockIdx], steps: [...next[blockIdx].steps, ''] };
                            return next;
                          })
                        }>
                        <Text style={styles.linkText}>Add step</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable
                  style={{ marginTop: 8 }}
                  onPress={() =>
                    setManualBlocks((prev) => [
                      ...prev,
                      { key: `custom-${Date.now()}`, blockType: 'main', title: `Custom block ${prev.length - 1}`, expanded: true, steps: [''] },
                    ])
                  }>
                  <Text style={styles.linkText}>Add custom block</Text>
                </Pressable>

                <Text style={[styles.label, { fontSize: 13, textTransform: 'none', letterSpacing: 0, marginTop: 14, marginBottom: 8, color: '#0F2840' }]}>
                  Repeat
                </Text>
                <Pressable style={styles.row} onPress={() => setRepeatOn((prev) => !prev)}>
                  <Ionicons name={repeatOn ? 'checkbox' : 'square-outline'} size={18} color={repeatOn ? '#C97E2F' : '#0F2840'} />
                  <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#0F2840' }}>Repeat this session</Text>
                </Pressable>
                {repeatOn ? (
                  <>
                    <View style={[styles.row, { marginTop: 8 }]}>
                      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#0F2840' }}>Repeat every</Text>
                      <TextInput style={[styles.input, { flex: 0, minWidth: 60 }]} value={repeatEveryDays} onChangeText={setRepeatEveryDays} keyboardType="number-pad" />
                      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#0F2840' }}>days</Text>
                    </View>
                    <View style={[styles.row, { marginTop: 8 }]}>
                      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#0F2840' }}>For</Text>
                      <TextInput style={[styles.input, { flex: 0, minWidth: 60 }]} value={repeatWeeks} onChangeText={setRepeatWeeks} keyboardType="number-pad" />
                      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: '#0F2840' }}>weeks</Text>
                    </View>
                    <Text style={styles.previewSmall}>{repeatPreview}</Text>
                  </>
                ) : null}

                <Pressable style={styles.fullBtn} onPress={() => void onBuildManualPreview()}>
                  <Text style={styles.fullBtnText}>{editingSessionId ? 'Preview changes' : 'Add session'}</Text>
                </Pressable>
              </>
            )}

            {previewSessions.length ? (
              <>
                <Text style={styles.previewTitle}>Ready to import</Text>
                <Text style={styles.previewSub}>
                  {previewSessions.length} sessions across {Math.max(1, previewWeekCount)} week{previewWeekCount === 1 ? '' : 's'}
                </Text>
                {conflictingPreviewDateCount > 0 ? (
                  <View style={styles.warnBanner}>
                    <Text style={styles.warnText}>
                      {loadingConflicts
                        ? 'Checking conflicts...'
                        : `${conflictingPreviewDateCount} date${conflictingPreviewDateCount === 1 ? '' : 's'} already have sessions.`}
                    </Text>
                    <View style={[styles.pillRow, { marginTop: 8 }]}>
                      {(['replace', 'alongside', 'skip'] as const).map((item) => (
                        <Pressable key={item} style={[styles.pill, conflictResolution === item ? styles.pillSelected : null]} onPress={() => setConflictResolution(item)}>
                          <Text style={[styles.pillText, conflictResolution === item ? styles.pillTextSelected : null]}>
                            {item === 'replace' ? 'Replace existing' : item === 'alongside' ? 'Add alongside' : 'Skip conflicts'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
                {previewSessions.map((session, index) => {
                  const pkey = `pv-${index}`;
                  const expanded = expandedPreviewKeys.has(pkey);
                  return (
                    <View key={pkey} style={styles.previewCard}>
                      <Pressable onPress={() => togglePreviewExpanded(pkey)}>
                        <Text style={styles.previewMeta}>{toShortPreview(session.date)}</Text>
                        <View style={styles.previewHeader}>
                          <View style={styles.iconWrap}>{getSportIcon(session.sport, 14, '#F6F3EE')}</View>
                          <Text style={styles.previewTitleText}>{session.title}</Text>
                        </View>
                        <Text style={styles.previewSmall}>
                          {(session.durationMins ?? 0) > 0 ? `${session.durationMins} min` : 'Rest'} · {session.intensity}
                        </Text>
                      </Pressable>
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 6 }}>
                        <Pressable hitSlop={8} onPress={() => applyParsedSessionToManual(session)}>
                          <Ionicons name="pencil" size={16} color="#0F2840" />
                        </Pressable>
                        <Pressable hitSlop={8} onPress={() => removePreviewSession(index)}>
                          <Ionicons name="close" size={16} color="#0F2840" />
                        </Pressable>
                      </View>
                      {expanded ? (
                        <View style={styles.previewExpand}>
                          {session.blocks.map((block, bi) => (
                            <View key={`${pkey}-b-${bi}`} style={{ marginBottom: 8 }}>
                              <Text style={styles.previewBlockTitle}>{block.title}</Text>
                              {block.steps.map((step, si) => (
                                <Text key={`${pkey}-s-${bi}-${si}`} style={styles.previewStep}>
                                  • {step}
                                </Text>
                              ))}
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                <Pressable style={styles.fullBtn} disabled={importing} onPress={() => void doImport()}>
                  <Text style={styles.fullBtnText}>
                    {importing
                      ? editingSessionId && previewSessions.length === 1
                        ? 'Saving...'
                        : 'Importing...'
                      : editingSessionId && previewSessions.length === 1
                        ? 'Save changes'
                        : `Import ${previewSessions.length} sessions`}
                  </Text>
                </Pressable>
                <Pressable style={{ marginTop: 10 }} onPress={closeSheet}>
                  <Text style={{ textAlign: 'center', fontFamily: 'DMSans_500Medium', fontSize: 13, color: 'rgba(15,40,64,0.55)' }}>
                    Cancel import
                  </Text>
                </Pressable>
              </>
            ) : null}

            {editingSessionId ? (
              <Pressable style={{ marginTop: 12, alignSelf: 'center' }} onPress={() => void onDeleteEditingSession()}>
                <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 13, color: '#8A1F1F' }}>Delete session</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}


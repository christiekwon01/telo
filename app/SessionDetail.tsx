import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { ImportPlanSheet } from '@/components/ImportPlanSheet';
import { SkeletonBlock } from '@/components/loading-ui';
import { getSportIcon } from '@/components/sport-icon';
import { useTheme } from '@/contexts/ThemeContext';
import {
  invalidateSessionRelatedQueries,
  useCompleteSession,
  useSessionDetail,
  useToggleSessionStepChecked,
  useUncompleteSession,
} from '@/hooks/useSessionData';
import { syncPersonalBestsAfterSessionLogsChange } from '@/services/personalBests';
import { supabase } from '@/lib/supabase';
import { withAlpha } from '@/lib/theme-utils';
import { useSessionStore } from '@/store/session-store';

const PICKER_MEDIA_TYPES: ImagePicker.MediaType[] = ['images', 'videos'];

function sanitizeDecimalInput(value: string) {
  const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDecimalIndex = normalized.indexOf('.');
  if (firstDecimalIndex === -1) return normalized;
  return (
    normalized.slice(0, firstDecimalIndex + 1) +
    normalized.slice(firstDecimalIndex + 1).replace(/\./g, '')
  );
}

function openWebMediaPicker(onPicked: (uris: string[]) => void) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  input.multiple = true;
  input.onchange = () => {
    const files = input.files ? Array.from(input.files) : [];
    if (files.length === 0) return;
    onPicked(files.map((file) => URL.createObjectURL(file)));
  };
  input.click();
}

type SessionDraftValues = {
  notes: string;
  duration: string;
  durationUnit: 'min' | 'hr';
  distance: string;
  distanceUnit: 'm' | 'km';
  avgHr: string;
  rpe: number | null;
};

function areDraftValuesEqual(a: SessionDraftValues, b: SessionDraftValues) {
  return (
    a.notes === b.notes &&
    a.duration === b.duration &&
    a.durationUnit === b.durationUnit &&
    a.distance === b.distance &&
    a.distanceUnit === b.distanceUnit &&
    a.avgHr === b.avgHr &&
    a.rpe === b.rpe
  );
}

export default function SessionDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = params.sessionId;
  const { data: session, isLoading, error } = useSessionDetail(sessionId);
  const completeSessionMutation = useCompleteSession();
  const uncompleteSessionMutation = useUncompleteSession();
  const toggleStepMutation = useToggleSessionStepChecked();
  const resolvedSessionId = sessionId ?? 'missing-session-id';
  const savedDraft = useSessionStore((state) => state.sessionDrafts[resolvedSessionId]);
  const saveSessionDraft = useSessionStore((state) => state.saveSessionDraft);
  const clearSessionDraft = useSessionStore((state) => state.clearSessionDraft);
  const [checkedSteps, setCheckedSteps] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState(savedDraft?.notes ?? '');
  const [duration, setDuration] = useState(savedDraft?.duration ?? '');
  const [durationUnit, setDurationUnit] = useState<'min' | 'hr'>(savedDraft?.durationUnit ?? 'min');
  const [distance, setDistance] = useState(savedDraft?.distance ?? '');
  const [distanceUnit, setDistanceUnit] = useState<'m' | 'km'>(savedDraft?.distanceUnit ?? 'km');
  const [avgHr, setAvgHr] = useState(savedDraft?.avgHr ?? '');
  const [rpe, setRpe] = useState<number | null>(savedDraft?.rpe ?? null);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);
  const [mediaUris, setMediaUris] = useState<string[]>([]);
  const completeSession = useSessionStore((state) => state.completeSession);
  const { theme } = useTheme();
  const hydratedSessionIdRef = useRef<string | null>(null);

  const draftValues = useMemo<SessionDraftValues>(
    () => ({
      notes,
      duration,
      durationUnit,
      distance,
      distanceUnit,
      avgHr,
      rpe,
    }),
    [notes, duration, durationUnit, distance, distanceUnit, avgHr, rpe]
  );

  useEffect(() => {
    if (!session) return;
    const initialChecked: Record<string, boolean> = {};
    for (const block of session.session_blocks ?? []) {
      for (const step of block.session_steps ?? []) {
        initialChecked[step.id] = Boolean(step.is_checked);
      }
    }
    setCheckedSteps(initialChecked);
  }, [session]);

  const toggleStep = async (stepId: string) => {
    const nextValue = !checkedSteps[stepId];
    setCheckedSteps((prev) => ({ ...prev, [stepId]: nextValue }));
    try {
      await toggleStepMutation.mutateAsync({ stepId, isChecked: nextValue });
    } catch {
      setCheckedSteps((prev) => ({ ...prev, [stepId]: !nextValue }));
      Alert.alert('Could not update', 'Unable to save that step right now.');
    }
  };

  useEffect(() => {
    if (hydratedSessionIdRef.current === resolvedSessionId) return;
    hydratedSessionIdRef.current = resolvedSessionId;

    setNotes(savedDraft?.notes ?? '');
    setDuration(savedDraft?.duration ?? '');
    setDurationUnit(savedDraft?.durationUnit ?? 'min');
    setDistance(savedDraft?.distance ?? '');
    setDistanceUnit(savedDraft?.distanceUnit ?? 'km');
    setAvgHr(savedDraft?.avgHr ?? '');
    setRpe(savedDraft?.rpe ?? null);
    setMediaUris([]);
  }, [resolvedSessionId, savedDraft]);

  const sessionCompletionStatus = session?.completionStatus;
  const completedLog = session?.session_logs?.[0];
  const sessionDistanceUnit = (session?.distance_unit as 'm' | 'km' | undefined) || 'km';

  /** After draft sync so stale zustand draft cannot overwrite log metrics from Supabase. */
  useEffect(() => {
    if (sessionCompletionStatus !== 'completed' || !completedLog) return;
    const log = completedLog;
    setNotes(log.notes ?? '');
    if (log.actual_duration_mins != null) {
      setDuration(String(log.actual_duration_mins));
      setDurationUnit('min');
    } else {
      setDuration('');
      setDurationUnit('min');
    }
    if (log.actual_distance != null) {
      setDistance(String(log.actual_distance));
      setDistanceUnit(sessionDistanceUnit);
    } else {
      setDistance('');
      setDistanceUnit(sessionDistanceUnit);
    }
    setAvgHr(log.avg_heart_rate != null ? String(log.avg_heart_rate) : '');
    setRpe(log.rpe ?? null);
    const uris = log.media_uris;
    setMediaUris(Array.isArray(uris) ? uris.filter((u): u is string => typeof u === 'string') : []);
  }, [session?.id, sessionCompletionStatus, completedLog, sessionDistanceUnit]);

  useEffect(() => {
    if (session?.completionStatus === 'completed') return;
    const existingDraft: SessionDraftValues = {
      notes: savedDraft?.notes ?? '',
      duration: savedDraft?.duration ?? '',
      durationUnit: savedDraft?.durationUnit ?? 'min',
      distance: savedDraft?.distance ?? '',
      distanceUnit: savedDraft?.distanceUnit ?? 'km',
      avgHr: savedDraft?.avgHr ?? '',
      rpe: savedDraft?.rpe ?? null,
    };
    if (areDraftValuesEqual(existingDraft, draftValues)) return;
    saveSessionDraft({
      sessionId: resolvedSessionId,
      ...draftValues,
    });
  }, [resolvedSessionId, draftValues, savedDraft, saveSessionDraft, session?.completionStatus]);

  const themed = useMemo(
    () => ({
      screen: { backgroundColor: theme.base },
      card: { backgroundColor: theme.surface, borderColor: withAlpha(theme.primary, 0.1) },
      primarySurface: { backgroundColor: theme.primary },
      accent: { color: theme.accent },
      accentBg: { backgroundColor: theme.accent },
      text: { color: theme.text },
      mutedText: { color: theme.textMuted },
      onPrimary: { color: theme.onPrimary },
      inputSurface: { borderColor: withAlpha(theme.primary, 0.15), backgroundColor: theme.base },
      subtleBorder: { borderColor: withAlpha(theme.primary, 0.2) },
      overlayIcon: { color: theme.primary },
      doneButton: { backgroundColor: theme.accent },
      coachTipBg: { backgroundColor: theme.base, borderColor: withAlpha(theme.primary, 0.08) },
      coachTipText: { color: withAlpha(theme.text, 0.78) },
    }),
    [theme]
  );

  const handleComplete = async () => {
    if (!sessionId || !session) return;
    if (session.completionStatus === 'completed') return;

    const completionTime = new Date().toISOString();
    const durationMins =
      duration && durationUnit === 'hr' ? Number(duration) * 60 : duration ? Number(duration) : undefined;
    const distanceValue = distance ? Number(distance) : undefined;
    const avgHeartRate = avgHr ? Number(avgHr) : undefined;

    try {
      await completeSessionMutation.mutateAsync({
        sessionId,
        athleteId: session.athlete_id,
        scheduledDateIso: session.scheduled_date,
        notes: notes.trim() ? notes.trim() : undefined,
        mediaUris: mediaUris.length ? mediaUris : undefined,
        actualDurationMins: durationMins,
        actualDistance: distanceValue,
        avgHeartRate,
        rpe: rpe ?? null,
      });
    } catch (error) {
      Alert.alert(
        'Could not save',
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to mark this session as complete right now.'
      );
      return;
    }

    completeSession({
      sessionId,
      status: 'completed',
      completedAt: completionTime,
      notes: notes.trim() ? notes.trim() : undefined,
      metrics: {
        durationMins,
        durationUnit,
        distance: distanceValue,
        distanceUnit,
        avgHeartRate,
        rpe: rpe ?? undefined,
      },
      mediaUris: mediaUris.length ? mediaUris : undefined,
    });
    clearSessionDraft(sessionId);
  };

  const handleUncomplete = async () => {
    if (!sessionId || !session) return;
    try {
      await uncompleteSessionMutation.mutateAsync({
        sessionId,
        athleteId: session.athlete_id,
        scheduledDateIso: session.scheduled_date,
      });
      clearSessionDraft(sessionId);
      setNotes('');
      setDuration('');
      setDurationUnit('min');
      setDistance('');
      setDistanceUnit('km');
      setAvgHr('');
      setRpe(null);
      setMediaUris([]);
    } catch (error) {
      Alert.alert(
        'Could not update',
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Unable to mark this session as incomplete right now.'
      );
    }
  };

  const completionBusy = completeSessionMutation.isPending || uncompleteSessionMutation.isPending;
  const [isSavingLog, setIsSavingLog] = useState(false);
  const isComplete = session ? session.completionStatus === 'completed' : false;

  const onCompletionPress = () => {
    if (completionBusy || !session) return;
    if (isComplete) {
      Alert.alert('Mark incomplete?', 'This removes the saved completion log for this session.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark incomplete', style: 'destructive', onPress: () => void handleUncomplete() },
      ]);
      return;
    }
    void handleComplete();
  };

  const handleSaveAll = async () => {
    if (!sessionId || !session) return;
    if (!isComplete || !completedLog?.id) {
      Alert.alert('Complete session first', 'Save is available after the session is marked completed.');
      return;
    }
    if (isSavingLog) return;

    const durationMins =
      duration && durationUnit === 'hr' ? Number(duration) * 60 : duration ? Number(duration) : null;
    const distanceValue = distance ? Number(distance) : null;
    const avgHeartRate = avgHr ? Number(avgHr) : null;

    if (duration && (durationMins == null || Number.isNaN(durationMins))) {
      Alert.alert('Check duration', 'Please enter a valid duration value.');
      return;
    }
    if (distance && (distanceValue == null || Number.isNaN(distanceValue))) {
      Alert.alert('Check distance', 'Please enter a valid distance value.');
      return;
    }
    if (avgHr && (avgHeartRate == null || Number.isNaN(avgHeartRate))) {
      Alert.alert('Check heart rate', 'Please enter a valid avg heart rate.');
      return;
    }

    setIsSavingLog(true);
    try {
      const { error: saveError } = await supabase
        .from('session_logs')
        .update({
          notes: notes.trim() ? notes.trim() : null,
          media_uris: mediaUris.length ? mediaUris : null,
          actual_duration_mins: durationMins,
          actual_distance: distanceValue,
          avg_heart_rate: avgHeartRate,
          rpe: rpe ?? null,
        })
        .eq('id', completedLog.id);

      if (saveError) {
        Alert.alert('Could not save', saveError.message);
        return;
      }

      await invalidateSessionRelatedQueries(queryClient, {
        sessionId,
        athleteId: session.athlete_id,
        scheduledDateIso: session.scheduled_date,
      });
      try {
        await syncPersonalBestsAfterSessionLogsChange(queryClient, session.athlete_id);
      } catch (e) {
        if (__DEV__) {
          console.warn('[personal_bests] sync after session save failed', e);
        }
      }
      clearSessionDraft(sessionId);
      Alert.alert('Saved', 'Session notes and metrics updated.');
    } finally {
      setIsSavingLog(false);
    }
  };

  const pickFromLibrary = async () => {
    if (Platform.OS === 'web') {
      openWebMediaPicker((uris) => setMediaUris((prev) => [...prev, ...uris]));
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow photo library access to add media.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: PICKER_MEDIA_TYPES,
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      setMediaUris((prev) => [...prev, ...result.assets.map((asset) => asset.uri)]);
    }
  };

  const pickFromCamera = async () => {
    if (Platform.OS === 'web') {
      openWebMediaPicker((uris) => setMediaUris((prev) => [...prev, ...uris]));
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow camera access to capture media.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: PICKER_MEDIA_TYPES,
      quality: 0.8,
    });
    if (!result.canceled) {
      setMediaUris((prev) => [...prev, ...result.assets.map((asset) => asset.uri)]);
    }
  };

  const onAddMedia = () => {
    if (Platform.OS === 'web') {
      void pickFromLibrary();
      return;
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo/Video', 'Choose from Library'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            void pickFromCamera();
          }
          if (buttonIndex === 2) {
            void pickFromLibrary();
          }
        }
      );
      return;
    }

    Alert.alert('Add media', 'Choose source', [
      { text: 'Camera', onPress: () => void pickFromCamera() },
      { text: 'Library', onPress: () => void pickFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (!sessionId) {
    return (
      <SafeAreaView style={[styles.screen, themed.screen]}>
        <View style={styles.centerState}>
          <Text style={[styles.centerStateText, themed.text]}>Missing session</Text>
          <Text style={[styles.centerStateSubtext, themed.mutedText]}>
            Open a session from Today or Plan to view details.
          </Text>
          <TouchableOpacity style={[styles.backButton, themed.primarySurface]} onPress={() => router.back()}>
            <Text style={[styles.backButtonText, themed.onPrimary]}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.screen, themed.screen]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="arrow-back" size={22} color={theme.primary} />
          </TouchableOpacity>
        </View>
        <View style={styles.scrollContent}>
          <SkeletonBlock style={styles.heroSkeleton} />
          <SkeletonBlock style={styles.blockSkeleton} />
          <SkeletonBlock style={styles.blockSkeleton} />
          <SkeletonBlock style={styles.buttonSkeleton} />
          <SkeletonBlock style={styles.blockSkeleton} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !session) {
    return (
      <SafeAreaView style={[styles.screen, themed.screen]}>
        <View style={styles.centerState}>
          <Text style={[styles.centerStateText, themed.text]}>Session not found</Text>
          <TouchableOpacity style={[styles.backButton, themed.primarySurface]} onPress={() => router.back()}>
            <Text style={[styles.backButtonText, themed.onPrimary]}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const sessionDetails = [
    session.duration_mins != null ? `${session.duration_mins} min` : null,
    session.distance != null ? `${session.distance}${session.distance_unit ?? ''}` : null,
    session.intensity ?? null,
  ].filter(Boolean) as string[];

  return (
    <SafeAreaView style={[styles.screen, themed.screen]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={theme.primary} />
        </TouchableOpacity>
        <View style={styles.sportLabelWrap}>
          {getSportIcon(session.sport, 14, theme.accent)}
          <Text style={[styles.sportLabel, themed.accent]}>{session.sport.toUpperCase()}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity hitSlop={10} style={styles.editToggleButton} onPress={() => setIsImportSheetOpen(true)}>
            <Ionicons name="ellipsis-horizontal" size={18} color={theme.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, Platform.OS === 'web' ? styles.webContent : null]} showsVerticalScrollIndicator={false}>
        <View style={[styles.heroCard, themed.primarySurface]}>
          <Text style={[styles.heroTitle, themed.onPrimary]}>{session.title}</Text>
          <Text style={[styles.heroMeta, { color: withAlpha(theme.onPrimary, 0.6) }]}>{sessionDetails.join(' · ')}</Text>
          <Pressable
            style={[styles.dateStampChip, { borderColor: withAlpha(theme.onPrimary, 0.35), backgroundColor: withAlpha(theme.onPrimary, 0.1) }]}
            onPress={() => setIsImportSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit session date">
            <Ionicons name="calendar-outline" size={13} color={theme.onPrimary} />
            <Text style={[styles.dateStampText, { color: theme.onPrimary }]}>
              {new Date(`${session.scheduled_date}T00:00:00`).toLocaleDateString('en-AU', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
            <Ionicons name="pencil-outline" size={12} color={theme.onPrimary} />
          </Pressable>
          <View style={[styles.heroAccentLine, themed.accentBg]} />
        </View>

        {(
          (session.session_blocks ?? []) as {
            id: string;
            title: string;
            session_steps: { id: string; step_text: string }[];
          }[]
        ).map((block) => (
          <View key={block.id} style={[styles.blockCard, themed.card]}>
            <View style={styles.blockHeaderRow}>
              <Text style={[styles.blockTitle, themed.text]}>{block.title}</Text>
            </View>
            {block.session_steps.map((step: { id: string; step_text: string }) => {
              const checked = !!checkedSteps[step.id];

              return (
                <View key={step.id} style={styles.stepRow}>
                  <Pressable
                    onPress={() => toggleStep(step.id)}
                    style={styles.stepPressable}>
                    <View style={[styles.stepCircle, themed.subtleBorder, { borderColor: theme.accent }, checked ? [styles.stepCircleChecked, themed.accentBg] : null]}>
                      {checked ? <Ionicons name="checkmark" size={10} color={theme.onAccent} /> : null}
                    </View>
                    <Text style={[styles.stepText, themed.text, checked ? [styles.stepTextChecked, themed.mutedText] : null]}>{step.step_text}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}

        <View style={[styles.coachTipCard, themed.coachTipBg]}>
          <View style={[styles.coachTipBorder, themed.accentBg]} />
          <View style={styles.coachTipContent}>
            <Text style={[styles.coachTipLabel, themed.accent]}>COACH TIP</Text>
            <Text style={[styles.coachTipText, themed.coachTipText]}>{session.coach_note ?? 'No coach note for this session.'}</Text>
          </View>
        </View>

        <TouchableOpacity
          key={isComplete ? 'session-complete-logged' : 'session-complete-pending'}
          activeOpacity={0.9}
          disabled={completionBusy}
          onPress={onCompletionPress}
          style={[
            styles.completeButton,
            themed.primarySurface,
            isComplete ? [styles.completeButtonDone, themed.doneButton] : null,
            completionBusy ? { opacity: 0.65 } : null,
          ]}>
          <Text style={[styles.completeButtonText, themed.onPrimary]}>
            {completionBusy ? 'Saving…' : isComplete ? 'Completed' : 'Complete session'}
          </Text>
        </TouchableOpacity>

        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionHeading, themed.text]}>Notes</Text>
          <View style={[styles.sectionUnderline, themed.accentBg]} />
          <View style={[styles.notesInputWrap, themed.inputSurface]}>
            <View style={[styles.notesAccent, themed.accentBg]} />
            <TextInput
              style={[styles.notesInput, themed.text]}
              multiline
              textAlignVertical="top"
              placeholder="How did this feel? Any observations..."
              placeholderTextColor={withAlpha(theme.primary, 0.4)}
              value={notes}
              onChangeText={setNotes}
            />
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionHeading, themed.text]}>Metrics</Text>
          <View style={[styles.sectionUnderline, themed.accentBg]} />

          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, themed.accent]}>ACTUAL DURATION</Text>
            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.fieldInput, themed.inputSurface, themed.text, styles.fieldInputGrow]}
                keyboardType="decimal-pad"
                value={duration}
                onChangeText={(value) => setDuration(sanitizeDecimalInput(value))}
              />
              <View style={[styles.unitPill, themed.inputSurface]}>
                <Pressable
                  style={[styles.unitOption, durationUnit === 'min' ? [styles.unitOptionActive, themed.primarySurface] : null]}
                  onPress={() => setDurationUnit('min')}>
                  <Text style={[styles.unitOptionText, themed.text, durationUnit === 'min' ? [styles.unitOptionTextActive, themed.onPrimary] : null]}>
                    min
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.unitOption, durationUnit === 'hr' ? [styles.unitOptionActive, themed.primarySurface] : null]}
                  onPress={() => setDurationUnit('hr')}>
                  <Text style={[styles.unitOptionText, themed.text, durationUnit === 'hr' ? [styles.unitOptionTextActive, themed.onPrimary] : null]}>
                    hr
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, themed.accent]}>DISTANCE</Text>
            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.fieldInput, themed.inputSurface, themed.text, styles.fieldInputGrow]}
                keyboardType="decimal-pad"
                value={distance}
                onChangeText={(value) => setDistance(sanitizeDecimalInput(value))}
              />
              <View style={[styles.unitPill, themed.inputSurface]}>
                <Pressable
                  style={[styles.unitOption, distanceUnit === 'km' ? [styles.unitOptionActive, themed.primarySurface] : null]}
                  onPress={() => setDistanceUnit('km')}>
                  <Text style={[styles.unitOptionText, themed.text, distanceUnit === 'km' ? [styles.unitOptionTextActive, themed.onPrimary] : null]}>
                    km
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.unitOption, distanceUnit === 'm' ? [styles.unitOptionActive, themed.primarySurface] : null]}
                  onPress={() => setDistanceUnit('m')}>
                  <Text style={[styles.unitOptionText, themed.text, distanceUnit === 'm' ? [styles.unitOptionTextActive, themed.onPrimary] : null]}>
                    m
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, themed.accent]}>AVG HEART RATE</Text>
            <View style={styles.fieldRow}>
              <TextInput
                style={[styles.fieldInput, themed.inputSurface, themed.text, styles.fieldInputGrow]}
                keyboardType="number-pad"
                value={avgHr}
                onChangeText={setAvgHr}
              />
              <View style={[styles.singleUnit, themed.inputSurface]}>
                <Text style={[styles.singleUnitText, themed.text]}>bpm</Text>
              </View>
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={[styles.fieldLabel, themed.accent]}>RPE / EFFORT RATING 1-10</Text>
            <View style={styles.rpeRow}>
              {Array.from({ length: 10 }, (_, idx) => idx + 1).map((value) => (
                <Pressable key={value} onPress={() => setRpe(value)} style={styles.rpePressable}>
                  <View style={[styles.rpeDot, { borderColor: theme.primary }, rpe !== null && value <= rpe ? [styles.rpeDotActive, themed.accentBg, { borderColor: theme.accent }] : null]} />
                </Pressable>
              ))}
            </View>
          </View>

        </View>

        <View style={styles.sectionBlock}>
          <Text style={[styles.sectionHeading, themed.text]}>Media</Text>
          <View style={[styles.sectionUnderline, themed.accentBg]} />
          {mediaUris.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
              {mediaUris.map((uri) => (
                <View key={uri} style={styles.thumbWrap}>
                  <Image source={{ uri }} style={styles.thumb} />
                  <Pressable
                    style={styles.thumbRemove}
                    onPress={() => setMediaUris((prev) => prev.filter((item) => item !== uri))}>
                    <Ionicons name="close" size={12} color={theme.onPrimary} />
                  </Pressable>
                </View>
              ))}
              <Pressable style={[styles.addMoreButton, themed.inputSurface, themed.subtleBorder]} onPress={onAddMedia}>
                <Ionicons name="add" size={22} color={theme.primary} />
              </Pressable>
            </ScrollView>
          ) : (
            <Pressable style={[styles.mediaDropzone, themed.inputSurface, themed.subtleBorder]} onPress={onAddMedia}>
              <MaterialCommunityIcons name="camera-outline" size={24} color={withAlpha(theme.primary, 0.3)} />
              <Text style={[styles.mediaHint, themed.mutedText]}>Add photos or video</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.saveFooter}>
          <Pressable
            accessibilityRole="button"
            disabled={!isComplete || isSavingLog}
            onPress={() => void handleSaveAll()}
            style={[
              styles.smallActionButton,
              themed.primarySurface,
              !isComplete || isSavingLog ? styles.smallActionButtonDisabled : null,
            ]}>
            <Text style={[styles.smallActionText, themed.onPrimary]}>{isSavingLog ? 'Saving...' : 'Save'}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <FloatingPillNav active="today" />
      <ImportPlanSheet
        visible={isImportSheetOpen}
        athleteId={session?.athlete_id}
        editingSessionId={sessionId ?? null}
        initialMode="manual"
        initialDate={session?.scheduled_date}
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: ['sessions'] });
          void queryClient.invalidateQueries({ queryKey: ['plan'] });
          void queryClient.invalidateQueries({ queryKey: ['sessions', 'detail', sessionId ?? 'missing'] });
        }}
        onClose={() => setIsImportSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerStateText: {
    fontFamily: 'System',
    fontSize: 14,
    color: '#0F2840',
  },
  centerStateSubtext: {
    marginTop: 8,
    fontFamily: 'System',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  backButton: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#0F2840',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backButtonText: {
    fontFamily: 'System',
    fontSize: 13,
    color: '#FFFFFF',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F6F3EE',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
  },
  sportLabel: {
    fontFamily: 'System',
    fontSize: 13,
    color: '#C97E2F',
    letterSpacing: 1.1,
  },
  sportLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 130,
    gap: 12,
  },
  webContent: {
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  heroCard: {
    backgroundColor: '#0F2840',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
  },
  heroSkeleton: {
    height: 126,
    borderRadius: 14,
  },
  blockSkeleton: {
    height: 120,
    borderRadius: 12,
  },
  buttonSkeleton: {
    height: 50,
    borderRadius: 999,
  },
  heroTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 34,
    lineHeight: 38,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  heroMeta: {
    fontFamily: 'System',
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
  },
  dateStampChip: {
    marginTop: 8,
    alignSelf: 'flex-start',
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateStampText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
  },
  heroAccentLine: {
    height: 1,
    backgroundColor: '#C97E2F',
    marginTop: 12,
  },
  blockCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  blockHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  blockTitle: {
    fontFamily: 'System',
    fontSize: 13,
    color: '#0F2840',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepPressableDisabled: {
    opacity: 0.55,
  },
  editToggleButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#C97E2F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleChecked: {
    backgroundColor: '#C97E2F',
  },
  stepText: {
    flex: 1,
    fontFamily: 'System',
    fontSize: 12,
    color: '#0F2840',
  },
  stepTextChecked: {
    color: 'rgba(15,40,64,0.4)',
  },
  coachTipCard: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: '#F6F3EE',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.08)',
    overflow: 'hidden',
  },
  coachTipBorder: {
    width: 4,
    backgroundColor: '#C97E2F',
  },
  coachTipContent: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  coachTipLabel: {
    fontFamily: 'System',
    fontSize: 11,
    color: '#C97E2F',
    letterSpacing: 1,
    marginBottom: 6,
  },
  coachTipText: {
    fontFamily: 'System',
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
    color: 'rgba(15,40,64,0.7)',
  },
  completeButton: {
    marginTop: 2,
    width: '100%',
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: '#0F2840',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  completeButtonDone: {
    backgroundColor: '#C97E2F',
  },
  completeButtonText: {
    fontFamily: 'System',
    fontSize: 15,
    color: '#FFFFFF',
  },
  sectionBlock: {
    marginTop: 8,
  },
  sectionHeading: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 18,
    color: '#0F2840',
  },
  sectionUnderline: {
    width: 60,
    height: 1,
    backgroundColor: '#C97E2F',
    marginTop: 2,
    marginBottom: 8,
  },
  notesInputWrap: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.15)',
    backgroundColor: '#F6F3EE',
    minHeight: 80,
    overflow: 'hidden',
    marginBottom: 8,
  },
  notesAccent: {
    width: 4,
    backgroundColor: '#C97E2F',
  },
  notesInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: 'System',
    fontSize: 13,
    color: '#0F2840',
  },
  smallActionButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#0F2840',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallActionButtonDisabled: {
    opacity: 0.5,
  },
  smallActionText: {
    fontFamily: 'System',
    fontSize: 13,
    color: '#FFFFFF',
  },
  saveFooter: {
    marginTop: 6,
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  autoSaveHint: {
    alignSelf: 'flex-end',
    fontFamily: 'System',
    fontSize: 12,
    color: 'rgba(15,40,64,0.55)',
  },
  fieldWrap: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontFamily: 'System',
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#C97E2F',
    marginBottom: 6,
  },
  fieldInput: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.15)',
    backgroundColor: '#F6F3EE',
    paddingHorizontal: 12,
    fontFamily: 'System',
    fontSize: 14,
    color: '#0F2840',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  fieldInputGrow: {
    flex: 1,
  },
  unitPill: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.15)',
    overflow: 'hidden',
    backgroundColor: '#F6F3EE',
  },
  unitOption: {
    minWidth: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  unitOptionActive: {
    backgroundColor: '#0F2840',
  },
  unitOptionText: {
    fontFamily: 'System',
    fontSize: 12,
    color: '#0F2840',
  },
  unitOptionTextActive: {
    color: '#FFFFFF',
  },
  singleUnit: {
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.15)',
    backgroundColor: '#F6F3EE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  singleUnitText: {
    fontFamily: 'System',
    fontSize: 12,
    color: '#0F2840',
  },
  rpeRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 8,
    paddingTop: 2,
  },
  rpePressable: {},
  rpeDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.4,
    borderColor: '#0F2840',
    backgroundColor: 'transparent',
  },
  rpeDotActive: {
    backgroundColor: '#C97E2F',
    borderColor: '#C97E2F',
  },
  mediaDropzone: {
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(15,40,64,0.2)',
    backgroundColor: '#F6F3EE',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mediaHint: {
    fontFamily: 'System',
    fontSize: 13,
    color: 'rgba(15,40,64,0.4)',
  },
  mediaRow: {
    paddingTop: 10,
    gap: 8,
  },
  thumbWrap: {
    width: 80,
    height: 80,
    borderRadius: 10,
    overflow: 'hidden',
  },
  thumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
  },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0F2840',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreButton: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    borderStyle: 'dashed',
    backgroundColor: '#F6F3EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
});


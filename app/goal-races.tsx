import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { useTheme } from '@/contexts/ThemeContext';
import { sessionQueryKeys, useActiveAthlete, useRaceGoals } from '@/hooks/useSessionData';
import { ensureAthleteRowExists, ensureSupabaseAuthUser } from '@/lib/supabase-auth';
import { datePickerAndroidMondayOpenProps, datePickerMondayWeekProps, openWebDateInput } from '@/lib/dates';
import { supabase } from '@/lib/supabase';

type GoalForm = {
  title: string;
  eventDate: string;
  priority: 'a' | 'b' | 'c';
  raceType: string;
  swim: string;
  bike: string;
  run: string;
  overall: string;
};

const EMPTY_FORM: GoalForm = {
  title: '',
  eventDate: '',
  priority: 'c',
  raceType: '',
  swim: '',
  bike: '',
  run: '',
  overall: '',
};

const PRIORITY_LABELS: Record<GoalForm['priority'], string> = {
  a: 'A',
  b: 'B',
  c: 'C',
};

function normalizeIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeRaceGoalDateInput(value: string | null | undefined) {
  if (!value) return '';
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : value;
}

function addMonths(base: Date, months: number) {
  const next = new Date(base);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isColorDark(value: string) {
  const hex = value.trim().replace('#', '');
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : hex.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return false;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  // Relative luminance approximation to decide light/dark variant.
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance < 150;
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function daysUntil(value: string) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const eventDate = new Date(`${value}T00:00:00`);
  const delta = Math.ceil((eventDate.getTime() - now.getTime()) / 86_400_000);
  if (delta > 0) return `${delta} days to go`;
  if (delta === 0) return 'Race day';
  return `${Math.abs(delta)} days ago`;
}

function parseGoalTime(value: string) {
  const [rawH = '', rawM = '', rawS = ''] = value.split(':');
  const h = rawH.replace(/\D/g, '').slice(0, 2);
  const m = rawM.replace(/\D/g, '').slice(0, 2);
  const s = rawS.replace(/\D/g, '').slice(0, 2);
  return { h, m, s };
}

function composeGoalTime(parts: { h: string; m: string; s: string }) {
  if (!parts.h && !parts.m && !parts.s) return '';
  // Keep raw segments while typing; normalize on blur/save.
  return `${parts.h}:${parts.m}:${parts.s}`;
}

function normalizeGoalTimeForSave(value: string) {
  const { h, m, s } = parseGoalTime(value);
  if (!h && !m && !s) return null;
  const hh = (h || '0').padStart(2, '0');
  const mm = (m || '0').padStart(2, '0');
  const ss = (s || '0').padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function GoalTimeInput({
  label,
  value,
  onChange,
  styles,
  mutedColor,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  styles: ReturnType<typeof createStyles>;
  mutedColor: string;
}) {
  const { h, m, s } = parseGoalTime(value);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  const blurNormalizePart = (part: 'h' | 'm' | 's') => {
    const current = part === 'h' ? h : part === 'm' ? m : s;
    if (!current) return;

    if (part === 'm' || part === 's') {
      const numeric = Number(current);
      if (Number.isNaN(numeric)) return;
      const clamped = Math.min(59, Math.max(0, numeric));
      const updated: { h: string; m: string; s: string } = { h, m, s };
      updated[part] = `${clamped}`.padStart(2, '0');
      onChange(composeGoalTime(updated));
      return;
    }

    const updated: { h: string; m: string; s: string } = { h, m, s };
    updated[part] = current.padStart(2, '0');
    onChange(composeGoalTime(updated));
  };

  const updatePart = (part: 'h' | 'm' | 's', nextRaw: string) => {
    const digits = nextRaw.replace(/\D/g, '').slice(0, 2);
    let next = digits;
    let shouldAdvance = false;

    if (part === 'm' || part === 's') {
      if (digits.length === 2) {
        const value = Number(digits);
        if (!Number.isNaN(value) && value > 59) {
          next = '59';
        }
        shouldAdvance = true;
      }
    } else if (part === 'h' && digits.length === 2) {
      shouldAdvance = true;
    }

    const nextParts = { h, m, s, [part]: next };
    onChange(composeGoalTime(nextParts));

    if (shouldAdvance && Platform.OS !== 'web') {
      if (part === 'h') inputRefs.current[1]?.focus();
      if (part === 'm') inputRefs.current[2]?.focus();
    }
  };

  return (
    <View style={styles.goalTimeRow}>
      <Text style={styles.goalTimeLabel}>{label}</Text>
      <View style={styles.goalTimeInputWrap}>
        <TextInput
          ref={(ref) => {
            inputRefs.current[0] = ref;
          }}
          value={h}
          onChangeText={(next) => updatePart('h', next)}
          onBlur={() => blurNormalizePart('h')}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          placeholder="HH"
          placeholderTextColor={mutedColor}
          style={styles.goalTimePartInput}
        />
        <Text style={styles.goalTimeSeparator}>:</Text>
        <TextInput
          ref={(ref) => {
            inputRefs.current[1] = ref;
          }}
          value={m}
          onChangeText={(next) => updatePart('m', next)}
          onBlur={() => blurNormalizePart('m')}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          placeholder="MM"
          placeholderTextColor={mutedColor}
          style={styles.goalTimePartInput}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === 'Backspace' && m.length === 0) {
              inputRefs.current[0]?.focus();
            }
          }}
        />
        <Text style={styles.goalTimeSeparator}>:</Text>
        <TextInput
          ref={(ref) => {
            inputRefs.current[2] = ref;
          }}
          value={s}
          onChangeText={(next) => updatePart('s', next)}
          onBlur={() => blurNormalizePart('s')}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={2}
          placeholder="SS"
          placeholderTextColor={mutedColor}
          style={styles.goalTimePartInput}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === 'Backspace' && s.length === 0) {
              inputRefs.current[1]?.focus();
            }
          }}
        />
      </View>
    </View>
  );
}

export default function GoalRacesScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { data: athlete, isLoading: athleteLoading } = useActiveAthlete();
  const [authAthleteId, setAuthAthleteId] = useState<string | null>(null);
  /** Must match rows written with `auth.uid()` / `ensureAthleteRowExists` so list + invalidations stay aligned. */
  const effectiveAthleteId = athlete?.id ?? authAthleteId ?? null;
  const { data: goals = [], isLoading: goalsQueryLoading, error } = useRaceGoals(effectiveAthleteId);
  const listLoading = athleteLoading || (Boolean(effectiveAthleteId) && goalsQueryLoading);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [iosPickerDate, setIosPickerDate] = useState(new Date());
  const [form, setForm] = useState<GoalForm>(EMPTY_FORM);
  const quickDatePicks = useMemo(() => {
    return [
      { key: 'month-1', label: '+1 month', months: 1 },
      { key: 'month-2', label: '+2 months', months: 2 },
      { key: 'month-6', label: '+6 months', months: 6 },
    ];
  }, []);
  const iosPickerThemeVariant = useMemo(
    () => (isColorDark(theme.surface) ? 'dark' : 'light'),
    [theme.surface]
  );

  useEffect(() => {
    let mounted = true;
    const primeSessionAndAthlete = async () => {
      try {
        const authUser = await ensureSupabaseAuthUser();
        await ensureAthleteRowExists(authUser.id);
        if (!mounted) return;
        setAuthAthleteId(authUser.id);
        await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() });
      } catch {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!mounted) return;
        const sid = session?.user?.id ?? null;
        setAuthAthleteId(sid);
        if (sid) {
          try {
            await ensureAthleteRowExists(sid);
            if (!mounted) return;
            await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() });
          } catch {
            /* ignore */
          }
        }
      }
    };
    void primeSessionAndAthlete();
    return () => {
      mounted = false;
    };
  }, [queryClient]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowDatePicker(false);
    setIsEditing(true);
  };

  const openEdit = (goal: (typeof goals)[number]) => {
    setEditingId(goal.id);
    setForm({
      title: goal.title,
      eventDate: normalizeRaceGoalDateInput(goal.event_date),
      priority: (goal.priority as GoalForm['priority'] | null) ?? 'c',
      raceType: goal.race_type ?? '',
      swim: goal.goal_swim_time ?? '',
      bike: goal.goal_bike_time ?? '',
      run: goal.goal_run_time ?? '',
      overall: goal.goal_overall_time ?? '',
    });
    setFormError(null);
    setShowDatePicker(false);
    setIsEditing(true);
  };

  const closeEditor = () => {
    if (!isSaving) {
      setIsEditing(false);
      setShowDatePicker(false);
      setEditingId(null);
    }
  };

  const openDatePicker = () => {
    Keyboard.dismiss();
    const pickerValue = form.eventDate ? new Date(`${form.eventDate}T00:00:00`) : new Date();

    if (Platform.OS === 'web') {
      openWebDateInput(form.eventDate || normalizeIsoDate(new Date()), (isoDate) => {
        setForm((prev) => ({ ...prev, eventDate: isoDate }));
      });
      return;
    }

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        ...datePickerAndroidMondayOpenProps(),
        value: pickerValue,
        mode: 'date',
        onChange: (event, selectedDate) => {
          if (event.type === 'set' && selectedDate) {
            setForm((prev) => ({ ...prev, eventDate: normalizeIsoDate(selectedDate) }));
          }
        },
      });
      return;
    }

    setIosPickerDate(pickerValue);
    setShowDatePicker(true);
  };

  const saveGoal = async () => {
    const title = form.title.trim();
    const eventDate = form.eventDate.trim();
    const raceType = form.raceType.trim();
    const priority = form.priority;
    let athleteIdForSave: string | null = null;
    try {
      const authUser = await ensureSupabaseAuthUser();
      await ensureAthleteRowExists(authUser.id);
      athleteIdForSave = athlete?.id ?? authUser.id;
      setAuthAthleteId(authUser.id);
    } catch {
      // Keep existing validation path below for user-visible error.
    }
    if (!athleteIdForSave) {
      const message = 'No athlete found yet.';
      setFormError(message);
      Alert.alert('Could not save goal', message);
      return;
    }
    if (!title) {
      const message = 'Event title is required.';
      setFormError(message);
      Alert.alert('Could not save goal', message);
      return;
    }
    if (!eventDate) {
      const message = 'Event date is required.';
      setFormError(message);
      Alert.alert('Could not save goal', message);
      return;
    }
    // Allow multiple goals without hard date-spacing blocks.

    setIsSaving(true);
    setFormError(null);
    const payload = {
      athlete_id: athleteIdForSave,
      title,
      event_date: eventDate,
      priority,
      race_type: raceType || null,
      goal_swim_time: normalizeGoalTimeForSave(form.swim.trim()),
      goal_bike_time: normalizeGoalTimeForSave(form.bike.trim()),
      goal_run_time: normalizeGoalTimeForSave(form.run.trim()),
      goal_overall_time: normalizeGoalTimeForSave(form.overall.trim()),
    };

    try {
      const isUpdate = Boolean(editingId);
      const query = isUpdate
        ? supabase.from('race_goals').update(payload).eq('id', editingId!)
        : supabase.from('race_goals').insert(payload);

      const { error: saveError } = await query;
      if (saveError) {
        setFormError(saveError.message);
        Alert.alert('Could not save goal', saveError.message);
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionQueryKeys.raceGoals(athleteIdForSave) }),
        queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() }),
      ]);
      await queryClient.refetchQueries({ queryKey: sessionQueryKeys.raceGoals(athleteIdForSave) });

      setEditingId(null);
      setIsEditing(false);
      setShowDatePicker(false);
      Alert.alert('Goal saved');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteGoal = async (goalId: string) => {
    if (isDeletingId) return;
    let athleteIdForDelete: string | null = null;
    try {
      const authUser = await ensureSupabaseAuthUser();
      await ensureAthleteRowExists(authUser.id);
      athleteIdForDelete = athlete?.id ?? authUser.id;
      setAuthAthleteId(authUser.id);
    } catch {
      athleteIdForDelete = effectiveAthleteId;
    }
    if (!athleteIdForDelete) return;
    setIsDeletingId(goalId);
    const { error: deleteError } = await supabase
      .from('race_goals')
      .delete()
      .eq('id', goalId)
      .eq('athlete_id', athleteIdForDelete);
    if (deleteError) {
      Alert.alert('Could not delete goal', deleteError.message);
      setIsDeletingId(null);
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.raceGoals(athleteIdForDelete) }),
      queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() }),
    ]);
    setIsDeletingId(null);
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    router.replace('/(tabs)/profile');
  };

  const priorityBadgeStyle = (priority: string | null | undefined) => {
    if (priority === 'a') return styles.priorityBadgeA;
    if (priority === 'b') return styles.priorityBadgeB;
    return styles.priorityBadgeC;
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}>
        <Pressable style={styles.backButton} onPress={handleBack} accessibilityRole="button">
          <Ionicons name="chevron-back" size={16} color={theme.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Goal races</Text>
          <Pressable style={styles.addButton} onPress={openCreate}>
            <Ionicons name="add" size={16} color={theme.primary} />
            <Text style={styles.addButtonText}>Add goal</Text>
          </Pressable>
        </View>

        {listLoading ? <Text style={styles.helperText}>Loading goals...</Text> : null}
        {error ? <Text style={styles.errorText}>Could not load goals: {error.message}</Text> : null}

        {!listLoading && goals.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No goal races yet</Text>
            <Text style={styles.emptyBody}>Add your first event to keep race targets in one place.</Text>
          </View>
        ) : null}

        {goals.map((goal) => (
          <View key={goal.id} style={styles.goalCard}>
            <View style={styles.goalCardHeader}>
              <View style={styles.goalCardBody}>
                <Text style={styles.goalTitle}>{goal.title}</Text>
                <Text style={styles.goalMeta}>
                  {formatDate(goal.event_date)} · {daysUntil(goal.event_date)}
                </Text>
              </View>
              <View style={styles.priorityBadgeWrap}>
                <View style={[styles.priorityBadge, priorityBadgeStyle(goal.priority)]}>
                  <Text style={styles.priorityBadgeText}>{PRIORITY_LABELS[(goal.priority as GoalForm['priority'] | null) ?? 'c']}</Text>
                </View>
              </View>
              <View style={styles.goalActions}>
                <Pressable
                  style={styles.goalIconButton}
                  accessibilityLabel="Edit goal"
                  onPress={() => openEdit(goal)}>
                  <Ionicons name="pencil-outline" size={14} color={theme.textMuted} />
                </Pressable>
                <Pressable
                  style={[styles.goalIconButton, styles.goalDeleteIconButton]}
                  accessibilityLabel="Delete goal"
                  disabled={isDeletingId === goal.id}
                  onPress={() => void deleteGoal(goal.id)}>
                  <Ionicons
                    name={isDeletingId === goal.id ? 'sync-outline' : 'trash-outline'}
                    size={14}
                    color={theme.danger}
                  />
                </Pressable>
              </View>
            </View>
            {([
              ['Swim', goal.goal_swim_time],
              ['Bike', goal.goal_bike_time],
              ['Run', goal.goal_run_time],
              ['Overall', goal.goal_overall_time],
            ] as const).some(([, value]) => Boolean(value)) ? (
              <View style={styles.timeGrid}>
                {([
                  ['Swim', goal.goal_swim_time],
                  ['Bike', goal.goal_bike_time],
                  ['Run', goal.goal_run_time],
                  ['Overall', goal.goal_overall_time],
                ] as const).map(([label, value]) =>
                  value ? (
                    <Text key={label} style={styles.timeLabel}>
                      {label}: {value}
                    </Text>
                  ) : null
                )}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <Modal transparent visible={isEditing} animationType="none" onRequestClose={closeEditor}>
        <KeyboardAvoidingView
          style={styles.editorKeyboardRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.editorModalInner}>
            <Pressable style={styles.modalOverlay} onPress={closeEditor} />
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
              <View style={styles.modalHandle} />
              <Pressable style={styles.modalCloseButton} onPress={closeEditor} hitSlop={8}>
                <Ionicons name="close" size={16} color={theme.primary} />
              </Pressable>
              <Text style={styles.modalTitle}>{editingId ? 'Edit goal race' : 'Add goal race'}</Text>

              <ScrollView
                keyboardShouldPersistTaps="always"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalContent}>
                <TextInput
                  value={form.title}
                  onChangeText={(title) => setForm((prev) => ({ ...prev, title }))}
                  placeholder="Event title"
                  placeholderTextColor={theme.textMuted}
                  style={styles.input}
                />

                <TextInput
                  value={form.raceType}
                  onChangeText={(raceType) => setForm((prev) => ({ ...prev, raceType }))}
                  placeholder="Race type (e.g. tri-olympic, marathon, hyrox)"
                  placeholderTextColor={theme.textMuted}
                  style={styles.input}
                />

                <Text style={styles.fieldLabel}>Priority</Text>
                <View style={styles.priorityRow}>
                  {(['a', 'b', 'c'] as const).map((value) => {
                    const selected = form.priority === value;
                    return (
                      <Pressable
                        key={value}
                        style={[styles.priorityChip, selected ? styles.priorityChipSelected : null]}
                        onPress={() => setForm((prev) => ({ ...prev, priority: value }))}>
                        <Text style={[styles.priorityChipText, selected ? styles.priorityChipTextSelected : null]}>
                          {PRIORITY_LABELS[value]} Race
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.datePickerContainer}>
                  <Pressable
                    style={styles.dateButton}
                    onPress={openDatePicker}
                    hitSlop={8}
                    accessibilityRole="button"
                    disabled={showDatePicker && Platform.OS === 'ios'}>
                    <Text style={form.eventDate ? styles.dateText : styles.datePlaceholder}>
                      {form.eventDate ? formatDate(form.eventDate) : 'Select event date'}
                    </Text>
                    {showDatePicker && Platform.OS === 'ios' ? (
                      <Pressable
                        style={styles.clearDateButton}
                        onPress={() => {
                          setForm((prev) => ({ ...prev, eventDate: '' }));
                          setIosPickerDate(new Date());
                          setShowDatePicker(false);
                        }}>
                        <Ionicons name="refresh" size={13} color={theme.textMuted} />
                        <Text style={styles.clearDateButtonText}>Clear</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                  {showDatePicker && Platform.OS === 'ios' ? (
                    <View style={styles.datePickerInlineContent}>
                      <View style={styles.quickDateRow}>
                        {quickDatePicks.map((pick) => (
                          <Pressable
                            key={pick.key}
                            style={styles.quickDateChip}
                            onPress={() => {
                              const pickedDate = addMonths(new Date(), pick.months);
                              setIosPickerDate(pickedDate);
                              setForm((prev) => ({ ...prev, eventDate: normalizeIsoDate(pickedDate) }));
                              setShowDatePicker(false);
                            }}>
                            <Text style={styles.quickDateChipText}>{pick.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <DateTimePicker
                        {...datePickerMondayWeekProps()}
                        value={iosPickerDate}
                        mode="date"
                        display="inline"
                        style={styles.datePicker}
                        {...(Platform.OS === 'ios'
                          ? {
                              accentColor: theme.accent,
                              textColor: theme.text,
                              themeVariant: iosPickerThemeVariant,
                            }
                          : null)}
                        onChange={(_event, selectedDate) => {
                          if (selectedDate) {
                            setIosPickerDate(selectedDate);
                            setForm((prev) => ({ ...prev, eventDate: normalizeIsoDate(selectedDate) }));
                          }
                        }}
                      />
                      <View style={styles.datePickerActions}>
                        <Pressable style={styles.datePickerDoneButton} onPress={() => setShowDatePicker(false)}>
                          <Text style={styles.datePickerDoneText}>Done</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>

                <Text style={styles.fieldLabel}>Goal times (HH:MM:SS)</Text>
                <GoalTimeInput
                  label="Swim"
                  value={form.swim}
                  onChange={(swim) => setForm((prev) => ({ ...prev, swim }))}
                  styles={styles}
                  mutedColor={theme.textMuted}
                />
                <GoalTimeInput
                  label="Bike"
                  value={form.bike}
                  onChange={(bike) => setForm((prev) => ({ ...prev, bike }))}
                  styles={styles}
                  mutedColor={theme.textMuted}
                />
                <GoalTimeInput
                  label="Run"
                  value={form.run}
                  onChange={(run) => setForm((prev) => ({ ...prev, run }))}
                  styles={styles}
                  mutedColor={theme.textMuted}
                />
                <GoalTimeInput
                  label="Overall"
                  value={form.overall}
                  onChange={(overall) => setForm((prev) => ({ ...prev, overall }))}
                  styles={styles}
                  mutedColor={theme.textMuted}
                />

                {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

                <View style={styles.modalActions}>
                  <Pressable style={styles.ghostButton} disabled={isSaving} onPress={closeEditor}>
                    <Text style={styles.ghostButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.saveButton} disabled={isSaving} onPress={() => void saveGoal()}>
                    <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save goal'}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <FloatingPillNav active="profile" />
    </SafeAreaView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.base,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 20,
      gap: 12,
    },
    backButton: {
      alignSelf: 'flex-start',
      minHeight: 34,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: theme.surface,
    },
    backButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.primary,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    heading: {
      fontFamily: 'CormorantGaramond_700Bold',
      fontSize: 34,
      color: theme.primary,
    },
    subHeading: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 13,
      color: theme.textMuted,
      marginTop: -2,
      marginBottom: 4,
    },
    addButton: {
      minHeight: 34,
      borderWidth: 1,
      borderColor: theme.primary,
      borderRadius: 999,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    addButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.primary,
    },
    helperText: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
    },
    errorText: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.danger,
    },
    emptyCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      gap: 4,
    },
    emptyTitle: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 14,
      color: theme.primary,
    },
    emptyBody: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
    },
    goalCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: `${theme.primary}1A`,
      backgroundColor: theme.surface,
      padding: 12,
      gap: 8,
    },
    goalCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    },
    goalCardBody: {
      flex: 1,
      gap: 2,
    },
    goalTitle: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 14,
      color: theme.primary,
    },
    goalMeta: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
    },
    goalActions: {
      flexDirection: 'row',
      gap: 6,
    },
    goalIconButton: {
      width: 30,
      height: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    goalDeleteIconButton: {
      borderColor: `${theme.danger}80`,
    },
    priorityBadgeWrap: {
      paddingTop: 2,
    },
    priorityBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
    },
    priorityBadgeA: {
      backgroundColor: '#C97E2F',
      borderColor: '#C97E2F',
    },
    priorityBadgeB: {
      backgroundColor: '#B0B7C3',
      borderColor: '#B0B7C3',
    },
    priorityBadgeC: {
      backgroundColor: '#B16C3D',
      borderColor: '#B16C3D',
    },
    priorityBadgeText: {
      fontFamily: 'DMSans_700Bold',
      fontSize: 10,
      color: '#FFFFFF',
    },
    ghostButton: {
      minHeight: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      color: theme.textMuted,
    },
    deleteButton: {
      minHeight: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: `${theme.danger}80`,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      color: theme.danger,
    },
    timeGrid: {
      gap: 4,
    },
    timeLabel: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.text,
    },
    editorKeyboardRoot: {
      flex: 1,
    },
    editorModalInner: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalRoot: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    modalOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.42)',
    },
    modalSheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      borderBottomWidth: 0,
      paddingHorizontal: 20,
      paddingTop: 8,
      maxHeight: '92%',
    },
    modalHandle: {
      alignSelf: 'center',
      width: 42,
      height: 5,
      borderRadius: 999,
      backgroundColor: `${theme.textMuted}55`,
      marginBottom: 14,
    },
    modalContent: {
      gap: 8,
      paddingBottom: 8,
    },
    modalCloseButton: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    datePickerCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 14,
      gap: 8,
    },
    datePickerContainer: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      overflow: 'hidden',
    },
    datePickerInlineContent: {
      paddingHorizontal: 12,
      paddingBottom: 10,
      gap: 8,
    },
    clearDateButton: {
      minHeight: 28,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: theme.surface,
    },
    clearDateButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      color: theme.textMuted,
    },
    datePicker: {
      alignSelf: 'center',
      transform: [{ scale: 0.92 }],
    },
    quickDateRow: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    quickDateChip: {
      minHeight: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    quickDateChipText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      color: theme.textMuted,
    },
    datePickerActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 4,
    },
    datePickerDoneButton: {
      minHeight: 30,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
    },
    datePickerDoneText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 11,
      color: theme.surface,
    },
    modalTitle: {
      fontFamily: 'CormorantGaramond_700Bold',
      fontSize: 30,
      color: theme.primary,
      marginBottom: 6,
    },
    fieldLabel: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 11,
      color: theme.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginTop: 2,
    },
    priorityRow: {
      flexDirection: 'row',
      gap: 8,
    },
    priorityChip: {
      minHeight: 34,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
    },
    priorityChipSelected: {
      borderColor: theme.accent,
      backgroundColor: `${theme.accent}20`,
    },
    priorityChipText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.textMuted,
    },
    priorityChipTextSelected: {
      color: theme.primary,
    },
    input: {
      minHeight: 42,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 12,
      fontFamily: 'DMSans_400Regular',
      fontSize: 13,
      color: theme.text,
    },
    goalTimeRow: {
      minHeight: 42,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      backgroundColor: theme.surface,
    },
    goalTimeLabel: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 13,
      color: theme.text,
      minWidth: 52,
    },
    goalTimeInputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    goalTimePartInput: {
      minWidth: 44,
      minHeight: 32,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      textAlign: 'center',
      paddingHorizontal: 8,
      fontFamily: 'DMSans_500Medium',
      fontSize: 13,
      color: theme.text,
      backgroundColor: theme.base,
    },
    goalTimeSeparator: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 13,
      color: theme.textMuted,
    },
    dateButton: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingHorizontal: 12,
    },
    dateText: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 13,
      color: theme.text,
    },
    datePlaceholder: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 13,
      color: theme.textMuted,
    },
    modalActions: {
      marginTop: 6,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
    },
    saveButton: {
      minHeight: 34,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
    },
    saveButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.surface,
    },
  });

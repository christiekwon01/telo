import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { invalidateSessionRelatedQueries, useActiveAthlete } from '@/hooks/useSessionData';
import { datePickerAndroidMondayOpenProps, datePickerMondayWeekProps } from '@/lib/dates';
import { withAlpha } from '@/lib/theme-utils';
import { supabase } from '@/lib/supabase';
import { syncAppleCalendarIfEnabled } from '@/services/appleCalendarSync';
import { pickCelebrationImprovement, syncPersonalBestsAfterSessionLogsChange } from '@/services/personalBests';
import { usePersonalBestCelebrationStore } from '@/store/personal-best-celebration-store';
import type { Json } from '@/types/supabase';

const PICKER_MEDIA_TYPES: ImagePicker.MediaType[] = ['images', 'videos'];

const SPORTS = [
  { key: 'swim' as const, label: 'Swim' },
  { key: 'bike' as const, label: 'Bike' },
  { key: 'run' as const, label: 'Run' },
  { key: 'brick' as const, label: 'Brick' },
];

const INTENSITIES = ['Easy', 'Steady', 'Tempo', 'Threshold', 'Sprint'] as const;

export type LogSessionSheetProps = {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  onLogged?: () => void;
};

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoToLocal(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function computeWeekNumber(planStartIso: string, scheduledIso: string, totalWeeks: number): number {
  const [y1, m1, d1] = planStartIso.split('-').map(Number);
  const [y2, m2, d2] = scheduledIso.split('-').map(Number);
  const start = new Date(y1, m1 - 1, d1);
  const sched = new Date(y2, m2 - 1, d2);
  const diffDays = Math.round((sched.getTime() - start.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  const clampedLow = Math.max(1, week);
  return Math.min(clampedLow, Math.max(1, totalWeeks));
}

async function fetchActivePlanMeta(athleteId: string): Promise<{
  id: string;
  athlete_id: string;
  start_date: string;
  phase: 'base' | 'load' | 'sharpen';
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
  const normalizedPhase = data.phase === 'base' || data.phase === 'load' || data.phase === 'sharpen' ? data.phase : 'base';
  return {
    id: data.id,
    athlete_id: data.athlete_id,
    start_date: data.start_date,
    phase: normalizedPhase,
    total_weeks: data.total_weeks ?? 1,
  };
}

function showLoggedToast() {
  if (Platform.OS === 'android') {
    ToastAndroid.show('Session logged ✓', ToastAndroid.SHORT);
  } else {
    Alert.alert('', 'Session logged ✓');
  }
}

function sanitizeDecimalInput(value: string) {
  const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDecimalIndex = normalized.indexOf('.');
  if (firstDecimalIndex === -1) return normalized;
  return (
    normalized.slice(0, firstDecimalIndex + 1) +
    normalized.slice(firstDecimalIndex + 1).replace(/\./g, '')
  );
}

export function LogSessionSheet({ visible, onClose, initialDate, onLogged }: LogSessionSheetProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { data: activeAthlete } = useActiveAthlete();

  const [selectedDateIso, setSelectedDateIso] = useState(() => toIsoDate(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [iosPickerDate, setIosPickerDate] = useState(new Date());
  const [sport, setSport] = useState<(typeof SPORTS)[number]['key']>('run');
  const [title, setTitle] = useState('');
  const [durationValue, setDurationValue] = useState('');
  const [durationUnit, setDurationUnit] = useState<'min' | 'hr'>('min');
  const [distanceValue, setDistanceValue] = useState('');
  const [distanceUnit, setDistanceUnit] = useState<'m' | 'km'>('km');
  const [intensity, setIntensity] = useState<(typeof INTENSITIES)[number]>('Steady');
  const [notes, setNotes] = useState('');
  const [addToPlan, setAddToPlan] = useState(true);
  const [mediaUris, setMediaUris] = useState<string[]>([]);

  const resetForm = useCallback(() => {
    const baseIso = initialDate ?? toIsoDate(new Date());
    setSelectedDateIso(baseIso);
    setShowDatePicker(false);
    setIosPickerDate(parseIsoToLocal(baseIso));
    setSport('run');
    setTitle('');
    setDurationValue('');
    setDurationUnit('min');
    setDistanceValue('');
    setDistanceUnit('km');
    setIntensity('Steady');
    setNotes('');
    setAddToPlan(true);
    setMediaUris([]);
  }, [initialDate]);

  useEffect(() => {
    if (!visible) return;
    resetForm();
  }, [visible, resetForm]);

  const shiftDate = (deltaDays: number) => {
    const d = parseIsoToLocal(selectedDateIso);
    d.setDate(d.getDate() + deltaDays);
    setSelectedDateIso(toIsoDate(d));
  };

  const openDatePicker = () => {
    const pickerValue = parseIsoToLocal(selectedDateIso);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        ...datePickerAndroidMondayOpenProps(),
        value: pickerValue,
        mode: 'date',
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) {
            setSelectedDateIso(toIsoDate(selected));
          }
        },
      });
      return;
    }
    setIosPickerDate(pickerValue);
    setShowDatePicker(true);
  };

  const dateDisplay = parseIsoToLocal(selectedDateIso).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const pickFromLibrary = async () => {
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

  const handleSave = async () => {
    const completedAt = new Date().toISOString();
    const titleTrim = title.trim();

    const rawDur = durationValue.replace(',', '.').trim();
    const durationMinsNum = rawDur ? Number(rawDur) : undefined;
    const rawDist = distanceValue.replace(',', '.').trim();
    const distanceNum = rawDist ? Number(rawDist) : undefined;

    const duration_mins =
      durationMinsNum !== undefined && !Number.isNaN(durationMinsNum)
        ? durationUnit === 'hr'
          ? Math.round(durationMinsNum * 60)
          : Math.round(durationMinsNum)
        : null;

    if (!addToPlan) {
      Alert.alert(
        'Not saved to plan',
        'Turn on Add to training plan to save this session to your calendar and mark it complete.'
      );
      onClose();
      return;
    }

    const athleteId = activeAthlete?.id;
    if (!athleteId) {
      Alert.alert('Athlete unavailable', 'Could not find an active athlete profile.');
      return;
    }

    const planMeta = await fetchActivePlanMeta(athleteId);
    if (!planMeta) {
      Alert.alert(
        'Plan unavailable',
        'Could not find an active training plan. Try again after your plan is loaded.'
      );
      return;
    }

    const week_number = computeWeekNumber(planMeta.start_date, selectedDateIso, planMeta.total_weeks);

    const { data: inserted, error: insertError } = await supabase
      .from('sessions')
      .insert({
        plan_id: planMeta.id,
        athlete_id: planMeta.athlete_id,
        title: titleTrim || `Manual ${sport}`,
        sport,
        scheduled_date: selectedDateIso,
        duration_mins,
        distance: distanceNum !== undefined && !Number.isNaN(distanceNum) ? distanceNum : null,
        distance_unit:
          distanceNum !== undefined && !Number.isNaN(distanceNum) ? distanceUnit : null,
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
      notes: notes.trim() ? notes.trim() : null,
      media_uris: (mediaUris.length ? mediaUris : null) as Json | null,
      actual_duration_mins: duration_mins,
      actual_distance: distanceNum !== undefined && !Number.isNaN(distanceNum) ? distanceNum : null,
      avg_heart_rate: null,
      rpe: null,
      source: 'manual_log',
      external_workout_id: null,
    });

    if (logError) {
      Alert.alert('Session saved but log failed', logError.message);
    }

    await invalidateSessionRelatedQueries(queryClient, {
      sessionId: sessionRowId,
      athleteId: planMeta.athlete_id,
      scheduledDateIso: selectedDateIso,
    });

    try {
      const improvements = await syncPersonalBestsAfterSessionLogsChange(queryClient, planMeta.athlete_id);
      const top = pickCelebrationImprovement(improvements);
      if (top) usePersonalBestCelebrationStore.getState().show(top);
    } catch (e) {
      if (__DEV__) {
        console.warn('[personal_bests] sync after manual log failed', e);
      }
    }
    void syncAppleCalendarIfEnabled(planMeta.athlete_id, parseIsoToLocal(selectedDateIso));

    onClose();
    showLoggedToast();
    onLogged?.();
  };

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalInner}>
          <Pressable style={styles.backdrop} onPress={onClose} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
            <View style={styles.handle} />
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={16} color={theme.primary} />
            </Pressable>
            <Text style={styles.sheetTitle}>Log session</Text>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}>
              <Text style={styles.fieldLabel}>DATE</Text>
              <View style={styles.dateRow}>
                <Pressable hitSlop={8} onPress={() => shiftDate(-1)} style={styles.dateChevron}>
                  <Ionicons name="chevron-back" size={20} color={theme.primary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Select date"
                  onPress={openDatePicker}
                  style={styles.dateCenterButton}
                  hitSlop={8}>
                  <Text style={styles.dateText}>{dateDisplay}</Text>
                </Pressable>
                <Pressable hitSlop={8} onPress={() => shiftDate(1)} style={styles.dateChevron}>
                  <Ionicons name="chevron-forward" size={20} color={theme.primary} />
                </Pressable>
              </View>
              {showDatePicker && Platform.OS === 'ios' ? (
                <View style={styles.datePickerInlineCard}>
                  <DateTimePicker
                    {...datePickerMondayWeekProps()}
                    value={iosPickerDate}
                    mode="date"
                    display="inline"
                    {...(Platform.OS === 'ios' ? { accentColor: theme.accent, textColor: theme.text } : null)}
                    onChange={(_e, selected) => {
                      if (selected) setIosPickerDate(selected);
                    }}
                  />
                  <View style={styles.datePickerActions}>
                    <Pressable style={styles.datePickerGhostButton} onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.datePickerGhostText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={styles.datePickerDoneButton}
                      onPress={() => {
                        setSelectedDateIso(toIsoDate(iosPickerDate));
                        setShowDatePicker(false);
                      }}>
                      <Text style={styles.datePickerDoneText}>Done</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <Text style={styles.fieldLabel}>SPORT</Text>
              <View style={styles.pillRow}>
                {SPORTS.map((item) => {
                  const active = sport === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setSport(item.key)}
                      style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}>
                      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextIdle]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>SESSION TITLE</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Easy recovery run"
                placeholderTextColor={withAlpha(theme.primary, 0.35)}
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>DURATION</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  value={durationValue}
                  onChangeText={(value) => setDurationValue(sanitizeDecimalInput(value))}
                  placeholder="0"
                  placeholderTextColor={withAlpha(theme.primary, 0.35)}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.inputFlex]}
                />
                <View style={styles.unitToggle}>
                  {(['min', 'hr'] as const).map((u) => {
                    const on = durationUnit === u;
                    return (
                      <Pressable
                        key={u}
                        onPress={() => setDurationUnit(u)}
                        style={[styles.unitChip, on ? styles.unitChipOn : styles.unitChipOff]}>
                        <Text style={[styles.unitChipText, on ? styles.unitChipTextOn : styles.unitChipTextOff]}>
                          {u}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Text style={styles.fieldLabel}>DISTANCE</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  value={distanceValue}
                  onChangeText={(value) => setDistanceValue(sanitizeDecimalInput(value))}
                  placeholder="Optional"
                  placeholderTextColor={withAlpha(theme.primary, 0.35)}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.inputFlex]}
                />
                <View style={styles.unitToggle}>
                  {(['m', 'km'] as const).map((u) => {
                    const on = distanceUnit === u;
                    return (
                      <Pressable
                        key={u}
                        onPress={() => setDistanceUnit(u)}
                        style={[styles.unitChip, on ? styles.unitChipOn : styles.unitChipOff]}>
                        <Text style={[styles.unitChipText, on ? styles.unitChipTextOn : styles.unitChipTextOff]}>
                          {u}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Text style={styles.fieldLabel}>INTENSITY</Text>
              <View style={styles.pillRow}>
                {INTENSITIES.map((label) => {
                  const active = intensity === label;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => setIntensity(label)}
                      style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}>
                      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextIdle]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>NOTES</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="How did it feel?"
                placeholderTextColor={withAlpha(theme.primary, 0.35)}
                multiline
                style={[styles.input, styles.notesInput]}
                textAlignVertical="top"
              />

              <Text style={styles.fieldLabel}>ADD MEDIA</Text>
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
                  <Pressable style={styles.addMoreButton} onPress={onAddMedia}>
                    <Ionicons name="add" size={22} color={theme.primary} />
                  </Pressable>
                </ScrollView>
              ) : (
                <Pressable style={styles.mediaDropzone} onPress={onAddMedia}>
                  <Ionicons name="camera-outline" size={24} color={withAlpha(theme.primary, 0.3)} />
                  <Text style={styles.mediaHint}>Tap to add photos or video</Text>
                </Pressable>
              )}

              <View style={styles.planToggleRow}>
                <View style={styles.planToggleCopy}>
                  <Text style={styles.planToggleTitle}>Add to training plan</Text>
                  <Text style={styles.planToggleSub}>Shows on your calendar for this date.</Text>
                </View>
                <Switch
                  value={addToPlan}
                  onValueChange={setAddToPlan}
                  trackColor={{ false: withAlpha(theme.primary, 0.15), true: theme.accent }}
                  thumbColor={theme.onPrimary}
                  ios_backgroundColor={withAlpha(theme.primary, 0.15)}
                />
              </View>

              <Pressable style={styles.saveButton} onPress={() => void handleSave()}>
                <Text style={styles.saveButtonText}>Save session</Text>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={12}>
                <Text style={styles.cancelLink}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
  keyboardRoot: {
    flex: 1,
  },
  modalInner: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha('#000000', 0.42),
  },
  sheet: {
    backgroundColor: theme.base,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 8,
    maxHeight: '92%',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: withAlpha(theme.primary, 0.2),
    marginBottom: 14,
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
  sheetTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 24,
    color: theme.primary,
    marginBottom: 18,
  },
  scrollContent: {
    gap: 14,
    paddingBottom: 12,
  },
  fieldLabel: {
    fontFamily: 'System',
    fontSize: 10,
    letterSpacing: 0.6,
    color: theme.accent,
    textTransform: 'uppercase',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.base,
    borderWidth: 1,
    borderColor: withAlpha(theme.primary, 0.15),
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  dateChevron: {
    padding: 4,
  },
  dateText: {
    fontFamily: 'System',
    fontSize: 14,
    color: theme.primary,
  },
  dateCenterButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  datePickerInlineCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: withAlpha(theme.primary, 0.15),
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  datePickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  datePickerGhostButton: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: withAlpha(theme.primary, 0.2),
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  datePickerGhostText: {
    fontFamily: 'System',
    fontSize: 12,
    color: theme.textMuted,
  },
  datePickerDoneButton: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.primary,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.primary,
  },
  datePickerDoneText: {
    fontFamily: 'System',
    fontSize: 12,
    color: theme.onPrimary,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillIdle: {
    backgroundColor: theme.base,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  pillActive: {
    backgroundColor: theme.primary,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  pillText: {
    fontFamily: 'System',
    fontSize: 12,
  },
  pillTextIdle: {
    color: theme.primary,
  },
  pillTextActive: {
    color: theme.onPrimary,
  },
  input: {
    backgroundColor: theme.base,
    borderWidth: 1,
    borderColor: withAlpha(theme.primary, 0.15),
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'System',
    fontSize: 14,
    color: theme.primary,
  },
  inputFlex: {
    flex: 1,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  unitToggle: {
    flexDirection: 'row',
    gap: 6,
  },
  unitChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 44,
    alignItems: 'center',
  },
  unitChipOn: {
    backgroundColor: theme.primary,
  },
  unitChipOff: {
    backgroundColor: theme.base,
    borderWidth: 1,
    borderColor: theme.primary,
  },
  unitChipText: {
    fontFamily: 'System',
    fontSize: 12,
  },
  unitChipTextOn: {
    color: theme.onPrimary,
  },
  unitChipTextOff: {
    color: theme.primary,
  },
  notesInput: {
    minHeight: 80,
    paddingTop: 12,
  },
  mediaDropzone: {
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: withAlpha(theme.primary, 0.15),
    backgroundColor: theme.base,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mediaHint: {
    fontFamily: 'System',
    fontSize: 13,
    color: withAlpha(theme.primary, 0.4),
  },
  mediaRow: {
    paddingTop: 2,
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
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreButton: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: withAlpha(theme.primary, 0.15),
    borderStyle: 'dashed',
    backgroundColor: theme.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  planToggleCopy: {
    flex: 1,
    gap: 4,
  },
  planToggleTitle: {
    fontFamily: 'System',
    fontSize: 13,
    color: theme.primary,
  },
  planToggleSub: {
    fontFamily: 'System',
    fontSize: 11,
    color: withAlpha(theme.primary, 0.4),
  },
  saveButton: {
    marginTop: 8,
    borderRadius: 999,
    backgroundColor: theme.primary,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveButtonText: {
    fontFamily: 'System',
    fontSize: 15,
    color: theme.onPrimary,
  },
  cancelLink: {
    textAlign: 'center',
    fontFamily: 'System',
    fontSize: 14,
    color: withAlpha(theme.primary, 0.4),
    marginTop: 12,
    marginBottom: 4,
  },
  });

import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FloatingPillNav } from '@/components/floating-pill-nav';
import { useTheme } from '@/contexts/ThemeContext';
import { useActiveAthlete, useCompletedSessionLogs } from '@/hooks/useSessionData';
import { datePickerAndroidMondayOpenProps, datePickerMondayWeekProps } from '@/lib/dates';
import { withAlpha } from '@/lib/theme-utils';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EARLIEST_SUPPORTED_DATE_ISO = '1970-01-01';

function toLocalIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveDateParam(value: string | string[] | undefined, fallbackIso: string) {
  if (typeof value !== 'string') return fallbackIso;
  return ISO_DATE_PATTERN.test(value) ? value : fallbackIso;
}

export default function ProgressHistoryScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ fromIso?: string; toIso?: string; period?: string }>();
  const [sessionType, setSessionType] = useState<'overall' | 'swim' | 'bike' | 'run'>('overall');
  const [pickerField, setPickerField] = useState<'from' | 'to' | null>(null);
  const initialFrom = resolveDateParam(params.fromIso, EARLIEST_SUPPORTED_DATE_ISO);
  const initialTo = resolveDateParam(params.toIso, toLocalIsoDate(new Date()));
  const [fromIso, setFromIso] = useState(initialFrom);
  const [toIso, setToIso] = useState(initialTo);

  const openDatePicker = (field: 'from' | 'to') => {
    const currentIso = field === 'from' ? fromIso : toIso;
    const value = new Date(`${currentIso}T00:00:00`);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        ...datePickerAndroidMondayOpenProps(),
        value,
        mode: 'date',
        onChange: (_e, selected) => {
          if (!selected) return;
          const nextIso = toLocalIsoDate(selected);
          if (field === 'from') {
            setFromIso(nextIso);
            if (nextIso > toIso) setToIso(nextIso);
          } else {
            setToIso(nextIso);
            if (nextIso < fromIso) setFromIso(nextIso);
          }
        },
      });
      return;
    }
    setPickerField(field);
  };

  const formatDateLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const { data: athlete } = useActiveAthlete();
  const { data: logs = [], isLoading } = useCompletedSessionLogs({
    athleteId: athlete?.id,
    fromIso,
    toIso,
    trainingType: sessionType,
  });
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={16} color={theme.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <Text style={styles.heading}>Session history</Text>
        </View>

        <View style={styles.dateRangeRow}>
          <Pressable style={styles.dateButton} onPress={() => openDatePicker('from')}>
            <Text style={styles.dateButtonLabel}>From</Text>
            <Text style={styles.dateButtonValue}>{formatDateLabel(fromIso)}</Text>
          </Pressable>
          <Pressable style={styles.dateButton} onPress={() => openDatePicker('to')}>
            <Text style={styles.dateButtonLabel}>To</Text>
            <Text style={styles.dateButtonValue}>{formatDateLabel(toIso)}</Text>
          </Pressable>
        </View>

        <View style={styles.segmentWrap}>
          {[
            { key: 'overall', label: 'All' },
            { key: 'swim', label: 'Swim' },
            { key: 'bike', label: 'Bike' },
            { key: 'run', label: 'Run' },
          ].map((option) => {
            const active = sessionType === option.key;
            return (
              <Pressable
                key={option.key}
                style={[styles.segmentChip, active ? styles.segmentChipActive : null]}
                onPress={() => setSessionType(option.key as 'overall' | 'swim' | 'bike' | 'run')}>
                <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {isLoading ? <Text style={styles.helperText}>Loading sessions...</Text> : null}
        {!isLoading && logs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No sessions in this period</Text>
            <Text style={styles.emptyBody}>Try changing the date filter on Progress.</Text>
          </View>
        ) : null}

        {logs.map((row: any) => (
          <Pressable key={row.id} style={styles.historyCard} onPress={() => router.push(`/SessionDetail?sessionId=${row.session_id}`)}>
            <View style={styles.historyCardHeader}>
              <View style={styles.historyCardBody}>
                <Text style={styles.historyTitle}>{row.sessions?.title ?? 'Session'}</Text>
                <Text style={styles.historyMeta}>
                  {new Date(row.completed_at).toLocaleDateString('en-AU')} · {row.sessions?.sport ?? 'other'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <Modal transparent visible={pickerField !== null && Platform.OS === 'ios'} animationType="fade" onRequestClose={() => setPickerField(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPickerField(null)} />
          <View style={styles.datePickerCard}>
            <DateTimePicker
              {...datePickerMondayWeekProps()}
              value={new Date(`${(pickerField === 'from' ? fromIso : toIso)}T00:00:00`)}
              mode="date"
              display="inline"
              {...(Platform.OS === 'ios' ? { accentColor: theme.accent, textColor: theme.text } : null)}
              onChange={(_e, selected) => {
                if (!selected || !pickerField) return;
                const nextIso = toLocalIsoDate(selected);
                if (pickerField === 'from') {
                  setFromIso(nextIso);
                  if (nextIso > toIso) setToIso(nextIso);
                } else {
                  setToIso(nextIso);
                  if (nextIso < fromIso) setFromIso(nextIso);
                }
              }}
            />
            <Pressable style={styles.doneButton} onPress={() => setPickerField(null)}>
              <Text style={styles.doneButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <FloatingPillNav active="progress" />
    </SafeAreaView>
  );
}

const createStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.base },
    content: { paddingHorizontal: 20, paddingBottom: 130, gap: 12 },
    backButton: {
      alignSelf: 'flex-start',
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 7,
      backgroundColor: theme.surface,
    },
    backButtonText: { fontFamily: 'DMSans-Medium', color: theme.primary, fontSize: 12 },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: -2,
    },
    heading: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 34, color: theme.primary },
    subHeading: {
      fontFamily: 'DMSans-Regular',
      fontSize: 13,
      color: theme.textMuted,
      marginTop: -2,
      marginBottom: 4,
    },
    dateRangeRow: {
      flexDirection: 'row',
      gap: 8,
    },
    dateButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      borderRadius: 12,
      backgroundColor: theme.surface,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2,
    },
    dateButtonLabel: {
      fontFamily: 'DMSans-Medium',
      fontSize: 11,
      color: theme.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    dateButtonValue: {
      fontFamily: 'DMSans-Medium',
      fontSize: 13,
      color: theme.text,
    },
    segmentWrap: {
      flexDirection: 'row',
      padding: 2,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.primary, 0.12),
      backgroundColor: theme.base,
      gap: 0,
    },
    segmentChip: {
      flex: 1,
      height: 30,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentChipActive: {
      backgroundColor: theme.surface,
    },
    segmentText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
      color: theme.textMuted,
    },
    segmentTextActive: {
      color: theme.text,
    },
    helperText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.textMuted,
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
      fontFamily: 'DMSans-SemiBold',
      fontSize: 14,
      color: theme.primary,
    },
    emptyBody: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.textMuted,
    },
    historyCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: `${theme.primary}1A`,
      backgroundColor: theme.surface,
      padding: 12,
      gap: 8,
    },
    historyCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    },
    historyCardBody: { flex: 1, gap: 2 },
    historyTitle: { fontFamily: 'DMSans-SemiBold', fontSize: 14, color: theme.primary },
    historyMeta: { fontFamily: 'DMSans-Regular', fontSize: 12, color: theme.textMuted },
    modalRoot: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    modalBackdrop: {
      ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    },
    datePickerCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 10,
    },
    doneButton: {
      alignSelf: 'flex-end',
      minHeight: 34,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
      backgroundColor: theme.primary,
    },
    doneButtonText: {
      fontFamily: 'DMSans-Medium',
      fontSize: 12,
      color: theme.onPrimary,
    },
  });

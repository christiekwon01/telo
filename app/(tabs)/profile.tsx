import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Alert,
  Linking,
  Modal,
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
import { RovaIntelligenceDevTools } from '@/components/RovaIntelligenceDevTools';
import { StatusAreaFade } from '@/components/status-area-fade';
import { TabHeader, TAB_SCREEN_CONTENT_PADDING_TOP, TAB_SCREEN_PADDING_HORIZONTAL } from '@/components/tab-header';
import { useTheme } from '@/contexts/ThemeContext';
import { sessionQueryKeys, useActiveAthlete } from '@/hooks/useSessionData';
import { journalQueryKeys } from '@/hooks/useJournalAndHabits';
import { useScrollToTopTabRef } from '@/hooks/useScrollToTopTabRef';
import { SINGLE_ACCOUNT_EMAIL } from '@/lib/single-account';
import {
  getAppleCalendarSubscriptionState,
  getAppleCalendarPrefs as loadApplePrefs,
} from '@/services/appleCalendarSync';
import { exportAllData } from '@/services/exportData';
import { resetTrainingDataForAthlete } from '@/services/resetTrainingData';
import {
  getHuaweiIntegrationState,
} from '@/services/huaweiHealthSync';
import { AthleteLevel } from '@/store/onboarding-store';
import { usePlanAdjustmentStore } from '@/store/plan-adjustment-store';
import { useSessionStore } from '@/store/session-store';
import { supabase } from '@/lib/supabase';

type SportBackground = 'beginner' | 'experienced' | 'competitive';
const SPORT_BACKGROUND_OPTIONS: SportBackground[] = ['beginner', 'experienced', 'competitive'];

const ATHLETE_LEVEL_OPTIONS: { key: AthleteLevel; meaning: string }[] = [
  { key: 'fara', meaning: 'To set out.' },
  { key: 'orka', meaning: 'To endure.' },
  { key: 'vinna', meaning: 'To achieve.' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const tabScrollRef = useScrollToTopTabRef();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { theme, themes, setThemeById } = useTheme();
  const { data: athlete } = useActiveAthlete();
  const [nameDraft, setNameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [savingAccountField, setSavingAccountField] = useState<'name' | 'email' | null>(null);
  const [accountFieldErrorField, setAccountFieldErrorField] = useState<'name' | 'email' | null>(null);
  const [accountFieldError, setAccountFieldError] = useState<string | null>(null);
  const [isEditingLevel, setIsEditingLevel] = useState(false);
  const [levelDraft, setLevelDraft] = useState<AthleteLevel>('fara');
  const [swimBackgroundDraft, setSwimBackgroundDraft] = useState<SportBackground>('beginner');
  const [bikeBackgroundDraft, setBikeBackgroundDraft] = useState<SportBackground>('beginner');
  const [runBackgroundDraft, setRunBackgroundDraft] = useState<SportBackground>('beginner');
  const [isSavingLevel, setIsSavingLevel] = useState(false);
  const [levelSaveError, setLevelSaveError] = useState<string | null>(null);
  const [rovaDevOpen, setRovaDevOpen] = useState(false);
  const [huaweiConnected, setHuaweiConnected] = useState(false);
  const [applePrefs, setApplePrefs] = useState<Awaited<ReturnType<typeof loadApplePrefs>> | null>(null);
  const [appleSubscriptionConfigured, setAppleSubscriptionConfigured] = useState(false);
  const [showExportSheet, setShowExportSheet] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ step: string; percent: number } | null>(null);
  const [isResettingTrainingData, setIsResettingTrainingData] = useState(false);
  /** Web: `window.confirm` is often blocked (iframe, embed, strict policies); use an in-app sheet instead. */
  const [resetTrainingConfirmOpen, setResetTrainingConfirmOpen] = useState(false);
  /** Name/email are read-only until the user taps Logout (single-account flow). */
  const [accountContactEditable, setAccountContactEditable] = useState(false);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const athleteLevel = (athlete?.level as AthleteLevel | undefined) ?? 'fara';
  const swimBackground = (athlete?.swim_background as SportBackground | undefined) ?? 'beginner';
  const bikeBackground = (athlete?.bike_background as SportBackground | undefined) ?? 'beginner';
  const runBackground = (athlete?.run_background as SportBackground | undefined) ?? 'beginner';

  useEffect(() => {
    setLevelDraft(athleteLevel);
  }, [athleteLevel]);

  useEffect(() => {
    setNameDraft(athlete?.name ?? '');
    setEmailDraft(athlete?.email ?? '');
  }, [athlete?.email, athlete?.name]);

  const loadIntegrationPrefs = useCallback(async () => {
    const [huaweiState, apple, appleSubscription] = await Promise.all([
      getHuaweiIntegrationState(),
      loadApplePrefs(),
      getAppleCalendarSubscriptionState(athlete?.id ?? null),
    ]);
    setHuaweiConnected(huaweiState.connected);
    setApplePrefs(apple);
    setAppleSubscriptionConfigured(appleSubscription.configured);
  }, [athlete?.id]);

  useEffect(() => {
    void loadIntegrationPrefs();
  }, [loadIntegrationPrefs]);

  useFocusEffect(
    useCallback(() => {
      void loadIntegrationPrefs();
      return () => setAccountContactEditable(false);
    }, [loadIntegrationPrefs])
  );

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    Alert.alert(message);
  };

  const saveAccountField = async (field: 'name' | 'email', rawValue: string) => {
    if (!athlete?.id) return;

    const nextValue = rawValue.trim();

    if (field === 'name' && nextValue.length === 0) {
      setAccountFieldErrorField('name');
      setAccountFieldError('Name cannot be empty.');
      return;
    }

    if (field === 'email' && nextValue.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextValue)) {
      setAccountFieldErrorField('email');
      setAccountFieldError('Enter a valid email address.');
      return;
    }

    const currentValue = field === 'name' ? (athlete.name ?? '').trim() : (athlete.email ?? '').trim();
    if (nextValue === currentValue) {
      return;
    }

    setSavingAccountField(field);
    setAccountFieldErrorField(null);
    setAccountFieldError(null);
    const updatePayload = field === 'name' ? { name: nextValue } : { email: nextValue.length === 0 ? null : nextValue };
    const { error } = await supabase.from('athletes').update(updatePayload).eq('id', athlete.id);

    if (error) {
      setAccountFieldErrorField(field);
      setAccountFieldError(error.message);
      setSavingAccountField(null);
      Alert.alert(field === 'name' ? 'Could not update name' : 'Could not update email', error.message);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() });
    setSavingAccountField(null);
  };

  const openEditLevel = () => {
    setLevelDraft(athleteLevel);
    setSwimBackgroundDraft(swimBackground);
    setBikeBackgroundDraft(bikeBackground);
    setRunBackgroundDraft(runBackground);
    setLevelSaveError(null);
    setIsEditingLevel(true);
  };

  const saveEditedLevel = async () => {
    if (!athlete?.id) {
      setIsEditingLevel(false);
      return;
    }
    const targetLevel = levelDraft;
    if (
      targetLevel === athleteLevel &&
      swimBackgroundDraft === swimBackground &&
      bikeBackgroundDraft === bikeBackground &&
      runBackgroundDraft === runBackground
    ) {
      setIsEditingLevel(false);
      return;
    }
    setIsSavingLevel(true);
    setLevelSaveError(null);
    const { error } = await supabase
      .from('athletes')
      .update({
        level: targetLevel,
        swim_background: swimBackgroundDraft,
        bike_background: bikeBackgroundDraft,
        run_background: runBackgroundDraft,
      })
      .eq('id', athlete.id);
    if (error) {
      setIsSavingLevel(false);
      setLevelSaveError(error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.activeAthlete() });
    setIsSavingLevel(false);
    setIsEditingLevel(false);
  };

  const themeDescription = (themeId: string) => {
    if (themeId === 'navyAmber') return 'Navy + Amber';
    if (themeId === 'burgundyChampagne') return 'Burgundy + Champagne';
    if (themeId === 'obsidianIce') return 'Obsidian + Ice';
    return 'Slate + Citrus';
  };

  const handleDataExport = async (format: 'json' | 'csv') => {
    if (!athlete?.id) return;
    setExportBusy(true);
    setExportProgress({ step: 'Preparing export', percent: 0 });
    try {
      await exportAllData(athlete.id, format, (progress) => setExportProgress(progress));
      showToast(format === 'json' ? 'JSON export ready' : 'CSV zip export ready');
      setShowExportSheet(false);
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setExportBusy(false);
      setExportProgress(null);
    }
  };

  const executeResetTrainingData = async () => {
    if (!athlete?.id) return;
    setIsResettingTrainingData(true);
    try {
      await resetTrainingDataForAthlete(athlete.id);

      useSessionStore.setState({ completedSessions: {}, sessionDrafts: {} });
      usePlanAdjustmentStore.setState({ queue: [] });

      try {
        const keys = await AsyncStorage.getAllKeys();
        const weeklyKeys = keys.filter((k) => k.startsWith('weekly_intention:'));
        if (weeklyKeys.length > 0) {
          await AsyncStorage.multiRemove(weeklyKeys);
        }
      } catch {
        /* ignore */
      }

      try {
        await AsyncStorage.removeItem('telo:rova:last-generated-at');
      } catch {
        /* ignore */
      }

      await queryClient.resetQueries({ queryKey: sessionQueryKeys.all });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['session_logs'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
        queryClient.invalidateQueries({ queryKey: ['personal_bests'] }),
        queryClient.invalidateQueries({ queryKey: sessionQueryKeys.personalBests(athlete.id) }),
        queryClient.invalidateQueries({ queryKey: ['personal_bests', 'session_logs', athlete.id] }),
        queryClient.invalidateQueries({ queryKey: ['session_logs', 'count', athlete.id] }),
        queryClient.invalidateQueries({ queryKey: ['rova_challenges'] }),
        queryClient.invalidateQueries({ queryKey: ['rova_coach_directive'] }),
        queryClient.invalidateQueries({ queryKey: journalQueryKeys.all }),
      ]);
      showToast('Training data reset');
    } catch (error) {
      Alert.alert('Could not reset data', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsResettingTrainingData(false);
    }
  };

  const trainingDataResetExplanation =
    'This permanently deletes all your planned and completed sessions, completion logs, step-by-step blocks, personal bests, Rova challenges, and flex-week history. Plan and week views refresh so the calendar clears. Your active plan row and goal races are not removed. This cannot be undone.';

  const handleResetTrainingData = () => {
    if (isResettingTrainingData) return;
    if (!athlete?.id) {
      showToast('Sign in or finish onboarding before resetting training data.');
      return;
    }

    if (Platform.OS === 'web') {
      setResetTrainingConfirmOpen(true);
      return;
    }

    Alert.alert('Reset all training data?', trainingDataResetExplanation, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: () => {
          void executeResetTrainingData();
        },
      },
    ]);
  };

  const handleLogout = async () => {
    Alert.alert(
      'Single account mode',
      `Logout is temporarily disabled.\n\nThis app is currently locked to ${SINGLE_ACCOUNT_EMAIL}.\n\nYou can edit your name and email after you close this message.`,
      [{ text: 'OK', onPress: () => setAccountContactEditable(true) }]
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusAreaFade height={insets.top + 8} />
      <ScrollView
        ref={tabScrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}>
        <TabHeader title="Profile" />
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Account</Text>
          {!accountContactEditable ? (
            <Text style={styles.accountLockHint}>Tap Logout below to edit name and email.</Text>
          ) : null}
          <View style={styles.inlineEditRow}>
            <View style={styles.inlineRow}>
              <Text style={styles.rowLabel}>Name</Text>
              {accountContactEditable ? (
                <TextInput
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  selectTextOnFocus
                  onFocus={() => {
                    if (accountFieldErrorField === 'name') {
                      setAccountFieldErrorField(null);
                      setAccountFieldError(null);
                    }
                  }}
                  onBlur={() => void saveAccountField('name', nameDraft)}
                  placeholder="Your name"
                  placeholderTextColor={theme.textMuted}
                  style={styles.inlineInput}
                />
              ) : (
                <Text style={styles.inlineLockedValue} numberOfLines={1}>
                  {nameDraft.trim() ? nameDraft : '—'}
                </Text>
              )}
            </View>
            {savingAccountField === 'name' ? <Text style={styles.inlineHelperText}>Saving...</Text> : null}
            {accountFieldErrorField === 'name' && accountFieldError ? (
              <Text style={styles.inlineErrorText}>{accountFieldError}</Text>
            ) : null}
          </View>
          <View style={styles.inlineEditRow}>
            <View style={styles.inlineRow}>
              <Text style={styles.rowLabel}>Email</Text>
              {accountContactEditable ? (
                <TextInput
                  value={emailDraft}
                  onChangeText={setEmailDraft}
                  selectTextOnFocus
                  onFocus={() => {
                    if (accountFieldErrorField === 'email') {
                      setAccountFieldErrorField(null);
                      setAccountFieldError(null);
                    }
                  }}
                  onBlur={() => void saveAccountField('email', emailDraft)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="name@example.com"
                  placeholderTextColor={theme.textMuted}
                  style={styles.inlineInput}
                />
              ) : (
                <Text style={styles.inlineLockedValue} numberOfLines={1}>
                  {emailDraft.trim() ? emailDraft : '—'}
                </Text>
              )}
            </View>
            {savingAccountField === 'email' ? <Text style={styles.inlineHelperText}>Saving...</Text> : null}
            {accountFieldErrorField === 'email' && accountFieldError ? (
              <Text style={styles.inlineErrorText}>{accountFieldError}</Text>
            ) : null}
          </View>
          <Pressable style={styles.row} onPress={openEditLevel}>
            <Text style={styles.rowLabel}>Level</Text>
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>{athleteLevel}</Text>
              <View style={styles.levelDot} />
            </View>
          </Pressable>
          <Pressable style={styles.row} onPress={() => router.push('/goal-races')}>
            <Text style={styles.rowLabel}>Goal race(s)</Text>
            <View style={styles.goalRaceValueWrap}>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </View>
          </Pressable>
        </View>

        <View style={styles.themeSection}>
          <Text style={styles.themeHeading}>Theme</Text>
          <View style={styles.themeGrid}>
            {themes.map((option) => {
              const selected = option.id === theme.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => void setThemeById(option.id)}
                  style={[styles.themeCard, selected ? styles.themeCardSelected : null]}>
                  <View style={styles.swatchRow}>
                    <View style={[styles.swatchDot, { backgroundColor: option.base }]} />
                    <View style={[styles.swatchDot, { backgroundColor: option.primary }]} />
                    <View style={[styles.swatchDot, { backgroundColor: option.accent }]} />
                  </View>
                  <Text style={styles.themeName}>{themeDescription(option.id)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Integration Summary</Text>
          <Pressable style={styles.row} onPress={() => router.push('/huawei-health')}>
            <Text style={styles.rowLabel}>Huawei Health</Text>
            <View style={styles.goalRaceValueWrap}>
              <Text style={styles.rowValue}>{huaweiConnected ? 'Import via file (native connected)' : 'Import via file'}</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </View>
          </Pressable>
          <Pressable style={styles.row} onPress={() => router.push('/apple-calendar')}>
            <Text style={styles.rowLabel}>Apple Calendar</Text>
            <View style={styles.goalRaceValueWrap}>
              <Text style={styles.rowValue}>
                {appleSubscriptionConfigured
                  ? 'Subscription link ready'
                  : Platform.OS === 'ios'
                    ? applePrefs?.enabled
                      ? 'Direct sync enabled'
                      : 'Not configured'
                    : 'Not configured'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </View>
          </Pressable>
          <Pressable style={styles.row} onPress={() => router.push('/onboarding')}>
            <Text style={styles.rowLabel}>Onboarding</Text>
            <View style={styles.goalRaceValueWrap}>
              <Text style={styles.rowValue}>Open</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </View>
          </Pressable>
          <Pressable style={styles.row} onPress={() => router.push('/template-plan')}>
            <Text style={styles.rowLabel}>Template plan</Text>
            <View style={styles.goalRaceValueWrap}>
              <Text style={styles.rowValue}>Edit & apply</Text>
              <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
            </View>
          </Pressable>
          <Pressable style={styles.row} onPress={() => setShowExportSheet(true)}>
            <Text style={styles.rowLabel}>Personal data export</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.row, styles.resetRow]}
            disabled={isResettingTrainingData}
            onPress={handleResetTrainingData}
            accessibilityRole="button">
            <Text style={styles.resetLabel}>Reset training data</Text>
            <Text style={styles.resetValue}>{isResettingTrainingData ? 'Deleting...' : 'Delete all sessions'}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.devLabel}>Rova intelligence</Text>
          <Pressable style={styles.devButton} onPress={() => setRovaDevOpen(true)}>
            <Text style={styles.devButtonText}>Open challenges, chat, and flex tools</Text>
          </Pressable>
        </View>

        <Pressable style={styles.logoutButton} onPress={() => void handleLogout()}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </ScrollView>
      <Modal transparent visible={isEditingLevel} animationType="none" onRequestClose={() => setIsEditingLevel(false)}>
        <View style={styles.levelModalRoot}>
          <Pressable style={styles.modalOverlay} onPress={() => setIsEditingLevel(false)} />
          <View style={[styles.modalCard, styles.levelModalCard, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
            <View style={styles.modalHandle} />
            <Pressable style={styles.modalCloseButton} onPress={() => setIsEditingLevel(false)} hitSlop={8}>
              <Ionicons name="close" size={16} color={theme.primary} />
            </Pressable>
            {ATHLETE_LEVEL_OPTIONS.map((option) => {
              const isSelected = option.key === levelDraft;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.levelOptionRow, isSelected ? styles.levelOptionRowSelected : null]}
                  disabled={isSavingLevel}
                  onPress={() => setLevelDraft(option.key)}>
                  <View style={styles.levelOptionCopy}>
                    <Text style={styles.levelOptionTitle}>{option.key}</Text>
                    <Text style={styles.levelOptionMeaning} numberOfLines={1}>
                      {option.meaning}
                    </Text>
                  </View>
                  {isSelected ? <Ionicons name="checkmark-circle" size={18} color={theme.accent} /> : null}
                </Pressable>
              );
            })}
            <Text style={styles.levelModalSectionLabel}>Background by discipline</Text>
            {([
              ['swim', swimBackgroundDraft, setSwimBackgroundDraft],
              ['bike', bikeBackgroundDraft, setBikeBackgroundDraft],
              ['run', runBackgroundDraft, setRunBackgroundDraft],
            ] as const).map(([label, value, setter]) => (
              <View key={label} style={styles.levelBgRow}>
                <Text style={styles.levelBgSport}>{label}</Text>
                <View style={styles.levelBgChoices}>
                  {SPORT_BACKGROUND_OPTIONS.map((option) => {
                    const selected = value === option;
                    return (
                      <Pressable
                        key={`${label}-${option}`}
                        style={[styles.levelBgChip, selected ? styles.levelBgChipSelected : null]}
                        onPress={() => setter(option)}
                        disabled={isSavingLevel}>
                        <Text style={[styles.levelBgChipText, selected ? styles.levelBgChipTextSelected : null]}>
                          {option}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            {levelSaveError ? <Text style={styles.modalErrorText}>Could not update level: {levelSaveError}</Text> : null}
            {isSavingLevel ? <Text style={styles.helperText}>Saving level...</Text> : null}
            <Pressable style={[styles.modalAction, styles.levelModalAction]} disabled={isSavingLevel} onPress={() => void saveEditedLevel()}>
              <Text style={styles.modalActionText}>{isSavingLevel ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal transparent visible={showExportSheet} animationType="fade" onRequestClose={() => setShowExportSheet(false)}>
        <View style={styles.levelModalRoot}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowExportSheet(false)} />
          <View style={[styles.modalCard, styles.levelModalCard, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
            <View style={styles.modalHandle} />
            <Pressable style={styles.modalCloseButton} onPress={() => setShowExportSheet(false)} hitSlop={8}>
              <Ionicons name="close" size={16} color={theme.primary} />
            </Pressable>
            <Text style={styles.modalTitle}>Export your data</Text>
            <Text style={styles.modalBody}>
              GDPR-friendly data portability export. Your file contains training profile, plans, sessions, logs, challenges, conversations, flex history and race goals.
            </Text>
            <Pressable style={styles.row} onPress={() => void handleDataExport('json')} disabled={exportBusy}>
              <Text style={styles.rowLabel}>Export as JSON</Text>
              <Ionicons name="download-outline" size={16} color={theme.textMuted} />
            </Pressable>
            <Pressable style={styles.row} onPress={() => void handleDataExport('csv')} disabled={exportBusy}>
              <Text style={styles.rowLabel}>Export as CSV ZIP</Text>
              <Ionicons name="download-outline" size={16} color={theme.textMuted} />
            </Pressable>
            {exportProgress ? (
              <Text style={styles.inlineHelperText}>
                {exportProgress.step} ({exportProgress.percent}%)
              </Text>
            ) : null}
            <Pressable onPress={() => void Linking.openURL('https://telo.app/privacy')}>
              <Text style={styles.linkText}>Privacy policy</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {Platform.OS === 'web' ? (
        <Modal
          transparent
          visible={resetTrainingConfirmOpen}
          animationType="fade"
          onRequestClose={() => setResetTrainingConfirmOpen(false)}>
          <View style={styles.levelModalRoot}>
            <Pressable style={styles.modalOverlay} onPress={() => setResetTrainingConfirmOpen(false)} />
            <View style={[styles.modalCard, styles.levelModalCard, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
              <View style={styles.modalHandle} />
              <Pressable style={styles.modalCloseButton} onPress={() => setResetTrainingConfirmOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={16} color={theme.primary} />
              </Pressable>
              <Text style={styles.modalTitle}>Reset all training data?</Text>
              <Text style={styles.modalBody}>{trainingDataResetExplanation}</Text>
              <Pressable
                style={styles.modalDangerAction}
                onPress={() => {
                  setResetTrainingConfirmOpen(false);
                  void executeResetTrainingData();
                }}>
                <Text style={styles.modalDangerActionText}>Delete all sessions</Text>
              </Pressable>
              <Pressable style={[styles.modalAction, styles.resetModalCancel]} onPress={() => setResetTrainingConfirmOpen(false)}>
                <Text style={styles.modalActionText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
      <RovaIntelligenceDevTools
        visible={rovaDevOpen}
        onClose={() => setRovaDevOpen(false)}
        athleteId={athlete?.id}
      />
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
    paddingHorizontal: TAB_SCREEN_PADDING_HORIZONTAL,
    paddingTop: TAB_SCREEN_CONTENT_PADDING_TOP,
    paddingBottom: 140,
  },
  subHeading: {
    marginTop: 2,
    fontFamily: 'DMSans-Regular',
    fontSize: 16,
    color: theme.primary,
    opacity: 0.6,
  },
  compactHeaderText: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 22,
    color: theme.primary,
  },
  card: {
    marginBottom: 16,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: `${theme.primary}1A`,
    padding: 14,
  },
  sectionLabel: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: theme.textMuted,
    marginBottom: 10,
  },
  accountLockHint: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: theme.textMuted,
    marginTop: -4,
    marginBottom: 10,
  },
  row: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  resetRow: {
    borderTopWidth: 1,
    borderTopColor: `${theme.accent}33`,
    marginTop: 6,
    paddingTop: 10,
  },
  resetLabel: {
    fontFamily: 'DMSans-Medium',
    fontSize: 13,
    color: theme.accent,
  },
  resetValue: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: theme.accent,
    opacity: 0.85,
    textAlign: 'right',
  },
  linkText: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: theme.accent,
  },
  rowLabel: {
    fontFamily: 'DMSans-Medium',
    fontSize: 13,
    color: theme.text,
  },
  rowValue: {
    fontFamily: 'DMSans-Regular',
    fontSize: 13,
    color: theme.textMuted,
    flexShrink: 1,
    textAlign: 'right',
  },
  goalRaceValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '70%',
  },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  levelBadgeText: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 18,
    color: theme.primary,
    textTransform: 'capitalize',
  },
  levelDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
  themeSection: {
    marginBottom: 16,
  },
  themeHeading: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 11,
    color: theme.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  themeCard: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  themeCardSelected: {
    borderWidth: 2,
    borderColor: theme.accent,
  },
  swatchRow: {
    flexDirection: 'row',
    gap: 6,
  },
  swatchDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  themeName: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: theme.text,
  },
  devLabel: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: theme.textMuted,
    marginBottom: 10,
  },
  devButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    marginBottom: 0,
    alignSelf: 'stretch',
  },
  devButtonText: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: theme.primary,
    textAlign: 'center',
  },
  logoutButton: {
    marginTop: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.primary,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  logoutText: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 14,
    color: theme.primary,
  },
  levelModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  modalCard: {
    borderRadius: 12,
    backgroundColor: theme.surface,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 8,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: `${theme.textMuted}55`,
    marginBottom: 12,
  },
  levelModalCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '92%',
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
  modalTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 30,
    color: theme.primary,
  },
  modalBody: {
    fontFamily: 'DMSans-Regular',
    fontSize: 13,
    color: theme.text,
  },
  inlineInput: {
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
    minHeight: 32,
    fontFamily: 'DMSans-Regular',
    fontSize: 13,
    color: theme.textMuted,
    textAlign: 'right',
  },
  inlineLockedValue: {
    flex: 1,
    minHeight: 32,
    fontFamily: 'DMSans-Regular',
    fontSize: 13,
    color: theme.textMuted,
    textAlign: 'right',
    paddingTop: 6,
  },
  inlineEditRow: {
    minHeight: 42,
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  inlineRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  inlineHelperText: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: theme.textMuted,
  },
  inlineErrorText: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: theme.danger,
  },
  helperText: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: theme.textMuted,
  },
  modalAction: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalActionText: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: theme.primary,
  },
  resetModalCancel: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  modalDangerAction: {
    alignSelf: 'stretch',
    marginTop: 8,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.danger,
  },
  modalDangerActionText: {
    fontFamily: 'DMSans-SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  levelOptionRow: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  levelOptionRowSelected: {
    borderColor: theme.accent,
    backgroundColor: `${theme.accent}14`,
  },
  levelOptionCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginRight: 10,
  },
  levelOptionTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 20,
    color: theme.primary,
    textTransform: 'capitalize',
    lineHeight: 20,
  },
  levelOptionMeaning: {
    fontFamily: 'DMSans-Regular',
    fontSize: 11,
    color: theme.textMuted,
    textAlign: 'right',
  },
  levelModalSectionLabel: {
    marginTop: 10,
    fontFamily: 'DMSans-SemiBold',
    fontSize: 12,
    color: theme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  levelBgRow: {
    gap: 8,
    marginTop: 2,
  },
  levelBgSport: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: theme.text,
    textTransform: 'capitalize',
  },
  levelBgChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  levelBgChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.surface,
  },
  levelBgChipSelected: {
    borderColor: theme.accent,
    backgroundColor: `${theme.accent}14`,
  },
  levelBgChipText: {
    fontFamily: 'DMSans-Medium',
    fontSize: 12,
    color: theme.textMuted,
  },
  levelBgChipTextSelected: {
    color: theme.accent,
  },
  levelModalAction: {
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  modalErrorText: {
    fontFamily: 'DMSans-Regular',
    fontSize: 12,
    color: theme.danger,
  },
});


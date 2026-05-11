import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useActiveAthlete } from '@/hooks/useSessionData';
import {
  createTeloCalendar,
  getAppleCalendarSubscriptionState,
  getAppleCalendarPrefs,
  isAppleCalendarSupported,
  refreshAppleCalendarSubscriptionState,
  requestCalendarPermission,
  resolveAppleCalendarId,
  syncSessionsToCalendar,
  updateAppleCalendarPrefs,
} from '@/services/appleCalendarSync';

export default function AppleCalendarScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { data: athlete } = useActiveAthlete();
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof getAppleCalendarPrefs>> | null>(null);
  const [isSupported, setIsSupported] = useState(Platform.OS === 'ios');
  const [busy, setBusy] = useState(false);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);
  const [subscriptionUrl, setSubscriptionUrl] = useState<string>('');
  const [subscriptionConfigured, setSubscriptionConfigured] = useState(false);

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    Alert.alert(message);
  };

  const refreshState = useCallback(async () => {
    const [next, subscription] = await Promise.all([
      getAppleCalendarPrefs(),
      getAppleCalendarSubscriptionState(athlete?.id ?? null),
    ]);
    setPrefs(next);
    setSubscriptionConfigured(subscription.configured);
    setSubscriptionUrl(subscription.url ?? '');
  }, [athlete?.id]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useFocusEffect(
    useCallback(() => {
      void refreshState();
    }, [refreshState])
  );

  useEffect(() => {
    const loadSupport = async () => {
      const supported = await isAppleCalendarSupported();
      setIsSupported(supported);
    };
    void loadSupport();
  }, []);

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    router.replace('/(tabs)/profile');
  };

  const handleEnable = async (enabled: boolean) => {
    if (!prefs) return;
    if (!isSupported) {
      Alert.alert('Apple Calendar unavailable', 'Apple Calendar sync is only available on iOS devices.');
      return;
    }
    setBusy(true);
    try {
      if (enabled) {
        const permission = await requestCalendarPermission();
        if (!permission.granted) {
          Alert.alert('Permission needed', 'Calendar permission is required. Open Settings > Privacy & Security > Calendars and allow Telo access.');
          return;
        }
        let calendarId = await resolveAppleCalendarId(prefs.calendarId);
        if (!calendarId) calendarId = await createTeloCalendar();
        if (!calendarId) {
          Alert.alert(
            'Calendar setup failed',
            'Could not create/select the Telo Training calendar. Make sure iCloud Calendar is enabled, then try again.'
          );
          return;
        }
        await updateAppleCalendarPrefs({ enabled: true, calendarId });
        if (athlete?.id) {
          await syncSessionsToCalendar(athlete.id, calendarId, new Date());
        }
        await refreshState();
        return;
      }
      await updateAppleCalendarPrefs({ enabled: false });
      await refreshState();
    } catch (error) {
      Alert.alert('Apple Calendar sync failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleRemoveCompleted = async () => {
    if (!prefs) return;
    setBusy(true);
    try {
      await updateAppleCalendarPrefs({ removeCompleted: !prefs.removeCompleted });
      await refreshState();
    } catch (error) {
      Alert.alert('Could not update setting', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleCycleDefaultTime = async () => {
    const order: ('6am' | '12pm' | '6pm')[] = ['6am', '12pm', '6pm'];
    const current = prefs?.defaultSessionTime ?? '6am';
    const next = order[(order.indexOf(current) + 1) % order.length];
    setBusy(true);
    try {
      await updateAppleCalendarPrefs({ defaultSessionTime: next });
      await refreshState();
    } catch (error) {
      Alert.alert('Could not update setting', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleCycleSyncRange = async () => {
    const order: ('week' | 'two_weeks' | 'month')[] = ['week', 'two_weeks', 'month'];
    const current = prefs?.syncRange ?? 'week';
    const next = order[(order.indexOf(current) + 1) % order.length];
    setBusy(true);
    try {
      await updateAppleCalendarPrefs({ syncRange: next });
      await refreshState();
    } catch (error) {
      Alert.alert('Could not update setting', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    if (!isSupported) {
      Alert.alert('Apple Calendar unavailable', 'Apple Calendar sync is only available on iOS devices.');
      return;
    }
    if (!athlete?.id) {
      Alert.alert('Sync unavailable', 'No active athlete profile was found. Complete onboarding and try again.');
      return;
    }
    if (!prefs?.enabled) {
      Alert.alert('Sync disabled', 'Enable Apple Calendar sync first.');
      return;
    }
    if (!prefs.calendarId) {
      Alert.alert('Calendar missing', 'No calendar is selected. Turn Apple Calendar sync off and on to create a calendar, then sync again.');
      return;
    }
    setBusy(true);
    try {
      await syncSessionsToCalendar(athlete.id, prefs.calendarId, new Date());
      showToast('Apple Calendar synced');
    } catch (error) {
      Alert.alert('Apple Calendar sync failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleSubscribe = async () => {
    if (!subscriptionUrl) {
      Alert.alert(
        'Subscription link unavailable',
        'A subscription URL could not be generated yet. Tap Refresh URL to generate one.'
      );
      return;
    }
    setSubscriptionBusy(true);
    try {
      const supported = await Linking.canOpenURL(subscriptionUrl);
      if (!supported) {
        Alert.alert('Cannot open link', 'Your device could not open this subscription URL.');
        return;
      }
      await Linking.openURL(subscriptionUrl);
    } catch (error) {
      Alert.alert('Could not open subscription', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const handleCopySubscription = async () => {
    if (!subscriptionUrl) {
      Alert.alert('Nothing to copy', 'Generate a subscription URL first.');
      return;
    }
    setSubscriptionBusy(true);
    try {
      await Clipboard.setStringAsync(subscriptionUrl);
      showToast('Subscription URL copied');
    } catch (error) {
      Alert.alert('Copy failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSubscriptionBusy(false);
    }
  };

  const handleRefreshSubscription = async () => {
    setSubscriptionBusy(true);
    try {
      const next = await refreshAppleCalendarSubscriptionState(athlete?.id ?? null);
      setSubscriptionConfigured(next.configured);
      setSubscriptionUrl(next.url ?? '');
      if (!next.configured) {
        Alert.alert(
          'Subscription link unavailable',
          'Telo could not generate a subscription URL. Check your calendar endpoint configuration and try again.'
        );
      } else {
        showToast('Subscription URL refreshed');
      }
    } catch (error) {
      Alert.alert('Refresh failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSubscriptionBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.backButton} onPress={handleBack} accessibilityRole="button">
          <Ionicons name="chevron-back" size={16} color={theme.primary} />
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View style={styles.titleRow}>
            <Ionicons name="calendar-outline" size={28} color={theme.primary} />
            <Text style={styles.heading}>Apple Calendar sync</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Apple Calendar subscription</Text>
          <Text style={styles.helperText}>
            Subscribe once and Apple Calendar auto-refreshes updates from Telo. Use this link on iPhone or Mac.
          </Text>
          <Pressable
            style={[styles.primaryButton, (!subscriptionConfigured || subscriptionBusy) ? styles.actionButtonDisabled : null]}
            disabled={!subscriptionConfigured || subscriptionBusy}
            onPress={() => void handleSubscribe()}>
            <Text style={styles.primaryButtonText}>{subscriptionBusy ? 'Opening...' : 'Subscribe in Apple Calendar'}</Text>
          </Pressable>
          <TextInput
            style={[styles.urlInput, !subscriptionConfigured ? styles.urlInputDisabled : null]}
            editable={false}
            value={
              subscriptionConfigured
                ? subscriptionUrl
                : 'Not configured yet. Tap Refresh URL to generate your personal subscription link.'
            }
            multiline
          />
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.actionButton, (!subscriptionConfigured || subscriptionBusy) ? styles.actionButtonDisabled : null]}
              disabled={!subscriptionConfigured || subscriptionBusy}
              onPress={() => void handleCopySubscription()}>
              <Text style={styles.actionButtonText}>Copy URL</Text>
            </Pressable>
            <Pressable style={[styles.actionButton, subscriptionBusy ? styles.actionButtonDisabled : null]} disabled={subscriptionBusy} onPress={() => void handleRefreshSubscription()}>
              <Text style={styles.actionButtonText}>Refresh URL</Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>
            Mac steps: Calendar app {'->'} File {'->'} New Calendar Subscription {'->'} paste the URL {'->'} choose refresh interval.
          </Text>
        </View>

        {!isSupported ? (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Device status</Text>
            <Text style={styles.helperText}>Direct event-write sync is available on iOS only.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Direct event-write sync (optional)</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Enable sync</Text>
              <Pressable disabled={busy} onPress={() => void handleEnable(!(prefs?.enabled ?? false))}>
                <Text style={styles.linkText}>{prefs?.enabled ? 'On' : 'Off'}</Text>
              </Pressable>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Remove completed</Text>
              <Pressable disabled={busy} onPress={() => void handleToggleRemoveCompleted()}>
                <Text style={styles.linkText}>{prefs?.removeCompleted ? 'On' : 'Off'}</Text>
              </Pressable>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Default time</Text>
              <Pressable disabled={busy} onPress={() => void handleCycleDefaultTime()}>
                <Text style={styles.linkText}>{prefs?.defaultSessionTime ?? '6am'}</Text>
              </Pressable>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Sync range</Text>
              <Pressable disabled={busy} onPress={() => void handleCycleSyncRange()}>
                <Text style={styles.linkText}>{prefs?.syncRange ?? 'week'}</Text>
              </Pressable>
            </View>
            <Pressable style={styles.actionButton} disabled={busy || !prefs?.enabled} onPress={() => void handleSyncNow()}>
              <Text style={styles.actionButtonText}>{busy ? 'Syncing...' : 'Sync now'}</Text>
            </Pressable>
          </View>
        )}        
      </ScrollView>
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
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    heading: {
      fontFamily: 'CormorantGaramond_700Bold',
      fontSize: 34,
      color: theme.primary,
    },
    card: {
      borderRadius: 14,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: `${theme.primary}1A`,
      padding: 14,
      gap: 8,
    },
    sectionLabel: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      color: theme.textMuted,
      marginBottom: 2,
    },
    row: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    rowLabel: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 13,
      color: theme.text,
    },
    helperText: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
    },
    linkText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.accent,
    },
    actionButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: 'transparent',
      alignSelf: 'flex-start',
      marginTop: 2,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 2,
    },
    primaryButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: theme.primary,
      alignSelf: 'flex-start',
      marginTop: 2,
    },
    primaryButtonText: {
      fontFamily: 'DMSans_600SemiBold',
      fontSize: 12,
      color: theme.base,
    },
    urlInput: {
      minHeight: 54,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.base,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.text,
      textAlignVertical: 'top',
    },
    urlInputDisabled: {
      color: theme.textMuted,
    },
    actionButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.primary,
    },
    actionButtonDisabled: {
      opacity: 0.5,
    },
    actionButtonTextDisabled: {
      color: theme.textMuted,
    },
  });

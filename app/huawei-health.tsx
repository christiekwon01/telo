import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useActiveAthlete } from '@/hooks/useSessionData';
import {
  connectHuaweiHealth,
  disconnectHuaweiHealth,
  getHuaweiAvailability,
  getHuaweiIntegrationState,
  importHuaweiWorkoutsFromFile,
  isHuaweiImportFileSupported,
  syncRecentWorkouts,
} from '@/services/huaweiHealthSync';

export default function HuaweiHealthScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { data: athlete } = useActiveAthlete();
  const [connected, setConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [availabilityReason, setAvailabilityReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  const showToast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    Alert.alert(message);
  };

  const refreshState = useCallback(async () => {
    const state = await getHuaweiIntegrationState();
    const availability = getHuaweiAvailability();
    setConnected(state.connected);
    setLastSyncAt(state.lastSyncAt);
    setAvailabilityReason(availability.supported ? null : availability.reason);
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useFocusEffect(
    useCallback(() => {
      void refreshState();
    }, [refreshState])
  );

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    router.replace('/(tabs)/profile');
  };

  const handleConnect = async () => {
    if (availabilityReason) {
      Alert.alert('Huawei unavailable', availabilityReason);
      return;
    }
    setBusy(true);
    try {
      const nextConnected = await connectHuaweiHealth();
      if (!nextConnected) {
        Alert.alert(
          'Huawei unavailable',
          'Could not connect to Huawei Health. Ensure this is an HMS-enabled Android device and Huawei Health is installed and signed in.'
        );
      }
      await refreshState();
    } catch (error) {
      Alert.alert('Huawei connect failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadFile = async () => {
    if (!athlete?.id) {
      Alert.alert('Import unavailable', 'No active athlete profile was found. Complete onboarding and try again.');
      return;
    }
    setUploadBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/gpx+xml', 'application/xml', 'text/xml', 'text/plain'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || result.assets.length === 0) return;
      const file = result.assets[0];
      if (!isHuaweiImportFileSupported(file.name)) {
        Alert.alert('Unsupported file', 'Please upload a .tcx, .gpx, or .json file exported from Huawei Health.');
        return;
      }
      const summary = await importHuaweiWorkoutsFromFile(athlete.id, file.uri, file.name);
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await refreshState();
      const message = `Imported ${summary.imported}, skipped ${summary.skipped}${summary.errors.length ? `, ${summary.errors.length} errors` : ''}.`;
      showToast(message);
      if (summary.errors.length > 0) {
        Alert.alert('Import completed with issues', `${message}\n\nFirst error: ${summary.errors[0]}`);
      }
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setUploadBusy(false);
    }
  };

  const handleSync = async () => {
    if (availabilityReason) {
      Alert.alert('Huawei unavailable', availabilityReason);
      return;
    }
    if (!athlete?.id) {
      Alert.alert('Sync unavailable', 'No active athlete profile was found. Complete onboarding and try again.');
      return;
    }
    setBusy(true);
    try {
      const lastSync = lastSyncAt ? new Date(lastSyncAt) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const imported = await syncRecentWorkouts(athlete.id, lastSync);
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      await refreshState();
      showToast(imported.length > 0 ? `Imported ${imported.length} Huawei workout${imported.length === 1 ? '' : 's'}` : 'Huawei sync complete');
    } catch (error) {
      Alert.alert('Huawei sync failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (availabilityReason) {
      Alert.alert('Huawei unavailable', availabilityReason);
      return;
    }
    setBusy(true);
    try {
      await disconnectHuaweiHealth();
      await refreshState();
    } catch (error) {
      Alert.alert('Huawei disconnect failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
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
          <Text style={styles.heading}>Huawei Health import</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Huawei Health import</Text>
          <Text style={styles.helperText}>
            Direct Huawei OAuth/native sync is not available in v1. Import workouts by uploading a Huawei export file (.TCX, .GPX, .JSON).
          </Text>
          <Pressable style={styles.primaryButton} disabled={uploadBusy || busy} onPress={() => void handleUploadFile()}>
            <Text style={styles.primaryButtonText}>{uploadBusy ? 'Uploading...' : 'Upload Huawei Health file'}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Native sync status</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Connection</Text>
            <Text style={styles.rowValue}>{connected ? 'Connected' : 'Not connected'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Last sync</Text>
            <Text style={styles.rowValue}>{lastSyncAt ? new Date(lastSyncAt).toLocaleString('en-AU') : '—'}</Text>
          </View>
          <Text style={styles.helperText}>
            {availabilityReason ??
              'Android/HMS only. Requires Huawei Health app and Huawei Mobile Services. File import works on all platforms.'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Actions</Text>
          <View style={styles.actionRow}>
            <Pressable style={[styles.actionButton, availabilityReason ? styles.actionButtonDisabled : null]} disabled={busy || connected || Boolean(availabilityReason)} onPress={() => void handleConnect()}>
              <Text style={styles.actionButtonText}>{busy && !connected ? 'Connecting...' : 'Connect'}</Text>
            </Pressable>
            <Pressable style={[styles.actionButton, availabilityReason ? styles.actionButtonDisabled : null]} disabled={busy || !connected || Boolean(availabilityReason)} onPress={() => void handleSync()}>
              <Text style={styles.actionButtonText}>{busy && connected ? 'Syncing...' : 'Sync now'}</Text>
            </Pressable>
            <Pressable style={[styles.actionButton, availabilityReason ? styles.actionButtonDisabled : null]} disabled={busy || !connected || Boolean(availabilityReason)} onPress={() => void handleDisconnect()}>
              <Text style={styles.actionButtonText}>Disconnect</Text>
            </Pressable>
          </View>
        </View>
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
    rowValue: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 13,
      color: theme.textMuted,
      flexShrink: 1,
      textAlign: 'right',
    },
    helperText: {
      fontFamily: 'DMSans_400Regular',
      fontSize: 12,
      color: theme.textMuted,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 2,
    },
    actionButton: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: 'transparent',
      alignSelf: 'flex-start',
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
    actionButtonText: {
      fontFamily: 'DMSans_500Medium',
      fontSize: 12,
      color: theme.primary,
    },
    actionButtonDisabled: {
      opacity: 0.5,
    },
  });

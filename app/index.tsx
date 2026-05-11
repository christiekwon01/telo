import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet } from 'react-native';
import { readOnboardingCompletion } from '@/lib/onboarding-completion';

export default function AppEntryGate() {
  const router = useRouter();

  useEffect(() => {
    const routeFromStorage = async () => {
      try {
        // Onboarding is optional for now — always take the user straight into the app.
        // The onboarding flow remains accessible from Profile.
        await readOnboardingCompletion();
        router.replace('/(tabs)');
      } catch (error) {
        // Fail open to tabs on storage errors to avoid trapping users in onboarding loops.
        if (__DEV__) {
          console.warn('Onboarding storage unavailable, routing to tabs.', error);
        }
        router.replace('/(tabs)');
      }
    };

    void routeFromStorage();
  }, [router]);

  return (
    <SafeAreaView style={styles.screen}>
      <ActivityIndicator color="#0F2840" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F3EE',
  },
});


import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_COMPLETE_STORAGE_KEY = 'hasCompletedOnboarding';
const LEGACY_ONBOARDING_COMPLETE_STORAGE_KEY = 'telo_onboarding_complete';

export async function readOnboardingCompletion(): Promise<boolean> {
  try {
    const storedValue = await AsyncStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY);
    if (storedValue === 'true') return true;

    // Backward compatibility for existing installs before key rename.
    const legacyValue = await AsyncStorage.getItem(LEGACY_ONBOARDING_COMPLETE_STORAGE_KEY);
    return legacyValue === 'true';
  } catch {
    return false;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, 'true'),
      AsyncStorage.setItem(LEGACY_ONBOARDING_COMPLETE_STORAGE_KEY, 'true'),
    ]);
  } catch {
    /* ignore */
  }
}

export async function resetOnboardingCompletion(): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY),
      AsyncStorage.removeItem(LEGACY_ONBOARDING_COMPLETE_STORAGE_KEY),
    ]);
  } catch {
    /* ignore */
  }
}

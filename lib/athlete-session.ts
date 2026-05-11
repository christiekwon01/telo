import AsyncStorage from '@react-native-async-storage/async-storage';

const ATHLETE_ID_STORAGE_KEY = 'telo:athlete-id';

export async function saveAthleteId(athleteId: string) {
  try {
    await AsyncStorage.setItem(ATHLETE_ID_STORAGE_KEY, athleteId);
  } catch {
    /* ignore */
  }
}

export async function readAthleteId() {
  try {
    return await AsyncStorage.getItem(ATHLETE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

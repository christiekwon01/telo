import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { saveAthleteId } from '@/lib/athlete-session';
import { markOnboardingComplete } from '@/lib/onboarding-completion';
import { ensureSupabaseAuthUser } from '@/lib/supabase-auth';
import { supabase } from '@/lib/supabase';
import { assignTemplatePlan } from '@/services/assignTemplatePlan';
import { useOnboardingStore } from '@/store/onboarding-store';

const TOTAL_STEPS = 7;

function formatOnboardingError(error: unknown): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return "Couldn't set up your plan. Check your connection and try again.";
  }
  const m = error.message.trim();
  if (m.toLowerCase().includes('failed to fetch') || m.toLowerCase().includes('network request failed')) {
    return `${m}\n\nCheck Wi‑Fi and that EXPO_PUBLIC_SUPABASE_URL is correct, then try again.`;
  }
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}

const PLAN_PROGRESS_MESSAGE = 'Setting up your personalised plan...';

export default function OnboardingScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const [step, setStep] = useState(1);
  const [displayedStep, setDisplayedStep] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const transitionProgress = useRef(new Animated.Value(1)).current;

  const {
    athleteName,
    setAthleteId,
    level,
    swimBackground,
    bikeBackground,
    runBackground,
    raceDate,
    raceName,
    trainingDays,
    otherCommitmentComment,
    lifeCommitments,
    setAthleteName,
    setLevel,
    setSwimBackground,
    setBikeBackground,
    setRunBackground,
    setRaceDate,
    setRaceName,
    setOtherCommitmentComment,
    toggleTrainingDay,
    toggleLifeCommitment,
  } = useOnboardingStore();

  const goToStep = (nextStep: number) => {
    if (nextStep === step || isTransitioning) {
      return;
    }
    const clampedStep = Math.max(1, Math.min(TOTAL_STEPS, nextStep));
    if (clampedStep === step) {
      return;
    }
    setIsTransitioning(true);
    Animated.timing(transitionProgress, {
      toValue: 0,
      duration: 220,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setStep(clampedStep);
      setDisplayedStep(clampedStep);
      Animated.timing(transitionProgress, {
        toValue: 1,
        duration: 260,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setIsTransitioning(false);
      });
    });
  };

  const runGenerationFlow = async () => {
    setGenerationError(null);
    setIsGeneratingPlan(true);

    try {
      const normalizedTrainingDays = trainingDays.map((day) => day.toLowerCase().slice(0, 3));

      const athleteNameValue = athleteName.trim() || 'Athlete';
      const raceDateValue = raceDate || new Date().toISOString().slice(0, 10);
      const raceNameValue = raceName.trim() || 'Goal race';

      const { id: authUserId } = await ensureSupabaseAuthUser();

      let athlete: { id: string } | null = null;
      const insertResult = await supabase
        .from('athletes')
        .insert({
          id: authUserId,
          name: athleteNameValue,
          level,
          swim_background: swimBackground,
          bike_background: bikeBackground,
          run_background: runBackground,
          goal_race_date: raceDateValue,
          goal_race_name: raceNameValue,
        })
        .select('id')
        .single();

      if (insertResult.error) {
        const dup =
          insertResult.error.code === '23505' ||
          insertResult.error.message.toLowerCase().includes('duplicate');
        if (dup) {
          const { data: existing, error: fetchErr } = await supabase
            .from('athletes')
            .select('id')
            .eq('id', authUserId)
            .maybeSingle();
          if (fetchErr) throw new Error(fetchErr.message);
          if (existing) athlete = existing;
        }
        if (!athlete) {
          throw new Error(insertResult.error.message);
        }
      } else {
        athlete = insertResult.data;
      }

      if (!athlete) {
        throw new Error('Failed to create athlete record.');
      }

      await assignTemplatePlan({
        athleteId: athlete.id,
        level,
        raceDate: raceDateValue,
        raceName: raceNameValue,
        trainingDays: normalizedTrainingDays,
      });
      setAthleteId(athlete.id);
      await saveAthleteId(athlete.id);
      await markOnboardingComplete();
      router.replace('/(tabs)');
    } catch (error) {
      const errorMessage = formatOnboardingError(error);
      setGenerationError(errorMessage);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const onContinue = async () => {
    if (step < TOTAL_STEPS) {
      goToStep(step + 1);
      return;
    }
    await runGenerationFlow();
  };

  const onSkip = () => {
    if (step < TOTAL_STEPS) {
      goToStep(step + 1);
    }
  };

  const stepMeaning = level === 'fara' ? 'To set out.' : level === 'orka' ? 'To endure.' : 'To achieve.';
  const translateX = transitionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 0],
  });
  const contentAnimatedStyle = {
    opacity: transitionProgress,
    transform: [{ translateX }],
  };

  return (
    <SafeAreaView style={styles.screen}>
      {isGeneratingPlan ? (
        <View style={styles.loadingRoot}>
          <View style={styles.loadingMarkRow}>
            <Text style={styles.loadingWordmark}>telo</Text>
            <View style={styles.loadingWordmarkDot} />
          </View>
          <Text style={styles.loadingTitle}>Setting up your plan...</Text>
          <ActivityIndicator color="#C97E2F" size="small" style={styles.loadingSpinner} />
          <Text style={styles.loadingMessage}>{PLAN_PROGRESS_MESSAGE}</Text>
        </View>
      ) : null}
      {generationError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{generationError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void runGenerationFlow()} activeOpacity={0.9}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <View style={styles.topArea}>
        <View style={styles.navRow}>
          {step > 1 ? (
            <Pressable
              onPress={() => goToStep(step - 1)}
              style={styles.backBtn}
              disabled={isTransitioning || isGeneratingPlan}>
              <Ionicons name="arrow-back" size={22} color="#0F2840" />
            </Pressable>
          ) : (
            <View style={styles.backBtnPlaceholder} />
          )}
          {step === 4 || step === 6 ? (
            <Pressable onPress={onSkip} disabled={isGeneratingPlan}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          ) : (
            <View style={styles.backBtnPlaceholder} />
          )}
        </View>
      </View>

      <Animated.View style={[styles.content, contentAnimatedStyle]}>
        {displayedStep === 1 ? (
          <View style={styles.centeredStep}>
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmark}>telo</Text>
              <View style={styles.wordmarkDot} />
            </View>
            <Text style={styles.tagline}>You set out with telo.</Text>
            <Text style={styles.subtext}>
              You begin as fara.
              {'\n'}
              You endure as orka.
              {'\n'}
              You achieve as vinna.
            </Text>
          </View>
        ) : null}

        {displayedStep === 2 ? (
          <View>
            <Text style={styles.heading}>What is your name?</Text>
            <TextInput
              value={athleteName}
              onChangeText={setAthleteName}
              placeholder="Your first name"
              placeholderTextColor="rgba(15,40,64,0.35)"
              style={styles.textInput}
            />
          </View>
        ) : null}

        {displayedStep === 3 ? (
          <View>
            <Text style={styles.heading}>Where are you right now?</Text>
            {[
              { key: 'fara', title: 'fara', text: 'Complete beginner, this is my first triathlon' },
              { key: 'orka', title: 'orka', text: "I've done one before, building consistency" },
              { key: 'vinna', title: 'vinna', text: 'Performance focused, chasing a goal time' },
            ].map((option) => {
              const selected = level === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.levelCard, selected ? styles.levelCardSelected : null]}
                  onPress={() => setLevel(option.key as 'fara' | 'orka' | 'vinna')}>
                  {selected ? <View style={styles.levelCardDot} /> : null}
                  <Text style={styles.levelCardTitle}>{option.title}</Text>
                  <Text style={styles.levelCardText}>{option.text}</Text>
                </Pressable>
              );
            })}
            <Text style={styles.subtleCopy}>Sport background (optional, helps tailor each discipline)</Text>
            <View style={styles.sportBackgroundGrid}>
              {(
                [
                  { key: 'swim', value: swimBackground, set: setSwimBackground },
                  { key: 'bike', value: bikeBackground, set: setBikeBackground },
                  { key: 'run', value: runBackground, set: setRunBackground },
                ] as const
              ).map((sportRow) => (
                <View key={sportRow.key} style={styles.sportBackgroundRow}>
                  <Text style={styles.sportBackgroundLabel}>{sportRow.key}</Text>
                  <View style={styles.sportBackgroundChoices}>
                    {(['beginner', 'experienced', 'competitive'] as const).map((tier) => {
                      const selected = sportRow.value === tier;
                      return (
                        <Pressable
                          key={`${sportRow.key}-${tier}`}
                          style={[styles.sportBackgroundChip, selected ? styles.sportBackgroundChipSelected : null]}
                          onPress={() => sportRow.set(tier)}>
                          <Text style={[styles.sportBackgroundChipText, selected ? styles.sportBackgroundChipTextSelected : null]}>
                            {tier}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {displayedStep === 4 ? (
          <View>
            <Text style={styles.heading}>When is your race?</Text>
            <Pressable style={styles.textInput} onPress={() => setShowDatePicker(true)}>
              <Text style={raceDate ? styles.inputText : styles.placeholderText}>
                {raceDate || 'Select race date'}
              </Text>
            </Pressable>
            {showDatePicker ? (
              <DateTimePicker
                value={raceDate ? new Date(raceDate) : new Date()}
                mode="date"
                display="spinner"
                {...(Platform.OS === 'ios' ? { accentColor: theme.accent, textColor: theme.text } : null)}
                onChange={(_, selectedDate) => {
                  if (Platform.OS === 'android') {
                    setShowDatePicker(false);
                  }
                  if (selectedDate) {
                    setRaceDate(selectedDate.toISOString().split('T')[0]);
                  }
                }}
              />
            ) : null}
            <TextInput
              value={raceName}
              onChangeText={setRaceName}
              placeholder="e.g. Sydney Sprint Triathlon"
              placeholderTextColor="rgba(15,40,64,0.35)"
              style={[styles.textInput, styles.topGap]}
            />
          </View>
        ) : null}

        {displayedStep === 5 ? (
          <View>
            <Text style={styles.heading}>How many days can you train each week?</Text>
            <View style={styles.daysRow}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => {
                const selected = trainingDays.includes(day);
                return (
                  <Pressable
                    key={day}
                    style={[styles.dayBtn, selected ? styles.dayBtnSelected : null]}
                    onPress={() => toggleTrainingDay(day)}>
                    <Text style={[styles.dayBtnText, selected ? styles.dayBtnTextSelected : null]}>{day}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.subtleCopy}>We&apos;ll build your plan around these days.</Text>
          </View>
        ) : null}

        {displayedStep === 6 ? (
          <View>
            <Text style={styles.heading}>Anything we should know?</Text>
            <Text style={styles.bodyCopy}>telo will plan around your life, not the other way around.</Text>
            {[
              { key: 'kidsOrIrregularHours', label: 'I have young kids or irregular hours' },
              { key: 'frequentTravel', label: 'I travel frequently for work' },
              { key: 'returningFromInjury', label: "I'm returning from injury or illness" },
              { key: 'other', label: 'Other' },
            ].map((item) => (
              <View key={item.key} style={styles.toggleCard}>
                <View style={styles.toggleLabelWrap}>
                  <Text style={styles.toggleText}>{item.label}</Text>
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={lifeCommitments[item.key as keyof typeof lifeCommitments]}
                    onValueChange={() => toggleLifeCommitment(item.key as keyof typeof lifeCommitments)}
                    thumbColor="#FFFFFF"
                    trackColor={{ false: 'rgba(15,40,64,0.2)', true: '#C97E2F' }}
                  />
                </View>
              </View>
            ))}
            {lifeCommitments.other ? (
              <TextInput
                value={otherCommitmentComment}
                onChangeText={setOtherCommitmentComment}
                placeholder="Tell us more..."
                placeholderTextColor="rgba(15,40,64,0.35)"
                style={[styles.textInput, styles.topGap]}
              />
            ) : null}
          </View>
        ) : null}

        {displayedStep === 7 ? (
          <View style={styles.centeredStep}>
            <Text style={styles.finalLevel}>{level}</Text>
            <Text style={styles.finalMeaning}>{stepMeaning}</Text>
          </View>
        ) : null}
      </Animated.View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onContinue}
          activeOpacity={0.9}
          disabled={isTransitioning || isGeneratingPlan}>
          <Text style={styles.primaryButtonText}>
            {step === 1 ? "Let's go" : step === 7 ? 'Enter telo' : 'Continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F3EE',
  },
  topArea: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backBtn: {
    padding: 4,
  },
  backBtnPlaceholder: {
    width: 28,
  },
  skipText: {
    fontFamily: 'DMSans_500Medium',
    color: '#C97E2F',
    fontSize: 14,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  centeredStep: {
    alignItems: 'center',
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  wordmark: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 48,
    color: '#0F2840',
    lineHeight: 52,
  },
  wordmarkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C97E2F',
    marginLeft: 6,
    marginBottom: 10,
  },
  tagline: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 20,
    fontStyle: 'italic',
    color: 'rgba(15,40,64,0.8)',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtext: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: 'rgba(15,40,64,0.4)',
    textAlign: 'center',
    lineHeight: 19,
  },
  heading: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 40,
    lineHeight: 44,
    color: '#0F2840',
    marginBottom: 14,
  },
  textInput: {
    backgroundColor: '#F6F3EE',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.15)',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 52,
    justifyContent: 'center',
    fontFamily: 'DMSans_400Regular',
    color: '#0F2840',
    fontSize: 16,
  },
  inputText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#0F2840',
  },
  placeholderText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: 'rgba(15,40,64,0.35)',
  },
  topGap: {
    marginTop: 10,
  },
  levelCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.15)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    position: 'relative',
  },
  levelCardSelected: {
    borderColor: '#C97E2F',
    backgroundColor: '#F6F3EE',
  },
  levelCardDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C97E2F',
    position: 'absolute',
    top: 10,
    right: 10,
  },
  levelCardTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 28,
    color: '#0F2840',
    marginBottom: 2,
  },
  levelCardText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: 'rgba(15,40,64,0.5)',
  },
  sportBackgroundGrid: {
    marginTop: 10,
    gap: 8,
  },
  sportBackgroundRow: {
    gap: 6,
  },
  sportBackgroundLabel: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#0F2840',
    textTransform: 'capitalize',
  },
  sportBackgroundChoices: {
    flexDirection: 'row',
    gap: 6,
  },
  sportBackgroundChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  sportBackgroundChipSelected: {
    borderColor: '#C97E2F',
    backgroundColor: '#F6F3EE',
  },
  sportBackgroundChipText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    color: '#0F2840',
  },
  sportBackgroundChipTextSelected: {
    color: '#C97E2F',
  },
  daysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayBtn: {
    minWidth: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0F2840',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F3EE',
  },
  dayBtnSelected: {
    backgroundColor: '#0F2840',
  },
  dayBtnText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#0F2840',
  },
  dayBtnTextSelected: {
    color: '#FFFFFF',
  },
  subtleCopy: {
    marginTop: 12,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: 'rgba(15,40,64,0.4)',
  },
  bodyCopy: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: 'rgba(15,40,64,0.5)',
    marginBottom: 10,
  },
  toggleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(15,40,64,0.15)',
    minHeight: 58,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabelWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 10,
  },
  toggleSwitchWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
  },
  toggleText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#0F2840',
  },
  finalLevel: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 72,
    lineHeight: 78,
    color: '#0F2840',
  },
  finalMeaning: {
    fontFamily: 'CormorantGaramond_600SemiBold',
    fontSize: 22,
    fontStyle: 'italic',
    color: '#C97E2F',
    marginBottom: 14,
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  loadingRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: '#F6F3EE',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingMarkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  loadingWordmark: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 44,
    lineHeight: 48,
    color: '#0F2840',
  },
  loadingWordmarkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#C97E2F',
    marginLeft: 6,
    marginBottom: 9,
  },
  loadingTitle: {
    fontFamily: 'CormorantGaramond_700Bold',
    fontSize: 32,
    lineHeight: 36,
    color: '#0F2840',
    textAlign: 'center',
  },
  loadingSpinner: {
    marginTop: 16,
    marginBottom: 10,
  },
  loadingMessage: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    color: 'rgba(15,40,64,0.72)',
    textAlign: 'center',
  },
  errorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 54,
    zIndex: 35,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(201,126,47,0.45)',
    backgroundColor: '#FFFFFF',
    padding: 12,
    gap: 10,
  },
  errorBannerText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 12,
    color: '#0F2840',
  },
  retryButton: {
    alignSelf: 'flex-end',
    borderRadius: 999,
    backgroundColor: '#0F2840',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  retryButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 12,
    color: '#FFFFFF',
  },
  primaryButton: {
    backgroundColor: '#0F2840',
    minHeight: 52,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#FFFFFF',
  },
});


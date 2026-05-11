import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { generateTrainingPlan } from '@/services/generatePlan';
import { savePlanToDatabase } from '@/services/savePlan';
import { generateWeeklyChallenges } from '@/services/generateWeeklyChallenges';
import { saveChallenges } from '@/services/saveChallenges';

type DebugState = {
  loading: boolean;
  error: string | null;
  data: unknown[] | null;
  generationMessage: string | null;
  challenges: unknown[] | null;
};

export default function DebugScreen() {
  const router = useRouter();
  const [state, setState] = useState<DebugState>({
    loading: false,
    error: null,
    data: null,
    generationMessage: null,
    challenges: null,
  });

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  const loadSessions = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .order('scheduled_date', { ascending: true })
      .limit(10);

    if (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message, data: null }));
      return;
    }
    setState((prev) => ({ ...prev, loading: false, data: data ?? [], error: null }));
  };

  const generateTestPlan = async () => {
    setState((prev) => ({
      ...prev,
      loading: true,
      error: null,
      generationMessage: 'Generating test plan...',
    }));
    try {
      const { data: athlete, error: athleteError } = await supabase
        .from('athletes')
        .insert({
          name: 'Test Athlete',
          level: 'fara',
          swim_background: 'beginner',
          bike_background: 'beginner',
          run_background: 'beginner',
          goal_race_date: '2026-10-01',
          goal_race_name: 'Test Sprint Tri',
        })
        .select('id')
        .single();

      if (athleteError || !athlete) {
        throw new Error(athleteError?.message ?? 'Could not create test athlete');
      }

      const plan = await generateTrainingPlan({
        athleteName: 'Test Athlete',
        level: 'fara',
        sportBackgrounds: { swim: 'beginner', bike: 'beginner', run: 'beginner' },
        raceDate: '2026-10-01',
        raceName: 'Test Sprint Tri',
        upcomingRaces: [{ name: 'Test Sprint Tri', date: '2026-10-01', priority: 'a', raceType: 'tri-sprint' }],
        trainingDays: ['mon', 'wed', 'fri', 'sat', 'sun'],
        lifeCommitments: ['young kids or irregular hours'],
      });

      await savePlanToDatabase(athlete.id, plan);
      setState((prev) => ({
        ...prev,
        loading: false,
        generationMessage: `Test plan generated: ${plan.planName}`,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to generate test plan',
      }));
    }
  };

  const generateWeekly = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null, generationMessage: 'Generating weekly challenges...' }));
    try {
      const { data: athlete, error: athleteError } = await supabase
        .from('athletes')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (athleteError || !athlete?.id) throw new Error(athleteError?.message ?? 'No athlete found');
      const generated = await generateWeeklyChallenges(athlete.id);
      await saveChallenges(athlete.id, generated);
      const { data: pending } = await supabase
        .from('rova_challenges')
        .select('*')
        .eq('athlete_id', athlete.id)
        .eq('status', 'pending')
        .order('scheduled_date', { ascending: true });
      setState((prev) => ({
        ...prev,
        loading: false,
        generationMessage: `Generated ${generated.length} challenge(s).`,
        challenges: pending ?? [],
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to generate weekly challenges',
      }));
    }
  };

  const acceptRandomChallenge = async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { data: athlete } = await supabase
        .from('athletes')
        .select('id')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!athlete?.id) throw new Error('No athlete found');
      const { data: pending, error } = await supabase
        .from('rova_challenges')
        .select('*')
        .eq('athlete_id', athlete.id)
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      const pick = (pending ?? [])[Math.floor(Math.random() * (pending?.length ?? 1))];
      if (!pick?.id) throw new Error('No pending challenge available.');
      const { error: updateError } = await supabase
        .from('rova_challenges')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', pick.id);
      if (updateError) throw new Error(updateError.message);
      const { data: refreshed } = await supabase
        .from('rova_challenges')
        .select('*')
        .eq('athlete_id', athlete.id)
        .order('scheduled_date', { ascending: true })
        .limit(20);
      setState((prev) => ({
        ...prev,
        loading: false,
        generationMessage: `Accepted: ${pick.title}`,
        challenges: refreshed ?? [],
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to accept random challenge',
      }));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Debug</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.button} onPress={() => void loadSessions()} disabled={state.loading}>
          <Text style={styles.buttonText}>Load first 10 sessions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => void generateTestPlan()} disabled={state.loading}>
          <Text style={styles.buttonText}>Generate test plan</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => void generateWeekly()} disabled={state.loading}>
          <Text style={styles.buttonText}>Generate this week&apos;s challenges</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => void acceptRandomChallenge()} disabled={state.loading}>
          <Text style={styles.buttonText}>Accept random challenge</Text>
        </TouchableOpacity>

        {state.loading ? <Text style={styles.statusText}>Working...</Text> : null}
        {state.generationMessage ? <Text style={styles.statusText}>{state.generationMessage}</Text> : null}
        {state.error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorLabel}>Error</Text>
            <Text style={styles.errorText}>{state.error}</Text>
          </View>
        ) : null}

        {state.data ? <Text style={styles.json}>{JSON.stringify(state.data, null, 2)}</Text> : null}
        {state.challenges ? <Text style={styles.json}>{JSON.stringify(state.challenges, null, 2)}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F3EE' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15,40,64,0.1)',
    gap: 8,
  },
  backLink: { fontFamily: 'DMSans-Medium', fontSize: 13, color: '#0F2840' },
  title: { fontFamily: 'CormorantGaramond_700Bold', fontSize: 32, color: '#0F2840' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingVertical: 16, paddingBottom: 32, gap: 10 },
  button: {
    borderRadius: 999,
    backgroundColor: '#0F2840',
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  buttonText: { fontFamily: 'DMSans-Medium', color: '#FFFFFF', fontSize: 12 },
  statusText: { fontFamily: 'DMSans-Medium', fontSize: 12, color: '#0F2840' },
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(201,126,47,0.45)',
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  errorLabel: { fontFamily: 'DMSans-Bold', fontSize: 12, color: '#C97E2F', marginBottom: 6 },
  errorText: { fontFamily: 'DMSans-Regular', fontSize: 12, color: '#0F2840' },
  json: { fontFamily: 'DMSans-Regular', fontSize: 11, lineHeight: 17, color: '#0F2840' },
});

import { supabase } from '@/lib/supabase';

/**
 * Ensures the Supabase client has an authenticated JWT so strict RLS
 * (`athlete_id = auth.uid()`, `athletes.id = auth.uid()`) can succeed.
 *
 * Uses Supabase Anonymous Sign-In. Enable in Dashboard:
 * Authentication → Providers → Anonymous → Allow anonymous sign-ins.
 */
export async function ensureSupabaseAuthUser(): Promise<{ id: string }> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (session?.user?.id) {
    return { id: session.user.id };
  }

  const { data, error } = await supabase.auth.signInAnonymously();

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('anonymous') && (msg.includes('disabled') || msg.includes('not enabled'))) {
      throw new Error(
        'Anonymous sign-ins are disabled. In Supabase: Authentication → Providers → Anonymous → enable, then try again.'
      );
    }
    throw new Error(error.message);
  }

  if (!data.user?.id) {
    throw new Error('Could not create an anonymous session.');
  }

  // Ensure the JWT is attached immediately for the next PostgREST request (some RN runtimes).
  if (data.session?.access_token && data.session.refresh_token) {
    await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  }

  return { id: data.user.id };
}

/**
 * Ensures a matching athletes row exists for the auth user id so FK-protected
 * tables (race_goals, rova_conversations, personal_bests, etc.) can insert.
 */
export async function ensureAthleteRowExists(athleteId: string): Promise<void> {
  const { data: existing, error: fetchError } = await supabase.from('athletes').select('id').eq('id', athleteId).maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (existing?.id) return;

  const { error: insertError } = await supabase.from('athletes').insert({
    id: athleteId,
    name: 'Athlete',
    level: 'fara',
    swim_background: 'beginner',
    bike_background: 'beginner',
    run_background: 'beginner',
  });

  if (insertError) {
    const dup = insertError.code === '23505' || insertError.message.toLowerCase().includes('duplicate');
    if (dup) return;
    throw new Error(insertError.message);
  }
}

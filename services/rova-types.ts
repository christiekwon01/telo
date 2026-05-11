export type ChallengeType = 'movement' | 'recovery' | 'social' | 'exploration' | 'benchmark';
export type ChallengeStatus = 'pending' | 'accepted' | 'completed' | 'skipped';

export type Challenge = {
  type: ChallengeType;
  title: string;
  description: string;
  suggestedDate: string; // YYYY-MM-DD
};

export const fallbackChallenges: Omit<Challenge, 'suggestedDate'>[] = [
  {
    type: 'recovery',
    title: '10-minute mobility flow',
    description: 'Focus on hips, ankles, and shoulders. No rushing.',
  },
  {
    type: 'exploration',
    title: 'New route run',
    description: "Run somewhere you've never been. 20 minutes easy pace.",
  },
  {
    type: 'social',
    title: 'Share your week',
    description: 'Post your hardest session this week to Instagram or Strava.',
  },
];

import { create } from 'zustand';

export type AthleteLevel = 'fara' | 'orka' | 'vinna';
export type SportBackground = 'beginner' | 'experienced' | 'competitive';

type LifeCommitments = {
  kidsOrIrregularHours: boolean;
  frequentTravel: boolean;
  returningFromInjury: boolean;
  other: boolean;
};

type OnboardingState = {
  athleteName: string;
  athleteId: string | null;
  level: AthleteLevel;
  swimBackground: SportBackground;
  bikeBackground: SportBackground;
  runBackground: SportBackground;
  raceDate: string;
  raceName: string;
  trainingDays: string[];
  otherCommitmentComment: string;
  lifeCommitments: LifeCommitments;
  setAthleteName: (name: string) => void;
  setAthleteId: (athleteId: string | null) => void;
  setLevel: (level: AthleteLevel) => void;
  setSwimBackground: (value: SportBackground) => void;
  setBikeBackground: (value: SportBackground) => void;
  setRunBackground: (value: SportBackground) => void;
  setRaceDate: (raceDate: string) => void;
  setRaceName: (raceName: string) => void;
  setOtherCommitmentComment: (comment: string) => void;
  toggleTrainingDay: (day: string) => void;
  toggleLifeCommitment: (key: keyof LifeCommitments) => void;
  setOnboardingData: (payload: Partial<OnboardingState>) => void;
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  athleteName: '',
  athleteId: null,
  level: 'fara',
  swimBackground: 'beginner',
  bikeBackground: 'beginner',
  runBackground: 'beginner',
  raceDate: '',
  raceName: '',
  trainingDays: [],
  otherCommitmentComment: '',
  lifeCommitments: {
    kidsOrIrregularHours: false,
    frequentTravel: false,
    returningFromInjury: false,
    other: false,
  },
  setAthleteName: (athleteName) => set({ athleteName }),
  setAthleteId: (athleteId) => set({ athleteId }),
  setLevel: (level) => set({ level }),
  setSwimBackground: (swimBackground) => set({ swimBackground }),
  setBikeBackground: (bikeBackground) => set({ bikeBackground }),
  setRunBackground: (runBackground) => set({ runBackground }),
  setRaceDate: (raceDate) => set({ raceDate }),
  setRaceName: (raceName) => set({ raceName }),
  setOtherCommitmentComment: (otherCommitmentComment) => set({ otherCommitmentComment }),
  toggleTrainingDay: (day) =>
    set((state) => ({
      trainingDays: state.trainingDays.includes(day)
        ? state.trainingDays.filter((d) => d !== day)
        : [...state.trainingDays, day],
    })),
  toggleLifeCommitment: (key) =>
    set((state) => ({
      lifeCommitments: {
        ...state.lifeCommitments,
        [key]: !state.lifeCommitments[key],
      },
    })),
  setOnboardingData: (payload) =>
    set((state) => ({
      ...state,
      ...payload,
    })),
}));


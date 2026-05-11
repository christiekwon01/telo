import { create } from 'zustand';
import type { PersonalBestImprovement } from '@/services/personalBests';

type PersonalBestCelebrationState = {
  visible: boolean;
  payload: PersonalBestImprovement | null;
  show: (payload: PersonalBestImprovement) => void;
  hide: () => void;
};

export const usePersonalBestCelebrationStore = create<PersonalBestCelebrationState>((set) => ({
  visible: false,
  payload: null,
  show: (payload) => set({ visible: true, payload }),
  hide: () => set({ visible: false, payload: null }),
}));

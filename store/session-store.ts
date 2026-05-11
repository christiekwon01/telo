import { create } from 'zustand';

export type SessionMetrics = {
  durationMins?: number;
  durationUnit?: 'min' | 'hr';
  distance?: number;
  distanceUnit?: 'm' | 'km';
  intensity?: string;
  avgHeartRate?: number;
  rpe?: number;
};

export type CompletedSession = {
  sessionId: string;
  status: 'completed';
  completedAt: string;
  title?: string;
  sport?: 'swim' | 'bike' | 'run' | 'brick' | 'gym' | 'rest';
  notes?: string;
  metrics?: SessionMetrics;
  mediaUris?: string[];
};

export type SessionDraft = {
  sessionId: string;
  notes: string;
  duration: string;
  durationUnit: 'min' | 'hr';
  distance: string;
  distanceUnit: 'm' | 'km';
  avgHr: string;
  rpe: number | null;
};

type SessionStore = {
  completedSessions: Record<string, CompletedSession>;
  sessionDrafts: Record<string, SessionDraft>;
  completeSession: (payload: CompletedSession) => void;
  saveSessionDraft: (payload: SessionDraft) => void;
  clearSessionDraft: (sessionId: string) => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  completedSessions: {},
  sessionDrafts: {},
  completeSession: (payload) =>
    set((state) => ({
      completedSessions: {
        ...state.completedSessions,
        [payload.sessionId]: payload,
      },
    })),
  saveSessionDraft: (payload) =>
    set((state) => ({
      sessionDrafts: {
        ...state.sessionDrafts,
        [payload.sessionId]: payload,
      },
    })),
  clearSessionDraft: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removedDraft, ...remainingDrafts } = state.sessionDrafts;
      return { sessionDrafts: remainingDrafts };
    }),
}));


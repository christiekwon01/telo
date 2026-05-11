import { create } from 'zustand';

export type PlanAdjustmentEntry = {
  sessionId: string;
  fromDate: string;
  toDate: string;
  movedAt: string;
  source: 'week_drag_drop';
};

type PlanAdjustmentStore = {
  queue: PlanAdjustmentEntry[];
  enqueueAdjustment: (entry: PlanAdjustmentEntry) => void;
};

export const usePlanAdjustmentStore = create<PlanAdjustmentStore>((set) => ({
  queue: [],
  enqueueAdjustment: (entry) =>
    set((state) => ({
      queue: [entry, ...state.queue].slice(0, 50),
    })),
}));

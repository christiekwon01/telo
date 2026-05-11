import type { PlanAdjustmentEntry } from '@/store/plan-adjustment-store';

export async function requestPlanReoptimization(entry: PlanAdjustmentEntry): Promise<void> {
  if (__DEV__) {
    // TODO: Integrate Claude API plan re-optimization endpoint when backend is available.
    console.log('Plan re-optimization requested', entry);
  }
}

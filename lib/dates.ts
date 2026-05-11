import type { AndroidNativeProps } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

/**
 * Calendar YYYY-MM-DD in the device's local timezone.
 * Prefer this over `toISOString().split('T')[0]` (UTC) for scheduled_date comparisons.
 */
export function toLocalIsoDate(value: Date): string {
  return value.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Inclusive local calendar range → UTC ISO bounds for timestamptz columns like completed_at. */
export function localCalendarRangeToUtcIsoBounds(fromIso: string, toIso: string): { gte: string; lte: string } {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { gte: start.toISOString(), lte: end.toISOString() };
}

/** Monday as `firstDayOfWeek` for `@react-native-community/datetimepicker` (matches `DAY_OF_WEEK`). */
export const ANDROID_DATE_PICKER_FIRST_DAY_MONDAY = 2 as NonNullable<AndroidNativeProps['firstDayOfWeek']>;

/**
 * Region whose calendar week typically starts Monday (ISO 8601). Used for iOS `DateTimePicker` `locale`.
 */
export const IOS_DATE_PICKER_LOCALE_MONDAY_WEEK = 'en_GB';

type MondayWeekPickerExtra =
  | { locale: typeof IOS_DATE_PICKER_LOCALE_MONDAY_WEEK }
  | { firstDayOfWeek: typeof ANDROID_DATE_PICKER_FIRST_DAY_MONDAY }
  | Record<string, never>;

/** Props to pass into `@react-native-community/datetimepicker` for Monday-first calendar columns. */
export function datePickerMondayWeekProps(): MondayWeekPickerExtra {
  if (Platform.OS === 'ios') return { locale: IOS_DATE_PICKER_LOCALE_MONDAY_WEEK };
  if (Platform.OS === 'android') return { firstDayOfWeek: ANDROID_DATE_PICKER_FIRST_DAY_MONDAY };
  return {};
}

/** Spread into `DateTimePickerAndroid.open({ ... })` on Android for Monday-first calendar. */
export function datePickerAndroidMondayOpenProps(): { firstDayOfWeek: typeof ANDROID_DATE_PICKER_FIRST_DAY_MONDAY } | Record<string, never> {
  return Platform.OS === 'android' ? { firstDayOfWeek: ANDROID_DATE_PICKER_FIRST_DAY_MONDAY } : {};
}

/**
 * Leading placeholder cell count for a month grid when the week row starts on **Monday**.
 * JS `Date#getDay()`: Sun=0 … Sat=6.
 */
export function mondayBasedMonthLeadingDayCount(startOfMonth: Date): number {
  return (startOfMonth.getDay() + 6) % 7;
}

import type { ReactNode } from 'react';

export type WeekPickerDateFieldProps = {
  value: Date;
  onChange: (date: Date) => void;
};

/** iOS/Android use `DateTimePicker` in the parent modal; this stub is never rendered there. */
export function WeekPickerDateField(_props: WeekPickerDateFieldProps): ReactNode {
  return null;
}

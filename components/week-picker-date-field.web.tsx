import { toLocalIsoDate } from '@/lib/dates';

type WeekPickerDateFieldProps = {
  value: Date;
  onChange: (date: Date) => void;
};

/**
 * Web: `@react-native-community/datetimepicker` is a no-op (returns null).
 * Use a visible native date input inside the week picker sheet.
 */
export function WeekPickerDateField({ value, onChange }: WeekPickerDateFieldProps) {
  return (
    <input
      type="date"
      value={toLocalIsoDate(value)}
      onChange={(e) => {
        const v = e.currentTarget.value;
        if (!v) return;
        const [y, m, d] = v.split('-').map(Number);
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
        onChange(new Date(y, m - 1, d));
      }}
      style={{
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        marginTop: 4,
        padding: '12px 12px',
        fontSize: 16,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        borderRadius: 10,
        border: '1px solid rgba(15, 40, 64, 0.18)',
        color: '#0F2840',
        backgroundColor: '#FFFFFF',
        cursor: 'pointer',
      }}
    />
  );
}

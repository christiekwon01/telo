import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { normalizeCompletionStatus } from '@/hooks/useSessionData';
import {
  eachDateInExportRange,
  fetchJournalExportBundle,
} from '@/services/journalExportData';

/**
 * Builds a Markdown journal export and opens the native share sheet when available.
 * Returns the written file URI.
 */
export async function shareJournalMarkdownExport(opts: {
  athleteId: string;
  fromIso: string;
  toIso: string;
  athleteName?: string;
}): Promise<string> {
  const { athleteId, fromIso, toIso, athleteName } = opts;
  const bundle = await fetchJournalExportBundle({ athleteId, fromIso, toIso });

  const lines: string[] = [];
  lines.push(`# Telo journal export`);
  lines.push('');
  lines.push(`**Athlete:** ${athleteName ?? 'Athlete'}`);
  lines.push(`**Range:** ${fromIso} → ${toIso}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const reflByDate = new Map(bundle.reflections.map((r) => [r.entry_date, r]));
  const habitName = new Map(bundle.habits.map((h) => [h.id, `${h.icon_emoji} ${h.name}`]));
  const compsByDate = new Map<string, string[]>();
  for (const c of bundle.completions) {
    const arr = compsByDate.get(c.completion_date) ?? [];
    arr.push(c.habit_id);
    compsByDate.set(c.completion_date, arr);
  }

  for (const iso of eachDateInExportRange(fromIso, toIso)) {
    const daySessions = bundle.sessions.filter((s) => s.scheduled_date === iso);
    const completed = daySessions.filter(
      (s) => normalizeCompletionStatus(s.status, s.session_logs as never) === 'completed'
    );
    const refl = reflByDate.get(iso);
    const dayHabits = compsByDate.get(iso) ?? [];
    if (completed.length === 0 && !refl && dayHabits.length === 0) continue;

    lines.push(`## ${iso}`);
    lines.push('');
    if (refl) {
      lines.push('### Reflection');
      lines.push(`- Mood: ${refl.mood ?? '—'} / 5`);
      lines.push(`- Energy: ${refl.energy ?? '—'} / 5`);
      lines.push(`- Sleep: ${refl.sleep_quality != null ? `${refl.sleep_quality} / 5` : '—'}`);
      lines.push('');
      lines.push(refl.body_text || '_No notes_');
      lines.push('');
    }
    if (completed.length > 0) {
      lines.push('### Completed sessions');
      for (const s of completed) {
        const mins = s.duration_mins != null ? `${s.duration_mins} min` : '—';
        lines.push(`- **${s.title}** (${s.sport}) · ${mins}`);
      }
      lines.push('');
    }
    if (dayHabits.length > 0) {
      lines.push('### Habits');
      for (const hid of dayHabits) {
        lines.push(`- [x] ${habitName.get(hid) ?? hid}`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  const body = lines.join('\n');
  const safeFrom = fromIso.replace(/-/g, '');
  const safeTo = toIso.replace(/-/g, '');
  const filename = `telo_journal_${safeFrom}_to_${safeTo}.md`;
  const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!base) throw new Error('No writable directory');
  const path = `${base}${filename}`;
  await FileSystem.writeAsStringAsync(path, body, { encoding: 'utf8' });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(path, { mimeType: 'text/markdown', dialogTitle: 'Export journal' });
  }

  return path;
}
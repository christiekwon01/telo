import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import JSZip from 'jszip';
import { supabase } from '@/lib/supabase';

type ExportFormat = 'json' | 'csv';
type ProgressFn = (progress: { step: string; percent: number }) => void;

type ExportTable =
  | 'athletes'
  | 'plans'
  | 'sessions'
  | 'session_logs'
  | 'personal_bests'
  | 'rova_challenges'
  | 'rova_conversations'
  | 'flex_history'
  | 'race_goals';

const CHUNK_SIZE = 500;

function timestampForFilename() {
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = `${d.getMonth() + 1}`.padStart(2, '0');
  const DD = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  return `${YYYY}${MM}${DD}_${hh}${mm}${ss}`;
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value: unknown) => {
    if (value == null) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(',')).join('\n');
  return `${header}\n${body}`;
}

async function fetchChunked(table: ExportTable, athleteId: string) {
  let from = 0;
  let keepLoading = true;
  const allRows: Record<string, unknown>[] = [];
  while (keepLoading) {
    const to = from + CHUNK_SIZE - 1;
    const { data, error } =
      table === 'athletes'
        ? await supabase.from('athletes').select('*').eq('id', athleteId).range(from, to)
        : await supabase.from(table).select('*').eq('athlete_id', athleteId).range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    allRows.push(...rows);
    keepLoading = rows.length === CHUNK_SIZE;
    from += CHUNK_SIZE;
  }
  return allRows;
}

async function fetchAllExportData(athleteId: string, onProgress?: ProgressFn) {
  const tables: ExportTable[] = [
    'plans',
    'sessions',
    'session_logs',
    'personal_bests',
    'rova_challenges',
    'rova_conversations',
    'flex_history',
    'race_goals',
  ];
  const data: Record<string, Record<string, unknown>[]> = {};

  const { data: athlete, error: athleteError } = await supabase.from('athletes').select('*').eq('id', athleteId).maybeSingle();
  if (athleteError) throw new Error(athleteError.message);
  data.athletes = athlete ? [athlete as Record<string, unknown>] : [];
  onProgress?.({ step: 'Fetched athlete profile', percent: 10 });

  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i];
    data[table] = await fetchChunked(table, athleteId);
    const pct = Math.min(90, 10 + Math.round(((i + 1) / tables.length) * 75));
    onProgress?.({ step: `Fetched ${table}`, percent: pct });
  }
  return data;
}

export async function exportAllData(athleteId: string, format: ExportFormat, onProgress?: ProgressFn) {
  const dataset = await fetchAllExportData(athleteId, onProgress);
  const stamp = timestampForFilename();

  if (format === 'json') {
    const path = `${FileSystem.cacheDirectory}telo_export_${stamp}.json`;
    const payload = {
      exported_at: new Date().toISOString(),
      athlete_id: athleteId,
      ...dataset,
    };
    await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    onProgress?.({ step: 'Prepared JSON export', percent: 100 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path);
    }
    return { path, format };
  }

  const zip = new JSZip();
  for (const [name, rows] of Object.entries(dataset)) {
    zip.file(`${name}.csv`, toCsv(rows));
  }
  const base64 = await zip.generateAsync({ type: 'base64' });
  const path = `${FileSystem.cacheDirectory}telo_export_${stamp}.zip`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  onProgress?.({ step: 'Prepared CSV zip export', percent: 100 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path);
  }
  return { path, format: 'csv' as const };
}

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { normalizeCompletionStatus } from '@/hooks/useSessionData';
import {
  eachDateInExportRange,
  fetchJournalExportBundle,
} from '@/services/journalExportData';

const BG = '#FAF8F5';
const BURGUNDY = '#7B2D42';
const BODY = '#2C2C2C';
const DIVIDER = 'rgba(123,45,66,0.35)';

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stars(n: number | null | undefined, max = 5): string {
  if (n == null || n < 1) return '—';
  const filled = Math.min(max, Math.max(1, Math.round(n)));
  return `${'★'.repeat(filled)}${'☆'.repeat(max - filled)} <span class="muted">(${filled}/${max})</span>`;
}

function buildJournalPdfHtml(opts: {
  athleteName: string;
  fromIso: string;
  toIso: string;
  bundle: Awaited<ReturnType<typeof fetchJournalExportBundle>>;
}): string {
  const { athleteName, fromIso, toIso, bundle } = opts;
  const reflByDate = new Map(bundle.reflections.map((r) => [r.entry_date, r]));
  const habitName = new Map(bundle.habits.map((h) => [h.id, `${h.icon_emoji} ${h.name}`]));
  const compsByDate = new Map<string, string[]>();
  for (const c of bundle.completions) {
    const arr = compsByDate.get(c.completion_date) ?? [];
    arr.push(c.habit_id);
    compsByDate.set(c.completion_date, arr);
  }

  const habitCounts = new Map<string, number>();
  for (const c of bundle.completions) {
    habitCounts.set(c.habit_id, (habitCounts.get(c.habit_id) ?? 0) + 1);
  }

  const dayPages: string[] = [];
  for (const iso of eachDateInExportRange(fromIso, toIso)) {
    const daySessions = bundle.sessions.filter((s) => s.scheduled_date === iso);
    const completed = daySessions.filter(
      (s) => normalizeCompletionStatus(s.status, s.session_logs as never) === 'completed'
    );
    const planned = daySessions.filter(
      (s) => normalizeCompletionStatus(s.status, s.session_logs as never) !== 'completed'
    );
    const refl = reflByDate.get(iso);
    const dayHabits = compsByDate.get(iso) ?? [];
    if (completed.length === 0 && !refl && dayHabits.length === 0 && planned.length === 0) continue;

    const prettyDate = escapeHtml(
      new Date(`${iso}T12:00:00`).toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    );

    const parts: string[] = [];
    parts.push(`<div class="page day-page">`);
    parts.push(`<h2>${prettyDate}</h2>`);
    parts.push(`<p class="iso">${escapeHtml(iso)}</p>`);

    if (refl) {
      parts.push(`<div class="metrics">`);
      parts.push(`<div class="metric"><span class="metric-label">Mood</span><span class="metric-value">${stars(refl.mood)}</span></div>`);
      parts.push(`<div class="metric"><span class="metric-label">Energy</span><span class="metric-value">${stars(refl.energy)}</span></div>`);
      parts.push(
        `<div class="metric"><span class="metric-label">Sleep</span><span class="metric-value">${
          refl.sleep_quality != null ? stars(refl.sleep_quality) : '—'
        }</span></div>`
      );
      parts.push(`</div>`);
      parts.push(`<h3>Reflection</h3>`);
      parts.push(`<div class="body">${escapeHtml(refl.body_text || '').replace(/\n/g, '<br/>')}</div>`);
    }

    if (planned.length > 0) {
      parts.push(`<h3>Planned sessions</h3><ul>`);
      for (const s of planned) {
        parts.push(`<li>${escapeHtml(s.title)} <span class="muted">(${escapeHtml(s.sport)})</span></li>`);
      }
      parts.push(`</ul>`);
    }

    if (completed.length > 0) {
      parts.push(`<h3>Completed sessions</h3><ul>`);
      for (const s of completed) {
        const mins = s.duration_mins != null ? `${s.duration_mins} min` : '—';
        parts.push(
          `<li><strong>${escapeHtml(s.title)}</strong> <span class="muted">(${escapeHtml(s.sport)})</span> · ${escapeHtml(mins)}</li>`
        );
      }
      parts.push(`</ul>`);
    }

    if (dayHabits.length > 0) {
      parts.push(`<h3>Habits</h3><ul>`);
      for (const hid of dayHabits) {
        parts.push(`<li>✓ ${escapeHtml(habitName.get(hid) ?? hid)}</li>`);
      }
      parts.push(`</ul>`);
    }

    parts.push(
      `<div class="page-footer"><span class="brand">telo</span><span class="range">${escapeHtml(fromIso)} – ${escapeHtml(
        toIso
      )}</span></div>`
    );
    parts.push(`</div>`);
    dayPages.push(parts.join('\n'));
  }

  const summaryRows = bundle.habits
    .map((h) => {
      const c = habitCounts.get(h.id) ?? 0;
      return `<tr><td>${escapeHtml(`${h.icon_emoji} ${h.name}`)}</td><td class="num">${c}</td></tr>`;
    })
    .join('\n');

  const summaryBlock =
    bundle.habits.length > 0
      ? `
  <div class="page summary-page">
    <h2>Habit summary</h2>
    <p class="subtle">Days marked complete in this export range.</p>
    <table class="habit-table">
      <thead><tr><th>Habit</th><th>Days</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>
    <div class="page-footer"><span class="brand">telo</span><span class="range">${escapeHtml(fromIso)} – ${escapeHtml(
        toIso
      )}</span></div>
  </div>`
      : '';

  const cover = `
  <div class="page cover-page">
    <div class="cover-brand">telo</div>
    <h1 class="cover-title">Journal</h1>
    <p class="cover-meta">${escapeHtml(athleteName)}</p>
    <p class="cover-range">${escapeHtml(fromIso)} → ${escapeHtml(toIso)}</p>
    <div class="cover-rule"></div>
    <p class="cover-note">Training reflections, sessions &amp; habits</p>
    <div class="page-footer cover-footer"><span class="brand">telo</span><span class="range">${escapeHtml(
      fromIso
    )} – ${escapeHtml(toIso)}</span></div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap" rel="stylesheet"/>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: ${BODY};
      background: ${BG};
    }
    .page {
      page-break-after: always;
      padding: 40px 44px 52px;
      min-height: 100vh;
      position: relative;
      background: ${BG};
    }
    .page:last-of-type { page-break-after: auto; }
    h1, h2, h3 {
      font-family: 'Cormorant Garamond', 'Times New Roman', serif;
      color: ${BURGUNDY};
      font-weight: 700;
      margin: 0 0 8px;
    }
    h1 { font-size: 34pt; }
    h2 { font-size: 22pt; border-bottom: 1px solid ${DIVIDER}; padding-bottom: 6px; margin-bottom: 12px; }
    h3 { font-size: 14pt; margin-top: 16px; margin-bottom: 8px; }
    .iso { font-size: 9pt; color: #666; margin: 0 0 16px; }
    .metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 20px;
      margin-bottom: 12px;
    }
    .metric { min-width: 140px; }
    .metric-label { display: block; font-size: 8pt; letter-spacing: 0.08em; text-transform: uppercase; color: ${BURGUNDY}; font-weight: 600; }
    .metric-value { font-size: 11pt; }
    .body { white-space: pre-wrap; margin-top: 4px; }
    ul { margin: 6px 0 0 18px; padding: 0; }
    li { margin-bottom: 4px; }
    .muted { color: #666; font-weight: 400; }
    .subtle { color: #666; font-size: 10pt; margin-top: 0; }
    .cover-page { text-align: center; padding-top: 72px; }
    .cover-brand {
      font-family: 'Cormorant Garamond', serif;
      font-size: 48pt;
      color: ${BURGUNDY};
      letter-spacing: 0.04em;
    }
    .cover-title { font-size: 28pt; margin-top: 12px; border: none; }
    .cover-meta { font-size: 13pt; margin: 8px 0 0; }
    .cover-range { font-size: 12pt; color: #555; margin: 4px 0 0; }
    .cover-rule { width: 120px; height: 2px; background: ${BURGUNDY}; margin: 28px auto; opacity: 0.5; }
    .cover-note { font-size: 10pt; color: #666; font-style: italic; }
    .cover-footer { position: absolute; bottom: 36px; left: 44px; right: 44px; }
    .page-footer {
      position: absolute;
      bottom: 28px;
      left: 44px;
      right: 44px;
      border-top: 1px solid ${DIVIDER};
      padding-top: 10px;
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      color: ${BURGUNDY};
    }
    .page-footer .brand { font-family: 'Cormorant Garamond', serif; font-weight: 700; font-size: 12pt; }
    .habit-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .habit-table th, .habit-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid ${DIVIDER}; }
    .habit-table th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: ${BURGUNDY}; }
    .habit-table .num { text-align: right; width: 72px; }
  </style>
</head>
<body>
  ${cover}
  ${dayPages.join('\n')}
  ${summaryBlock}
</body>
</html>`;
}

/**
 * Renders a branded PDF and opens the share sheet (native). Web is not supported for file PDF; use Markdown.
 */
export async function shareJournalPdfExport(opts: {
  athleteId: string;
  fromIso: string;
  toIso: string;
  athleteName?: string;
}): Promise<string> {
  if (Platform.OS === 'web') {
    throw new Error('PDF export runs on the iOS and Android apps. On web, use Markdown export.');
  }

  const { athleteId, fromIso, toIso, athleteName } = opts;
  const bundle = await fetchJournalExportBundle({ athleteId, fromIso, toIso });
  const html = buildJournalPdfHtml({
    athleteName: athleteName ?? 'Athlete',
    fromIso,
    toIso,
    bundle,
  });

  const { uri } = await Print.printToFileAsync({
    html,
    width: 612,
    height: 792,
    margins: { left: 0, right: 0, top: 0, bottom: 0 },
  });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Export journal',
      ...(Platform.OS === 'ios' ? { UTI: 'com.adobe.pdf' as const } : {}),
    });
  }

  return uri;
}

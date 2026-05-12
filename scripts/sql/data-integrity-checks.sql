-- Run in Supabase SQL Editor (service role / dashboard).
-- Orphan detection for core session graph

-- 1) Sessions missing plan
SELECT s.id, s.plan_id, s.title, s.scheduled_date
FROM sessions s
LEFT JOIN plans p ON s.plan_id = p.id
WHERE p.id IS NULL
LIMIT 50;

-- 2) Blocks missing session
SELECT sb.id, sb.session_id, sb.title
FROM session_blocks sb
LEFT JOIN sessions s ON sb.session_id = s.id
WHERE s.id IS NULL
LIMIT 50;

-- 3) Steps missing block
SELECT ss.id, ss.block_id, ss.step_text
FROM session_steps ss
LEFT JOIN session_blocks sb ON ss.block_id = sb.id
WHERE sb.id IS NULL
LIMIT 50;

-- 4) Logs missing session
SELECT sl.id, sl.session_id
FROM session_logs sl
LEFT JOIN sessions s ON sl.session_id = s.id
WHERE s.id IS NULL
LIMIT 50;

-- 5) Planned sessions in next 14 days with zero blocks (breaks detail UX)
SELECT s.id, s.title, s.scheduled_date, COUNT(sb.id) AS block_count
FROM sessions s
LEFT JOIN session_blocks sb ON sb.session_id = s.id
WHERE s.scheduled_date >= (CURRENT_DATE AT TIME ZONE 'UTC')::date
  AND s.scheduled_date < (CURRENT_DATE AT TIME ZONE 'UTC')::date + 14
GROUP BY s.id, s.title, s.scheduled_date
HAVING COUNT(sb.id) = 0;

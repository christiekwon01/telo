-- Telo FK / orphan diagnostics — run in Supabase SQL Editor (service role or owner).
-- STEP 2 — Foreign key integrity spot checks

-- 1) Sessions with invalid plan_id
SELECT s.id, s.plan_id, p.id AS plan_exists
FROM public.sessions s
LEFT JOIN public.plans p ON s.plan_id = p.id
WHERE p.id IS NULL
LIMIT 50;

-- 2) Session blocks with invalid session_id
SELECT sb.id, sb.session_id
FROM public.session_blocks sb
LEFT JOIN public.sessions s ON sb.session_id = s.id
WHERE s.id IS NULL
LIMIT 50;

-- 3) Session steps with invalid block_id
SELECT ss.id, ss.block_id
FROM public.session_steps ss
LEFT JOIN public.session_blocks sb ON ss.block_id = sb.id
WHERE sb.id IS NULL
LIMIT 50;

-- 4) Session logs with invalid session_id
SELECT sl.id, sl.session_id
FROM public.session_logs sl
LEFT JOIN public.sessions s ON sl.session_id = s.id
WHERE s.id IS NULL
LIMIT 50;

-- STEP 5 — Sessions in next 7 days with zero blocks (breaks detail UX)
SELECT s.id, s.title, s.scheduled_date, COUNT(sb.id) AS block_count
FROM public.sessions s
LEFT JOIN public.session_blocks sb ON sb.session_id = s.id
WHERE s.scheduled_date >= CURRENT_DATE
  AND s.scheduled_date < CURRENT_DATE + INTERVAL '7 days'
GROUP BY s.id, s.title, s.scheduled_date
HAVING COUNT(sb.id) = 0
ORDER BY s.scheduled_date ASC;

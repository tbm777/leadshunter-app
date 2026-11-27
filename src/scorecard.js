import { ptMidnight } from './worker.js';

// Engine scorecard: each production target, measured from stored job stats and the database.
// Output is aggregates only (counts, durations, percentages), so it is safe to print in public logs.

export const TARGETS = {
  speed_p50_s: 15, speed_p95_s: 45, per_runner_min: 40,
  false_sent_pct: 1, detection_pct: 95, fields_pct: 98,
  double_sends: 0, stuck_jobs: 0, daily_volume: 1000,
};

const pct = (v, p) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

export async function scorecard(env, days = 7) {
  const since = Date.now() - days * 864e5;
  const rows = (await env.DB.prepare('SELECT job_id, kind, mode, started_at, finished_at, status, data FROM job_metrics WHERE finished_at >= ? ORDER BY finished_at DESC LIMIT 2000').bind(since).all()).results;
  const jobs = rows.map(r => ({ ...r, d: JSON.parse(r.data || '{}') }));
  const out = jobs.filter(j => j.kind === 'outreach'), srch = jobs.filter(j => j.kind === 'search');

  // Speed: exact percentiles from raw per-form durations (stored in tenths of a second).
  const raw = (list, key) => list.flatMap(j => (j.d.raw && j.d.raw[key]) || []).map(x => x / 10);
  const totals = raw(out, 'total');
  const stage = (k) => ({ p50: r1(pct(raw(out, k), 0.5)), p95: r1(pct(raw(out, k), 0.95)) });
  // Throughput: forms per minute of runner time, per job, normalised to the job's concurrency.
  const perMin = out.filter(j => j.d.items && j.d.wall_ms > 0).map(j => j.d.items / (j.d.wall_ms / 60000));
  const outcome = {}, reason = {}, tools = {};
  for (const j of out) {
    for (const [k, v] of Object.entries(j.d.counts?.outcome || {})) outcome[k] = (outcome[k] || 0) + v;
    for (const [k, v] of Object.entries(j.d.counts?.reason || {})) reason[k] = (reason[k] || 0) + v;
    for (const [t, g] of Object.entries(j.d.groups?.tool || {})) { const a = (tools[t] ||= {}); for (const [k, v] of Object.entries(g)) a[k] = (a[k] || 0) + v; }
  }

  // Reliability straight from the database.
  const dbl = await env.DB.prepare(`SELECT COUNT(*) AS n FROM (SELECT outreach_id, step FROM outreach_events WHERE kind IN ('sent','submitted','sent_manual') AND at >= ? GROUP BY outreach_id, step HAVING COUNT(*) > 1)`).bind(since).first();
  const stuck = await env.DB.prepare(`SELECT COUNT(*) AS n FROM searches WHERE status IN ('running','queued') AND COALESCE(heartbeat_at, created_at) < ?`).bind(Date.now() - 30 * 60000).first();
  const failedJobs = jobs.filter(j => j.status === 'failed').length;
  const today = ptMidnight();
  const sentToday = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM outreach WHERE sent_at >= ? AND status IN ('sent','submitted','sent_manual')`).bind(today).first()).n;

  // Cost: runner minutes per day (GitHub bills whole minutes per job).
  const minutes = jobs.reduce((a, j) => a + Math.ceil(((j.finished_at - (j.started_at || j.finished_at)) || j.d.wall_ms || 0) / 60000), 0);
  const formsDone = out.reduce((a, j) => a + (j.d.items || 0), 0);

  // External checks recorded by the accuracy and delivery tests (Phase 2).
  const ext = Object.fromEntries((await env.DB.prepare(`SELECT k, v FROM meta WHERE k LIKE 'score:%'`).all()).results.map(r => [r.k.slice(6), JSON.parse(r.v)]));

  const T = TARGETS, p50 = r1(pct(totals, 0.5)), p95 = r1(pct(totals, 0.95)), thr = r1(pct(perMin, 0.5));
  const check = (id, label, value, unit, pass, note) => ({ id, label, value, unit, pass: value == null ? null : pass, note });
  const lines = [
    check('speed_p50', 'Typical time per form', p50, 's', p50 <= T.speed_p50_s, `target ≤ ${T.speed_p50_s} s`),
    check('speed_p95', 'Slowest 5% per form', p95, 's', p95 <= T.speed_p95_s, `target ≤ ${T.speed_p95_s} s`),
    check('throughput', 'Forms per runner minute', thr, '/min', thr >= T.per_runner_min, `target ≥ ${T.per_runner_min}`),
    check('double_sends', 'Double sends', dbl.n, '', dbl.n <= T.double_sends, 'target 0'),
    check('stuck_jobs', 'Stuck jobs (no heartbeat 30 min)', stuck.n, '', stuck.n <= T.stuck_jobs, 'target 0'),
    check('detection', 'Form detection accuracy', ext.detection?.pct ?? null, '%', (ext.detection?.pct ?? 0) >= T.detection_pct, ext.detection ? `${ext.detection.n} sites, ${ext.detection.at}` : 'needs the answer-key test'),
    check('fields', 'Fields filled correctly', ext.fields?.pct ?? null, '%', (ext.fields?.pct ?? 0) >= T.fields_pct, ext.fields ? `${ext.fields.n} forms, ${ext.fields.at}` : 'needs the fill review'),
    check('false_sent', 'False "Sent"', ext.false_sent?.pct ?? null, '%', (ext.false_sent?.pct ?? 100) < T.false_sent_pct, ext.false_sent ? `${ext.false_sent.n} test sends, ${ext.false_sent.at}` : 'needs the delivery test'),
  ];
  return {
    days, generated_at: Date.now(), targets: T, lines,
    detail: {
      outreach_jobs: out.length, search_jobs: srch.length, failed_jobs: failedJobs, forms: formsDone, sent_today: sentToday,
      stages: Object.fromEntries(['open', 'settle', 'find', 'fill', 'submit'].map(k => [k, stage(k)])),
      outcome, reason, tools,
      search: { map_search: { p50: r1(pct(raw(srch, 'map_search'), 0.5)), p95: r1(pct(raw(srch, 'map_search'), 0.95)) }, check_total: { p50: r1(pct(raw(srch, 'check_total'), 0.5)), p95: r1(pct(raw(srch, 'check_total'), 0.95)) } },
      runner_minutes: minutes, minutes_per_1000_forms: formsDone ? Math.round(minutes / formsDone * 1000) : null,
    },
  };
}

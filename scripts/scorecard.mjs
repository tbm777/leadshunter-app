// Engine scorecard: prints each production target as pass/fail, plus free-tier usage.
// Aggregates only (counts, durations, percentages): GitHub logs on a public repo are public.
// Env: LH_API, RUNNER_SECRET (scorecard), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (usage, optional), DAYS.
import { appendFileSync } from 'node:fs';

const API = (process.env.LH_API || 'https://leadshunter.thebatsystems.workers.dev').replace(/\/$/, '');
const DAYS = +process.env.DAYS || 7;
const out = [];
const say = (s = '') => { console.log(s); out.push(s); };

const res = await fetch(`${API}/api/runner/scorecard?days=${DAYS}`, { headers: { authorization: `Bearer ${process.env.RUNNER_SECRET}` } });
if (!res.ok) { console.error('Scorecard request failed:', res.status); process.exit(1); }
const sc = await res.json();
const mark = (p) => (p === true ? 'PASS' : p === false ? 'FAIL' : 'NOT MEASURED');

say(`## Engine scorecard, last ${sc.days} days`);
say('');
say('| Target | Value | Result | Note |');
say('| --- | --- | --- | --- |');
for (const l of sc.lines) say(`| ${l.label} | ${l.value == null ? '-' : l.value + (l.unit ? ' ' + l.unit : '')} | ${mark(l.pass)} | ${l.note} |`);

const d = sc.detail;
say('');
say(`Jobs: ${d.outreach_jobs} outreach, ${d.search_jobs} search, ${d.failed_jobs} failed. Forms handled: ${d.forms}. Sent today: ${d.sent_today}.`);
say(`Form stages, p50/p95 seconds: ${Object.entries(d.stages).map(([k, v]) => `${k} ${v.p50 ?? '-'}/${v.p95 ?? '-'}`).join(' · ')}`);
say(`Search: map search p50 ${d.search.map_search.p50 ?? '-'} s, site check p50 ${d.search.check_total.p50 ?? '-'} s.`);
say(`Outcomes: ${Object.entries(d.outcome).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
say(`Reasons: ${Object.entries(d.reason).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`);
say(`By form tool: ${Object.entries(d.tools).sort((a, b) => b[1].n - a[1].n).map(([t, g]) => `${t} ${g.n} (ok ${(g.confirmed || 0) + (g.ready || 0)})`).join(', ') || '-'}`);
say(`Runner time: ${d.runner_minutes} min${d.minutes_per_1000_forms != null ? `, about ${d.minutes_per_1000_forms} min per 1,000 forms` : ''}.`);

// Free-tier usage from Cloudflare analytics (needs an API token with Analytics read; skipped otherwise).
const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (TOKEN && ACCOUNT) {
  try {
    const end = new Date(), start = new Date(end - DAYS * 864e5);
    const day = (x) => x.toISOString().slice(0, 10);
    const query = `query($a: String!, $s: Date!, $e: Date!) { viewer { accounts(filter: {accountTag: $a}) {
      d1AnalyticsAdaptiveGroups(limit: 100, filter: {date_geq: $s, date_leq: $e}) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date } }
      workersInvocationsAdaptive(limit: 100, filter: {date_geq: $s, date_leq: $e}) { sum { requests errors } dimensions { date } }
      kvOperationsAdaptiveGroups(limit: 200, filter: {date_geq: $s, date_leq: $e}) { sum { requests } dimensions { date actionType } }
    } } }`;
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { a: ACCOUNT, s: day(start), e: day(end) } }) });
    const j = await r.json();
    if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
    const acc = j.data.viewer.accounts[0];
    const byDay = (rows, f) => { const m = {}; for (const x of rows) { const k = x.dimensions.date; m[k] = (m[k] || 0) + f(x); } return Object.values(m); };
    const peak = (v) => (v.length ? Math.max(...v) : 0);
    const kvWrites = byDay(acc.kvOperationsAdaptiveGroups.filter(x => /write|put|delete/i.test(x.dimensions.actionType)), x => x.sum.requests);
    const rows = [
      ['Database rows read', peak(byDay(acc.d1AnalyticsAdaptiveGroups, x => x.sum.rowsRead)), 5_000_000],
      ['Database rows written', peak(byDay(acc.d1AnalyticsAdaptiveGroups, x => x.sum.rowsWritten)), 100_000],
      ['Worker requests', peak(byDay(acc.workersInvocationsAdaptive, x => x.sum.requests)), 100_000],
      ['Storage (KV) writes', peak(kvWrites), 1_000],
    ];
    say('');
    say('| Cloudflare free limit | Busiest day | Daily limit | Used |');
    say('| --- | --- | --- | --- |');
    for (const [k, v, lim] of rows) say(`| ${k} | ${v.toLocaleString('en-US')} | ${lim.toLocaleString('en-US')} | ${Math.round(v / lim * 100)}% |`);
  } catch (e) { say(''); say(`Cloudflare usage not available: ${String(e.message).slice(0, 160)}`); }
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');

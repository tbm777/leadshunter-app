// Cloudflare usage report: the last 3 days (UTC, like the free limits) and today's heaviest database queries.
// Totals and query text only (queries use placeholders, so no lead data). Env: CF_ANALYTICS_TOKEN, CLOUDFLARE_ACCOUNT_ID.
import { appendFileSync } from 'node:fs';
const T = process.env.CF_ANALYTICS_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
const out = []; const say = (s = '') => { console.log(s); out.push(s); };
async function q(query, vars) {
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: `Bearer ${T}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { a: A, ...vars } }) });
  const j = await r.json(); if (j.errors?.length) throw new Error(j.errors[0].message); return j.data.viewer.accounts[0];
}
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const from = day(2), to = day(0);
const L = { requests: 100000, rowsRead: 5000000, rowsWritten: 100000, kvRead: 100000, kvWrite: 1000 };
const pct = (v, l) => `${Math.round(v / l * 100)}%`;
const fmt = v => Math.round(v).toLocaleString('en-US');
const by = {};
const add = (d, k, v) => { (by[d] ||= {})[k] = ((by[d] || {})[k] || 0) + (+v || 0); };
const tryq = async (name, fn) => { try { await fn(); } catch (e) { say(`(${name} not available: ${e.message})`); } };
await tryq('workers', async () => { for (const r of (await q('query($a:String!,$f:Date!,$t:Date!){viewer{accounts(filter:{accountTag:$a}){rows:workersInvocationsAdaptive(limit:1000,filter:{date_geq:$f,date_leq:$t}){sum{requests errors subrequests} dimensions{date scriptName}}}}}', { f: from, t: to })).rows) { add(r.dimensions.date, 'requests', r.sum.requests); add(r.dimensions.date, 'errors', r.sum.errors); add(r.dimensions.date, 'subrequests', r.sum.subrequests); } });
await tryq('d1', async () => { for (const r of (await q('query($a:String!,$f:Date!,$t:Date!){viewer{accounts(filter:{accountTag:$a}){rows:d1AnalyticsAdaptiveGroups(limit:1000,filter:{date_geq:$f,date_leq:$t}){sum{rowsRead rowsWritten readQueries writeQueries} dimensions{date}}}}}', { f: from, t: to })).rows) { add(r.dimensions.date, 'rowsRead', r.sum.rowsRead); add(r.dimensions.date, 'rowsWritten', r.sum.rowsWritten); add(r.dimensions.date, 'queries', r.sum.readQueries + r.sum.writeQueries); } });
await tryq('kv', async () => { for (const r of (await q('query($a:String!,$f:Date!,$t:Date!){viewer{accounts(filter:{accountTag:$a}){rows:kvOperationsAdaptiveGroups(limit:1000,filter:{date_geq:$f,date_leq:$t}){sum{requests} dimensions{date actionType}}}}}', { f: from, t: to })).rows) add(r.dimensions.date, 'kv_' + String(r.dimensions.actionType).toLowerCase(), r.sum.requests); });
say(`## Cloudflare usage, ${from} to ${to} (UTC days; free limits reset at midnight UTC)`);
say('');
say('| Day | Worker requests | Errors | D1 rows read | D1 rows written | D1 queries | KV reads | KV writes |');
say('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const d of Object.keys(by).sort()) { const x = by[d]; say(`| ${d} | ${fmt(x.requests || 0)} (${pct(x.requests || 0, L.requests)}) | ${fmt(x.errors || 0)} | ${fmt(x.rowsRead || 0)} (${pct(x.rowsRead || 0, L.rowsRead)}) | ${fmt(x.rowsWritten || 0)} (${pct(x.rowsWritten || 0, L.rowsWritten)}) | ${fmt(x.queries || 0)} | ${fmt(x.kv_read || 0)} | ${fmt(x.kv_write || 0)} (${pct(x.kv_write || 0, L.kvWrite)}) |`); }
say('');
say('Free limits a day: 100,000 Worker requests, 5,000,000 D1 rows read, 100,000 D1 rows written, 100,000 KV reads, 1,000 KV writes.');
await tryq('d1 queries', async () => {
  const rows = (await q('query($a:String!,$f:Date!,$t:Date!){viewer{accounts(filter:{accountTag:$a}){rows:d1QueriesAdaptiveGroups(limit:15,filter:{date_geq:$f,date_leq:$t},orderBy:[sum_rowsRead_DESC]){count sum{rowsRead rowsWritten} dimensions{query}}}}}', { f: to, t: to })).rows;
  say(''); say(`### Queries that read the most rows today (${to})`); say('');
  say('| Rows read | Rows written | Times run | Query |'); say('| --- | --- | --- | --- |');
  for (const r of rows) say(`| ${fmt(r.sum.rowsRead)} | ${fmt(r.sum.rowsWritten)} | ${fmt(r.count)} | \`${String(r.dimensions.query).replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 220)}\` |`);
});
await tryq('d1 writes', async () => {
  const rows = (await q('query($a:String!,$f:Date!,$t:Date!){viewer{accounts(filter:{accountTag:$a}){rows:d1QueriesAdaptiveGroups(limit:10,filter:{date_geq:$f,date_leq:$t},orderBy:[sum_rowsWritten_DESC]){count sum{rowsRead rowsWritten} dimensions{query}}}}}', { f: to, t: to })).rows;
  say(''); say(`### Queries that wrote the most rows today (${to})`); say('');
  say('| Rows written | Times run | Query |'); say('| --- | --- | --- |');
  for (const r of rows) say(`| ${fmt(r.sum.rowsWritten)} | ${fmt(r.count)} | \`${String(r.dimensions.query).replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 220)}\` |`);
});
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');

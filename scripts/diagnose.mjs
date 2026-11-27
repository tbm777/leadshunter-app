// Prints totals and patterns only (no business names, URLs or contact details): GitHub logs on a public repo are public.
const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const cf = async (method, path, body) => { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!j.success) throw new Error(JSON.stringify(j.errors)); return j.result; };
const db = (await cf('GET', '/d1/database?name=leadshunter')).find(d => d.name === 'leadshunter');
const q = async (sql) => (await cf('POST', `/d1/database/${db.uuid}/query`, { sql }))[0].results;
const table = (title, rows) => { console.log(`\n== ${title}`); for (const r of rows) console.log('  ' + Object.values(r).map(v => v === null ? '-' : String(v)).join(' | ')); };
const FORM = ['open', 'captcha', 'none', 'not checked', 'needs browser'];

table('Leads by form check result, CAPTCHA type (count)', (await q('SELECT form_status, captcha, COUNT(*) n FROM leads WHERE deleted = 0 GROUP BY 1, 2 ORDER BY n DESC')).map(r => ({ f: FORM[r.form_status], c: r.captcha, n: r.n })));
table('Leads by platform and form check (count)', (await q("SELECT COALESCE(platform,'?') p, form_status, COUNT(*) n FROM leads WHERE deleted = 0 AND website IS NOT NULL GROUP BY 1, 2 ORDER BY n DESC LIMIT 40")).map(r => ({ p: r.p, f: FORM[r.form_status], n: r.n })));
table('Outreach: status, reason (count)', await q('SELECT status, reason, COUNT(*) n FROM outreach GROUP BY 1, 2 ORDER BY n DESC'));
table('Test runs: result, reason (count)', await q('SELECT test_status, test_reason, COUNT(*) n FROM outreach WHERE test_status IS NOT NULL GROUP BY 1, 2 ORDER BY n DESC'));
table('Check said X, robot found Y (form check | captcha type | platform | robot result | reason | count)', (await q(`SELECT l.form_status, l.captcha, COALESCE(l.platform,'?') p, COALESCE(o.test_status, o.status) st, COALESCE(o.test_reason, o.reason) r, COUNT(*) n
  FROM outreach o JOIN leads l ON l.id = o.lead_id WHERE COALESCE(o.test_status, o.status) NOT IN ('queued') GROUP BY 1,2,3,4,5 ORDER BY n DESC LIMIT 60`)).map(r => ({ f: FORM[r.form_status], c: r.captcha, p: r.p, st: r.st, r: r.r, n: r.n })));
// Hosts shared by 3+ leads are platforms (directories, builders), not businesses, so they are safe to print.
const sites = await q('SELECT website, form_status FROM leads WHERE deleted = 0 AND website IS NOT NULL');
const hosts = {};
for (const s of sites) { let h; try { h = new URL(s.website).hostname.replace(/^www\./, ''); } catch { continue; } const k = h.split('.').slice(-2).join('.'); (hosts[k] ||= { n: 0, open: 0 }).n++; if (s.form_status === 0) hosts[k].open++; }
table('Website hosts shared by 3+ leads (host | leads | marked open form)', Object.entries(hosts).filter(([, v]) => v.n >= 3).sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([h, v]) => ({ h, n: v.n, o: v.open })));
table('Form URL path patterns for open forms (path shape | count)', Object.entries((await q('SELECT form_url FROM leads WHERE deleted = 0 AND form_status = 0 AND form_url IS NOT NULL')).reduce((a, r) => { let p = '/'; try { p = new URL(r.form_url).pathname.toLowerCase().split('/').filter(Boolean).slice(0, 1).join('/') || '/'; } catch { } p = /contact|quote|estimate|request|book|schedule|appoint/.test(p) ? p.replace(/[^a-z-]/g, '').slice(0, 30) : p === '/' ? '/' : '(other)'; a[p] = (a[p] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, n]) => ({ p, n })));
table('Searches with a form filter (filter | searches | qualified)', (await q("SELECT json_extract(params,'$.form') f, COUNT(*) n, SUM(qualified) q FROM searches WHERE kind = 'search' GROUP BY 1")));

// The latest search: yield per map search, duplicates and form-check outcomes (totals only).
const last = (await q("SELECT id, status, total_tasks, done_tasks, found, new_count, dup, excluded, filtered, qualified, to_check, checked, limit_n, params FROM searches WHERE kind = 'search' ORDER BY id DESC LIMIT 1"))[0];
if (last) {
  const p = JSON.parse(last.params || '{}');
  table('Latest search (status | map searches done/total | results found | new | duplicates | excluded by category | filtered | qualified | websites to check/checked | limit)', [{ a: last.status, b: `${last.done_tasks}/${last.total_tasks}`, c: last.found, d: last.new_count, e: last.dup, f: last.excluded, g: last.filtered, h: last.qualified, i: `${last.to_check}/${last.checked}`, j: last.limit_n }]);
  table('Latest search settings (terms | form filter | website | reviews)', [{ t: (p.terms || []).length + ' terms', f: p.form || 'any', w: p.website || 'any', r: `${p.minReviews || 0}-${p.maxReviews ?? 'any'}` }]);
  const m = (await q(`SELECT data FROM job_metrics WHERE job_id = ${last.id}`))[0];
  if (m) {
    const d = JSON.parse(m.data), mr = d.stages?.map_results || {}, ms = d.stages?.map_search || {};
    table('Latest search: results per map search (searches | typical | average | most | typical time s)', [{ n: mr.n, p50: mr.p50, avg: mr.mean, max: mr.max, t: ms.p50 ? (ms.p50 / 1000).toFixed(1) : '-' }]);
    table('Latest search: website check outcomes (site status | count)', Object.entries(d.counts?.site || {}).map(([k, v]) => ({ k: ['loads', 'slow', 'down', 'not checked', 'no site', 'blocked', 'parked', 'social'][+k] || k, v })));
    table('Latest search: form check outcomes (form | count)', Object.entries(d.counts?.form || {}).map(([k, v]) => ({ k: FORM[+k] || k, v })));
  }
  table('Latest search leads by form check (form | count)', (await q(`SELECT form_status, COUNT(*) n FROM leads WHERE search_id = ${last.id} AND deleted = 0 GROUP BY 1`)).map(r => ({ f: FORM[r.form_status], n: r.n })));
}

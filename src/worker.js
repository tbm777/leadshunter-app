// LeadsHunter API Worker. Serves the app (static assets), the JSON API and the runner endpoints.
import { buildCells } from '../public/shared/grid.js';
import { cleanWebsite, domainOf, isSharedDomain, phoneE164, countryCode, categoryAccepted } from '../public/shared/normalize.js';

const MAX_TASKS = 6000;              // map searches per search job
const STALE_MS = 15 * 60 * 1000;     // a running job with no heartbeat for this long is marked failed
const SESSION_DAYS = 30;
export const LEAD_COLS = ['id', 'seq', 'name', 'industry_id', 'city', 'region', 'country', 'rating', 'reviews', 'phone', 'website',
  'site_status', 'form_status', 'captcha', 'platform', 'email', 'status', 'closed', 'created_at', 'search_id', 'category', 'address',
  'postal', 'maps_url', 'notes', 'deleted', 'checked_at', 'form_url', 'site_ms', 'lat', 'lon'];
const COLS_SQL = LEAD_COLS.join(', ');

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const fail = (status, error) => json({ error }, status);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const now = () => Date.now();

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, { ...env, ORIGIN: url.origin }, url, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      console.error('API error', url.pathname, e && e.stack || e);
      return fail(500, 'Something went wrong on the server. Try again in a moment.');
    }
  },
  async scheduled(_evt, env, ctx) {
    ctx.waitUntil(reclaimStale(env));
  },
};

/* ------------------------------------------------------------------ routing */
async function route(req, env, url, ctx) {
  const p = url.pathname, m = req.method;
  if (p.startsWith('/api/runner/')) {
    await requireRunner(req, env);
    return runnerRoute(req, env, url);
  }
  if (p === '/api/login' && m === 'POST') return login(req, env);
  if (p === '/api/logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  const session = await readSession(req, env);
  if (!session) return fail(401, 'Please sign in.');
  if (p === '/api/me') return json({ ok: true, configured: configCheck(env) });

  if (p === '/api/bootstrap' && m === 'GET') return bootstrap(env);
  if (p === '/api/industries' && m === 'POST') return saveIndustry(env, await body(req));
  let mm;
  if ((mm = p.match(/^\/api\/industries\/(\d+)$/))) {
    if (m === 'PUT') return saveIndustry(env, await body(req), +mm[1]);
    if (m === 'DELETE') return archiveIndustry(env, +mm[1], 1);
  }
  if ((mm = p.match(/^\/api\/industries\/(\d+)\/restore$/)) && m === 'POST') return archiveIndustry(env, +mm[1], 0);
  if ((mm = p.match(/^\/api\/industries\/(\d+)\/categories$/)) && m === 'POST') return addCategory(env, +mm[1], await body(req));

  if (p === '/api/searches' && m === 'GET') return listSearches(env, url);
  if (p === '/api/searches' && m === 'POST') return createSearch(env, await body(req));
  if ((mm = p.match(/^\/api\/searches\/(\d+)$/)) && m === 'GET') return getSearch(env, +mm[1]);
  if ((mm = p.match(/^\/api\/searches\/(\d+)\/cancel$/)) && m === 'POST') return cancelSearch(env, +mm[1]);
  if ((mm = p.match(/^\/api\/searches\/(\d+)\/retry$/)) && m === 'POST') return retrySearch(env, +mm[1]);
  if ((mm = p.match(/^\/api\/searches\/(\d+)\/excluded$/)) && m === 'GET') return listExcluded(env, +mm[1]);
  if (p === '/api/checks' && m === 'POST') return createCheck(env, await body(req));

  if (p === '/api/snapshot' && m === 'GET') return getSnapshot(env);
  if (p === '/api/changes' && m === 'GET') return getChanges(env, url);
  if ((mm = p.match(/^\/api\/leads\/(\d+)$/)) && m === 'PATCH') return patchLead(env, +mm[1], await body(req));
  if (p === '/api/leads/bulk' && m === 'POST') return bulkLeads(env, await body(req));

  if (p === '/api/views' && m === 'GET') return json({ views: (await env.DB.prepare('SELECT id, name, filters FROM views ORDER BY id').all()).results });
  if (p === '/api/views' && m === 'POST') return saveView(env, await body(req));
  if ((mm = p.match(/^\/api\/views\/(\d+)$/)) && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM views WHERE id = ?').bind(+mm[1]).run();
    return json({ ok: true });
  }
  return fail(404, 'Not found.');
}

async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'The request body was not valid JSON.'); }
}

function configCheck(env) {
  return { github: !!(env.GH_TOKEN && env.GH_REPO && !env.GH_REPO.startsWith('__')), runner: !!env.RUNNER_SECRET };
}

/* ------------------------------------------------------------------ auth */
const enc = new TextEncoder();
async function hmacKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('lh-session:' + (env.RUNNER_SECRET || '') + ':' + (env.APP_PASSWORD || '')));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
function cookie(value, maxAge) {
  return `lh_s=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0 && a.length === b.length;
}
async function login(req, env) {
  if (!env.APP_PASSWORD) return fail(503, 'The app password is not set yet. Add the APP_PASSWORD secret and deploy again.');
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const key = 'login-fail:' + ip;
  const fails = +(await env.KV.get(key) || 0);
  if (fails >= 10) return fail(429, 'Too many wrong passwords. Wait 15 minutes and try again.');
  const { password } = await body(req);
  if (typeof password !== 'string' || !(await safeEqual(password, env.APP_PASSWORD))) {
    await env.KV.put(key, String(fails + 1), { expirationTtl: 900 });
    return fail(401, 'That password is not correct.');
  }
  const exp = now() + SESSION_DAYS * 864e5;
  const payload = b64u(enc.encode(JSON.stringify({ exp })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload)));
  return json({ ok: true }, 200, { 'set-cookie': cookie(payload + '.' + sig, SESSION_DAYS * 86400) });
}
async function readSession(req, env) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)lh_s=([^;]+)/);
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return data.exp > now() ? data : null;
  } catch { return null; }
}
async function requireRunner(req, env) {
  const h = req.headers.get('authorization') || '';
  if (!env.RUNNER_SECRET || !h.startsWith('Bearer ') || !(await safeEqual(h.slice(7), env.RUNNER_SECRET))) throw new HttpError(401, 'Runner not authorised.');
}

/* ------------------------------------------------------------------ helpers */
/** Reserve n consecutive sequence numbers. D1 runs writes one at a time, so ranges never overlap. */
async function reserveSeq(env, n) {
  const r = await env.DB.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + ? WHERE k = 'seq' RETURNING CAST(v AS INTEGER) AS v").bind(n).first();
  return r.v - n + 1;
}
const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
function industryOut(r) {
  return { id: r.id, name: r.name, terms: parse(r.terms, []), categories: parse(r.categories, []), archived: !!r.archived };
}
function searchOut(r) {
  const params = parse(r.params, {});
  return {
    id: r.id, kind: r.kind, name: r.name, industry_id: r.industry_id, status: r.status, limit: r.limit_n,
    total: r.total_tasks, done: r.done_tasks, found: r.found, new: r.new_count, dup: r.dup, excluded: r.excluded,
    to_check: r.to_check, checked: r.checked, limit_reached: !!r.limit_reached, error: r.error, run_url: r.run_url,
    created_at: r.created_at, started_at: r.started_at, finished_at: r.finished_at, heartbeat_at: r.heartbeat_at,
    depth: params.depth ?? 0, emails: !!params.emails, locations: params.locationLabels || [], terms: params.terms || [],
  };
}
const SEARCH_COLS = 'id, kind, name, industry_id, params, status, limit_n, total_tasks, done_tasks, found, new_count, dup, excluded, to_check, checked, limit_reached, error, run_url, created_at, started_at, finished_at, heartbeat_at';
const inList = (n) => Array(n).fill('?').join(',');
function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

/* ------------------------------------------------------------------ bootstrap, industries, views */
async function bootstrap(env) {
  const [ind, srch, seq] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM industries ORDER BY name COLLATE NOCASE'),
    env.DB.prepare(`SELECT ${SEARCH_COLS} FROM searches ORDER BY id DESC LIMIT 60`),
    env.DB.prepare("SELECT CAST(v AS INTEGER) AS v FROM meta WHERE k = 'seq'"),
  ]);
  return json({ industries: ind.results.map(industryOut), searches: srch.results.map(searchOut), seq: seq.results[0]?.v || 0, config: configCheck(env), cols: LEAD_COLS });
}
function cleanList(v, max = 30) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(x => String(x).trim()).filter(Boolean).map(x => x.slice(0, 80)))].slice(0, max);
}
async function saveIndustry(env, b, id) {
  const name = String(b.name || '').trim().slice(0, 60);
  const terms = cleanList(b.terms, 12), categories = cleanList(b.categories, 30);
  if (!name) throw new HttpError(400, 'Give the industry a name.');
  if (!terms.length) throw new HttpError(400, 'Add at least one search term.');
  try {
    if (id) await env.DB.prepare('UPDATE industries SET name = ?, terms = ?, categories = ? WHERE id = ?').bind(name, JSON.stringify(terms), JSON.stringify(categories), id).run();
    else id = (await env.DB.prepare('INSERT INTO industries (name, terms, categories, created_at) VALUES (?, ?, ?, ?) RETURNING id').bind(name, JSON.stringify(terms), JSON.stringify(categories), now()).first()).id;
  } catch (e) {
    if (String(e).includes('UNIQUE')) throw new HttpError(409, `An industry called “${name}” already exists.`);
    throw e;
  }
  return json({ industry: industryOut(await env.DB.prepare('SELECT * FROM industries WHERE id = ?').bind(id).first()) });
}
async function archiveIndustry(env, id, archived) {
  await env.DB.prepare('UPDATE industries SET archived = ? WHERE id = ?').bind(archived, id).run();
  return json({ ok: true });
}
async function addCategory(env, id, b) {
  const row = await env.DB.prepare('SELECT * FROM industries WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Industry not found.');
  const cats = cleanList([...parse(row.categories, []), String(b.category || '')], 40);
  await env.DB.prepare('UPDATE industries SET categories = ? WHERE id = ?').bind(JSON.stringify(cats), id).run();
  return json({ industry: industryOut({ ...row, categories: JSON.stringify(cats) }) });
}
async function saveView(env, b) {
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'Give the view a name.');
  const r = await env.DB.prepare('INSERT INTO views (name, filters, created_at) VALUES (?, ?, ?) RETURNING id').bind(name, JSON.stringify(b.filters || {}), now()).first();
  return json({ view: { id: r.id, name, filters: JSON.stringify(b.filters || {}) } });
}

/* ------------------------------------------------------------------ searches */
async function listSearches(env, url) {
  const limit = Math.min(200, +url.searchParams.get('limit') || 60);
  const r = await env.DB.prepare(`SELECT ${SEARCH_COLS} FROM searches ORDER BY id DESC LIMIT ?`).bind(limit).all();
  return json({ searches: r.results.map(searchOut) });
}
async function getSearch(env, id) {
  const r = await env.DB.prepare(`SELECT ${SEARCH_COLS} FROM searches WHERE id = ?`).bind(id).first();
  if (!r) throw new HttpError(404, 'Search not found.');
  return json({ search: searchOut(r) });
}
async function createSearch(env, b) {
  const ind = await env.DB.prepare('SELECT * FROM industries WHERE id = ?').bind(+b.industry_id).first();
  if (!ind) throw new HttpError(400, 'Pick an industry.');
  const terms = cleanList(b.terms, 12);
  if (!terms.length) throw new HttpError(400, 'Choose at least one search term.');
  const circles = (Array.isArray(b.circles) ? b.circles : [])
    .map(c => ({ lat: +c.lat, lon: +c.lon, r: Math.min(130, Math.max(1, +c.r)), country: countryCode(c.country, 'US') }))
    .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180);
  if (!circles.length) throw new HttpError(400, 'Add at least one location.');
  const cells = buildCells(circles, terms.length);
  if (cells.length > MAX_TASKS) throw new HttpError(400, `This search needs ${cells.length.toLocaleString('en-US')} map searches, more than the ${MAX_TASKS.toLocaleString('en-US')} allowed in one go. Use fewer locations, a smaller area or fewer search terms.`);
  const depth = [0, 1, 2].includes(+b.depth) ? +b.depth : 2;
  const params = {
    terms, depth, emails: !!b.emails, countries: [...new Set(circles.map(c => c.country))],
    locationLabels: cleanList(b.locationLabels, 50),
  };
  const name = String(b.name || '').trim().slice(0, 80) || `${ind.name} search`;
  const limit = Math.max(0, Math.min(100000, Math.floor(+b.limit || 0)));
  const row = await env.DB.prepare(`INSERT INTO searches (kind, name, industry_id, params, cells, status, limit_n, total_tasks, created_at)
    VALUES ('search', ?, ?, ?, ?, 'queued', ?, ?, ?) RETURNING ${SEARCH_COLS}`)
    .bind(name, ind.id, JSON.stringify(params), JSON.stringify(cells), limit, cells.length, now()).first();
  return dispatchAndReturn(env, row);
}
async function createCheck(env, b) {
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger))].slice(0, 20000);
  if (!ids.length) throw new HttpError(400, 'Select at least one lead.');
  const depth = b.form ? 2 : 1;
  const params = { ids, depth, emails: !!b.email, locationLabels: [] };
  const name = `Check ${ids.length.toLocaleString('en-US')} website${ids.length === 1 ? '' : 's'}`;
  const row = await env.DB.prepare(`INSERT INTO searches (kind, name, params, status, to_check, created_at) VALUES ('check', ?, ?, 'queued', ?, ?) RETURNING ${SEARCH_COLS}`)
    .bind(name, JSON.stringify(params), ids.length, now()).first();
  return dispatchAndReturn(env, row);
}
async function dispatchAndReturn(env, row) {
  const err = await dispatch(env, row.id);
  if (err) {
    await env.DB.prepare("UPDATE searches SET status = 'failed', error = ? WHERE id = ?").bind(err, row.id).run();
    row.status = 'failed'; row.error = err;
  }
  return json({ search: searchOut(row) }, err ? 502 : 201);
}
async function dispatch(env, id) {
  if (!configCheck(env).github) return 'GitHub is not connected yet. Add the GH_TOKEN secret, deploy again, then press Retry.';
  const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/runner.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'leadshunter-worker', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
    body: JSON.stringify({ ref: env.GH_REF || 'main', inputs: { job_id: String(id), api: env.ORIGIN || '' } }),
  });
  if (res.status === 204) return null;
  const text = (await res.text()).slice(0, 300);
  console.error('dispatch failed', res.status, text);
  let reason = '';
  try { reason = (JSON.parse(text).message || '').slice(0, 160); } catch { /* not JSON */ }
  if (res.status === 401) return `GitHub rejected GH_TOKEN as invalid or expired (${reason || 'Bad credentials'}). Create a new token, update the GH_TOKEN secret, run Deploy again, then press Retry.`;
  if (res.status === 403) return `GitHub refused to start the job (${reason || 'forbidden'}). Make sure GH_TOKEN has “Actions: Read and write” on ${env.GH_REPO}, then press Retry.`;
  if (res.status === 404) return `GitHub could not find the runner workflow or the repository ${env.GH_REPO} (${reason || 'not found'}). Make sure GH_TOKEN can access this repository, then press Retry.`;
  return `GitHub could not start the job (error ${res.status}). Press Retry in a minute.`;
}
async function cancelSearch(env, id) {
  await env.DB.prepare("UPDATE searches SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued','running')").bind(now(), id).run();
  return getSearch(env, id);
}
async function retrySearch(env, id) {
  const row = await env.DB.prepare(`SELECT ${SEARCH_COLS} FROM searches WHERE id = ?`).bind(id).first();
  if (!row) throw new HttpError(404, 'Search not found.');
  const hb = (await env.DB.prepare('SELECT COALESCE(heartbeat_at, started_at, created_at) AS t FROM searches WHERE id = ?').bind(id).first()).t;
  const stuck = ['running', 'queued'].includes(row.status) && now() - hb > 5 * 60 * 1000;
  if (!['failed', 'cancelled'].includes(row.status) && !stuck) throw new HttpError(409, 'This search is still running. If it looks stuck, wait 5 minutes and press Retry again.');
  await env.DB.prepare("UPDATE searches SET status = 'queued', error = NULL, finished_at = NULL, heartbeat_at = NULL, created_at = ? WHERE id = ?").bind(now(), id).run();
  row.status = 'queued'; row.error = null;
  return dispatchAndReturn(env, row);
}
async function listExcluded(env, id) {
  const r = await env.DB.prepare('SELECT place_id, name, category, address FROM excluded WHERE search_id = ? LIMIT 500').bind(id).all();
  return json({ excluded: r.results });
}
async function reclaimStale(env) {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE searches SET status = 'failed', error = 'The runner stopped responding. Nothing was lost; press Retry to continue where it stopped.', finished_at = ? WHERE status = 'running' AND COALESCE(heartbeat_at, started_at, created_at) < ?").bind(t, t - STALE_MS),
    env.DB.prepare("UPDATE searches SET status = 'failed', error = 'GitHub did not start the job within 15 minutes. Press Retry.', finished_at = ? WHERE status = 'queued' AND created_at < ?").bind(t, t - STALE_MS),
  ]);
}

/* ------------------------------------------------------------------ leads sync */
async function getSnapshot(env) {
  const r = await env.KV.getWithMetadata('snapshot', { type: 'stream' });
  if (!r || !r.value) return new Response(null, { status: 204 });
  const meta = r.metadata || {};
  return new Response(r.value, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-seq': String(meta.seq || 0), 'x-count': String(meta.count || 0), 'x-cols': (meta.cols || LEAD_COLS).join(',') } });
}
async function getChanges(env, url) {
  const since = Math.max(0, +url.searchParams.get('since') || 0);
  const limit = Math.min(5000, Math.max(1, +url.searchParams.get('limit') || 2000));
  const r = await env.DB.prepare(`SELECT ${COLS_SQL} FROM leads WHERE seq > ? ORDER BY seq LIMIT ?`).bind(since, limit).raw();
  const last = r.length ? r[r.length - 1][1] : since;
  return json({ cols: LEAD_COLS, rows: r, seq: last, more: r.length === limit });
}
const LEAD_STATUS = [0, 1, 2, 3];
async function patchLead(env, id, b) {
  const sets = [], vals = [];
  if (b.status !== undefined) { if (!LEAD_STATUS.includes(+b.status)) throw new HttpError(400, 'Unknown status.'); sets.push('status = ?'); vals.push(+b.status); }
  if (b.notes !== undefined) { sets.push('notes = ?'); vals.push(String(b.notes).slice(0, 5000)); }
  if (!sets.length) throw new HttpError(400, 'Nothing to change.');
  const seq = await reserveSeq(env, 1);
  const r = await env.DB.prepare(`UPDATE leads SET ${sets.join(', ')}, seq = ?, updated_at = ? WHERE id = ? RETURNING ${COLS_SQL}`).bind(...vals, seq, now(), id).raw();
  if (!r.length) throw new HttpError(404, 'Lead not found.');
  return json({ cols: LEAD_COLS, row: r[0] });
}
async function bulkLeads(env, b) {
  const ids = [...new Set((b.ids || []).map(Number).filter(Number.isInteger))].slice(0, 20000);
  if (!ids.length || !LEAD_STATUS.includes(+b.status)) throw new HttpError(400, 'Select leads and a status.');
  let seq = await reserveSeq(env, ids.length);
  const t = now();
  const stmts = ids.map(id => env.DB.prepare('UPDATE leads SET status = ?, seq = ?, updated_at = ? WHERE id = ?').bind(+b.status, seq++, t, id));
  for (const part of chunk(stmts, 400)) await env.DB.batch(part);
  return json({ ok: true, updated: ids.length });
}

/* ------------------------------------------------------------------ runner API */
async function runnerRoute(req, env, url) {
  const p = url.pathname, m = req.method;
  let mm;
  if (p === '/api/runner/export' && m === 'GET') {
    const after = Math.max(0, +url.searchParams.get('after') || 0);
    const limit = Math.min(5000, +url.searchParams.get('limit') || 3000);
    const r = await env.DB.prepare(`SELECT ${COLS_SQL} FROM leads WHERE id > ? AND deleted = 0 ORDER BY id LIMIT ?`).bind(after, limit).raw();
    return json({ cols: LEAD_COLS, rows: r });
  }
  if (p === '/api/runner/snapshot' && m === 'PUT') {
    const seq = +req.headers.get('x-seq') || 0, count = +req.headers.get('x-count') || 0;
    if (!req.body) throw new HttpError(400, 'Missing snapshot body.');
    await env.KV.put('snapshot', req.body, { metadata: { seq, count, cols: LEAD_COLS, at: now() } });
    return json({ ok: true });
  }
  if (!(mm = p.match(/^\/api\/runner\/jobs\/(\d+)(\/[a-z-]+)?$/))) throw new HttpError(404, 'Not found.');
  const id = +mm[1], action = mm[2] || '';
  const s = await env.DB.prepare('SELECT * FROM searches WHERE id = ?').bind(id).first();
  if (!s) throw new HttpError(404, 'Job not found.');
  const params = parse(s.params, {});

  if (action === '' && m === 'GET') {
    const ind = s.industry_id ? await env.DB.prepare('SELECT * FROM industries WHERE id = ?').bind(s.industry_id).first() : null;
    return json({ id: s.id, kind: s.kind, status: s.status, params, cells: parse(s.cells, []), done_bits: s.done_bits, limit: s.limit_n, new_count: s.new_count, categories: ind ? parse(ind.categories, []) : [] });
  }
  if (action === '/start' && m === 'POST') {
    const b = await body(req);
    if (['cancelled', 'done'].includes(s.status)) return json({ proceed: false, status: s.status });
    await env.DB.prepare("UPDATE searches SET status = 'running', started_at = COALESCE(started_at, ?), heartbeat_at = ?, run_url = ?, error = NULL WHERE id = ?").bind(now(), now(), String(b.run_url || '').slice(0, 300), id).run();
    return json({ proceed: true });
  }
  if (action === '/cell' && m === 'POST') return ingestCell(env, s, params, await body(req));
  if (action === '/checks' && m === 'POST') return ingestChecks(env, s, await body(req));
  if (action === '/pending-checks' && m === 'GET') {
    let rows;
    if (s.kind === 'check') {
      const ids = params.ids || [];
      rows = [];
      for (const part of chunk(ids, 90)) {
        const r = await env.DB.prepare(`SELECT id, website, site_status, form_status FROM leads WHERE id IN (${inList(part.length)}) AND website IS NOT NULL AND (checked_at IS NULL OR checked_at < ?)`).bind(...part, s.created_at).all();
        rows.push(...r.results);
      }
    } else {
      rows = (await env.DB.prepare('SELECT id, website, site_status, form_status FROM leads WHERE search_id = ? AND checked_at IS NULL AND website IS NOT NULL LIMIT 20000').bind(id).all()).results;
    }
    return json({ leads: rows.map(r => [r.id, r.website]) });
  }
  if (action === '/heartbeat' && m === 'POST') {
    await env.DB.prepare('UPDATE searches SET heartbeat_at = ? WHERE id = ?').bind(now(), id).run();
    return json({ status: s.status });
  }
  if (action === '/finish' && m === 'POST') {
    const b = await body(req);
    const status = s.status === 'cancelled' ? 'cancelled' : b.error ? 'failed' : 'done';
    await env.DB.prepare('UPDATE searches SET status = ?, error = ?, finished_at = ?, heartbeat_at = ? WHERE id = ?').bind(status, b.error ? String(b.error).slice(0, 500) : null, now(), now(), id).run();
    return json({ status });
  }
  throw new HttpError(404, 'Not found.');
}

/* bitset helpers for finished cells */
function bitsFrom(b64, n) {
  const out = new Uint8Array(Math.ceil(n / 8));
  if (b64) { const raw = unb64u(b64); out.set(raw.subarray(0, out.length)); }
  return out;
}

/** Save the places found in one map search. Called once per cell by the runner, in order. */
async function ingestCell(env, s, params, b) {
  const cellIdx = Math.floor(+b.cell);
  const cells = parse(s.cells, []);
  if (!(cellIdx >= 0 && cellIdx < cells.length)) throw new HttpError(400, 'Unknown cell.');
  const bits = bitsFrom(s.done_bits, cells.length);
  const already = bits[cellIdx >> 3] & (1 << (cellIdx & 7));
  const t = now();
  const ind = s.industry_id ? await env.DB.prepare('SELECT categories FROM industries WHERE id = ?').bind(s.industry_id).first() : null;
  const accepted = ind ? parse(ind.categories, []) : [];
  const fallbackCountry = cells[cellIdx][5] || (params.countries || ['US'])[0] || 'US';

  // Normalise and split accepted / excluded, dedupe inside the batch.
  const seenPid = new Set();
  const keep = [], excluded = [];
  for (const p of Array.isArray(b.places) ? b.places : []) {
    const pid = String(p.place_id || '').trim();
    const name = String(p.name || '').trim();
    if (!pid || !name || seenPid.has(pid)) continue;
    seenPid.add(pid);
    const website = cleanWebsite(p.website);
    const domain = domainOf(website);
    const country = countryCode(p.country, fallbackCountry);
    const lead = {
      place_id: pid.slice(0, 200), name: name.slice(0, 200), category: p.category ? String(p.category).slice(0, 100) : null,
      address: p.address ? String(p.address).slice(0, 300) : null, city: p.city || null, region: p.region || null, postal: p.postal || null, country,
      lat: Number.isFinite(+p.lat) ? +p.lat : null, lon: Number.isFinite(+p.lon) ? +p.lon : null,
      phone: p.phone ? String(p.phone).slice(0, 40) : null, phone_e164: phoneE164(p.phone, country),
      website, domain: domain && !isSharedDomain(domain) ? domain : null,
      rating: Number.isFinite(+p.rating) && +p.rating > 0 ? Math.round(+p.rating * 10) / 10 : null,
      reviews: Math.max(0, Math.floor(+p.reviews || 0)), maps_url: p.maps_url ? String(p.maps_url).slice(0, 500) : null, closed: p.closed ? 1 : 0,
    };
    if (categoryAccepted(accepted, p.category, p.categories)) keep.push(lead);
    else excluded.push(lead);
  }

  // Find existing leads by place id, domain or phone.
  const byPid = new Map(), domains = new Set(), phones = new Set();
  const pids = keep.map(l => l.place_id), doms = [...new Set(keep.map(l => l.domain).filter(Boolean))], phs = [...new Set(keep.map(l => l.phone_e164).filter(Boolean))];
  for (const part of chunk(pids, 90)) {
    const r = await env.DB.prepare(`SELECT id, place_id FROM leads WHERE place_id IN (${inList(part.length)})`).bind(...part).all();
    for (const x of r.results) byPid.set(x.place_id, x.id);
  }
  for (const part of chunk(doms, 90)) {
    const r = await env.DB.prepare(`SELECT domain FROM leads WHERE domain IN (${inList(part.length)})`).bind(...part).all();
    for (const x of r.results) domains.add(x.domain);
  }
  for (const part of chunk(phs, 90)) {
    const r = await env.DB.prepare(`SELECT phone_e164 FROM leads WHERE phone_e164 IN (${inList(part.length)})`).bind(...part).all();
    for (const x of r.results) phones.add(x.phone_e164);
  }

  const remaining = s.limit_n ? Math.max(0, s.limit_n - s.new_count) : Infinity;
  const inserts = [], updates = [];
  let dup = 0;
  for (const l of keep) {
    if (byPid.has(l.place_id)) { updates.push(l); dup++; continue; }
    if ((l.domain && domains.has(l.domain)) || (l.phone_e164 && phones.has(l.phone_e164))) { dup++; continue; }
    if (inserts.length >= remaining) continue;
    if (l.domain) domains.add(l.domain);
    if (l.phone_e164) phones.add(l.phone_e164);
    inserts.push(l);
  }

  const stmts = [];
  let seq = (inserts.length + updates.length) ? await reserveSeq(env, inserts.length + updates.length) : 0;
  const depth = params.depth || 0;
  for (const l of inserts) {
    const site = l.website ? 3 : 4;
    stmts.push(env.DB.prepare(`INSERT INTO leads (seq, place_id, name, category, industry_id, address, city, region, postal, country, lat, lon, phone, phone_e164, website, domain, rating, reviews, maps_url, closed, site_status, form_status, search_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(place_id) DO NOTHING RETURNING id, website`)
      .bind(seq++, l.place_id, l.name, l.category, s.industry_id, l.address, l.city, l.region, l.postal, l.country, l.lat, l.lon, l.phone, l.phone_e164, l.website, l.domain, l.rating, l.reviews, l.maps_url, l.closed, site, l.website ? 3 : 2, s.id, t, t));
  }
  for (const l of updates) {
    stmts.push(env.DB.prepare('UPDATE leads SET rating = COALESCE(?, rating), reviews = MAX(reviews, ?), closed = ?, phone = COALESCE(phone, ?), phone_e164 = COALESCE(phone_e164, ?), seq = ?, updated_at = ? WHERE place_id = ?')
      .bind(l.rating, l.reviews, l.closed, l.phone, l.phone_e164, seq++, t, l.place_id));
  }
  for (const l of excluded.slice(0, 200)) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO excluded (search_id, place_id, name, category, address) VALUES (?, ?, ?, ?, ?)').bind(s.id, l.place_id, l.name, l.category, l.address));
  }
  const results = stmts.length ? await env.DB.batch(stmts) : [];
  const newLeads = [];
  for (let i = 0; i < inserts.length; i++) {
    const r = results[i] && results[i].results && results[i].results[0];
    if (r) newLeads.push([r.id, r.website]);
  }

  const extra = Math.max(0, Math.floor(+b.extra || 0));
  bits[cellIdx >> 3] |= (1 << (cellIdx & 7));
  const newTotal = s.new_count + newLeads.length;
  const limitReached = s.limit_n && newTotal >= s.limit_n ? 1 : 0;
  const toCheck = depth > 0 || params.emails ? newLeads.filter(x => x[1]).length : 0;
  await env.DB.prepare(`UPDATE searches SET found = found + ?, new_count = new_count + ?, dup = dup + ?, excluded = excluded + ?,
      done_tasks = done_tasks + ?, total_tasks = total_tasks + ?, to_check = to_check + ?, done_bits = ?, limit_reached = MAX(limit_reached, ?), heartbeat_at = ? WHERE id = ?`)
    .bind(keep.length + excluded.length, newLeads.length, dup, excluded.length, already ? 0 : 1 + extra, extra, toCheck, b64u(bits), limitReached, t, s.id).run();
  const status = (await env.DB.prepare('SELECT status FROM searches WHERE id = ?').bind(s.id).first()).status;
  return json({ new_leads: depth > 0 || params.emails ? newLeads.filter(x => x[1]) : [], new: newLeads.length, dup, excluded: excluded.length, stop: !!limitReached || status === 'cancelled' });
}

const SITE = [0, 1, 2, 3, 4, 5, 6, 7], FORM = [0, 1, 2, 3, 4];
async function ingestChecks(env, s, b) {
  const items = (Array.isArray(b.results) ? b.results : []).filter(r => Number.isInteger(+r.id)).slice(0, 200);
  if (!items.length) return json({ ok: true });
  let seq = await reserveSeq(env, items.length);
  const t = now();
  const stmts = items.map(r => {
    const site = SITE.includes(+r.site) ? +r.site : 3;
    const form = r.form === null || r.form === undefined ? null : (FORM.includes(+r.form) ? +r.form : 3);
    return env.DB.prepare(`UPDATE leads SET site_status = ?, site_ms = ?, form_status = COALESCE(?, form_status), form_url = COALESCE(?, form_url), captcha = ?,
        platform = COALESCE(?, platform), email = COALESCE(?, email), checked_at = ?, seq = ?, updated_at = ? WHERE id = ?`)
      .bind(site, Number.isFinite(+r.ms) ? Math.round(+r.ms) : null, form, r.form_url ? String(r.form_url).slice(0, 500) : null,
        r.captcha ? String(r.captcha).slice(0, 40) : null, r.platform ? String(r.platform).slice(0, 40) : null,
        r.email ? String(r.email).slice(0, 200) : null, t, seq++, t, +r.id);
  });
  stmts.push(env.DB.prepare('UPDATE searches SET checked = checked + ?, heartbeat_at = ? WHERE id = ?').bind(items.length, t, s.id));
  await env.DB.batch(stmts);
  const st = (await env.DB.prepare('SELECT status FROM searches WHERE id = ?').bind(s.id).first()).status;
  return json({ ok: true, stop: st === 'cancelled' });
}

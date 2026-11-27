// LeadsHunter runner. Runs inside GitHub Actions for one job (a search or a website check).
// Env: LH_API (https://…workers.dev), RUNNER_SECRET, JOB_ID, GMAPS_BIN (path to the gosom binary), RUN_URL.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { splitCell } from '../public/shared/grid.js';
import { checkSite, FORM } from './check.mjs';
import { browserFormCheck, closeBrowser } from './browser.mjs';
import { runOutreach } from './outreach.mjs';

const API = (process.env.LH_API || '').replace(/\/$/, '');
const SECRET = process.env.RUNNER_SECRET;
const JOB = process.env.JOB_ID;
const GMAPS = process.env.GMAPS_BIN || './gmaps';
const MAP_CONCURRENCY = +process.env.MAP_CONCURRENCY || 4;
const CHECK_CONCURRENCY = +process.env.CHECK_CONCURRENCY || 24;
const DEPTH = 5;              // fast-mode batches of ~20 results per map search
const SATURATED = 90;         // a cell returning this many results is split into four
const MAX_SPLIT_LEVEL = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (API && !/^https:\/\//.test(API) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(API)) { console.error("LH_API must be an https URL."); process.exit(2); }
if (!API || !SECRET || !JOB) { console.error('LH_API, RUNNER_SECRET and JOB_ID are required.'); process.exit(2); }

async function api(method, path, body, { raw = false, headers = {} } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(API + path, {
        method, headers: { authorization: `Bearer ${SECRET}`, ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body ? (raw ? body : JSON.stringify(body)) : undefined,
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { fatal: true });
      return data;
    } catch (e) {
      last = e;
      if (e.fatal) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw last;
}

/* ------------------------------------------------------------ gosom */
let blockedStreak = 0;
function runGosom(cell, term, dir) {
  const [lat, lon, radiusM, zoom] = cell;
  return new Promise(async (resolve) => {
    const id = Math.random().toString(36).slice(2);
    const qfile = join(dir, id + '.txt'), out = join(dir, id + '.jsonl');
    await writeFile(qfile, term + '\n');
    const args = ['-fast-mode', '-geo', `${lat},${lon}`, '-zoom', String(zoom), '-radius', String(radiusM), '-depth', String(DEPTH),
      '-input', qfile, '-results', out, '-json', '-c', '1', '-exit-on-inactivity', '1m'];
    const child = spawn(GMAPS, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    const killer = setTimeout(() => child.kill('SIGKILL'), 150000);
    child.on('close', async (code) => {
      clearTimeout(killer);
      let places = [];
      try {
        const text = await readFile(out, 'utf8');
        // gosom writes one JSON value per line: a single place, or (in fast mode) a list of places.
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          let v; try { v = JSON.parse(line); } catch { continue; }
          for (const o of (Array.isArray(v) ? v : [v])) if (o && typeof o === 'object') places.push(toPlace(o));
        }
      } catch { /* no output file */ }
      rm(qfile, { force: true }); rm(out, { force: true });
      // Only treat it as a block when nothing came back AND the output clearly shows Google refusing.
      const valid = places.filter(p => p.place_id && p.name);
      const blocked = !valid.length && /(status(?: code)?[: ]+429|HTTP\/\d(?:\.\d)? 429|\b429 Too Many|unusual traffic|google\.com\/sorry|recaptcha)/i.test(stderr);
      if (blocked && !runGosom.loggedBlock) { runGosom.loggedBlock = true; console.log('Block signal from gosom:', stderr.split('\n').filter(l => /429|unusual|sorry|captcha/i.test(l)).slice(-2).join(' | ').slice(0, 300)); }
      resolve({ places: valid, code, blocked, stderr });
    });
  });
}

function pick(o, ...keys) { for (const k of keys) { if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; } return null; }
function toPlace(o) {
  const ca = o.complete_address || o.completeAddress || {};
  const status = String(o.status || '');
  return {
    place_id: pick(o, 'place_id', 'data_id', 'cid'), name: pick(o, 'title', 'name'), category: pick(o, 'category') || (Array.isArray(o.categories) && o.categories[0]) || null,
    categories: Array.isArray(o.categories) ? o.categories : [], address: pick(o, 'address'),
    city: pick(ca, 'city', 'locality'), region: pick(ca, 'state', 'region'), postal: pick(ca, 'postal_code', 'postalCode', 'zip'), country: pick(ca, 'country'),
    lat: pick(o, 'latitude', 'lat'), lon: pick(o, 'longitude', 'longtitude', 'lng'),
    phone: pick(o, 'phone'), website: pick(o, 'web_site', 'website'), rating: pick(o, 'review_rating', 'rating'), reviews: pick(o, 'review_count', 'reviews_count'),
    maps_url: pick(o, 'link'), closed: /permanently closed|closed permanently/i.test(status),
  };
}

/** One map search, splitting dense cells into smaller ones. Returns {places, extra, blocked}. */
async function searchCell(cell, term, dir, level = 0) {
  let r = await runGosom(cell, term, dir);
  for (let attempt = 1; r.blocked && attempt <= 3; attempt++) {
    blockedStreak++;
    log(`Google slowed us down. Waiting ${30 * attempt}s.`);
    await sleep(30000 * attempt);
    r = await runGosom(cell, term, dir);
  }
  if (r.blocked) return { places: [], extra: 0, blocked: true };
  blockedStreak = 0;
  if (r.code !== 0 && !r.places.length) log(`gosom exited with ${r.code}: ${r.stderr.split('\n').slice(-3).join(' | ')}`);
  let places = r.places, extra = 0;
  if (places.length >= SATURATED && level < MAX_SPLIT_LEVEL) {
    const seen = new Set(places.map(p => p.place_id));
    for (const child of splitCell(cell)) {
      extra++;
      const sub = await searchCell(child, term, dir, level + 1);
      extra += sub.extra;
      if (sub.blocked) return { places, extra, blocked: true };
      for (const p of sub.places) if (!seen.has(p.place_id)) { seen.add(p.place_id); places.push(p); }
    }
  }
  return { places, extra, blocked: false };
}

/* ------------------------------------------------------------ checks */
const checkResults = [];
let checkOpts = { form: false, email: false };
let stopChecks = false;
let stopMaps = false;   // set when the form-filter limit is reached during checks
let checksPosted = 0;
const checkQueue = [];
const everQueued = new Set();
const enqueueCheck = (lead) => { if (lead && lead[1] && !everQueued.has(lead[0])) { everQueued.add(lead[0]); checkQueue.push(lead); } };
let checkWorkers = [];

let flushing = Promise.resolve();
function flushChecks(force = false) { flushing = flushing.then(() => flushChecksNow(force)); return flushing; }
async function flushChecksNow(force = false) {
  while (checkResults.length && (force || checkResults.length >= 25)) {
    const batch = checkResults.splice(0, 50);
    const r = await api('POST', `/api/runner/jobs/${JOB}/checks`, { results: batch });
    checksPosted += batch.length;
    if (r.stop) { stopChecks = true; stopMaps = true; }
  }
}
// Real-browser checks are slower, so only a few run at once.
let browserSlots = +process.env.BROWSER_CHECKS || 4;
const browserWaiters = [];
async function withBrowserSlot(fn) {
  while (browserSlots <= 0) await new Promise(r => browserWaiters.push(r));
  browserSlots--;
  try { return await fn(); } finally { browserSlots++; const w = browserWaiters.shift(); if (w) w(); }
}
async function checkOne([id, website]) {
  try {
    const r = await checkSite(website, checkOpts);
    // Forms built by JavaScript need a browser. Forms that look open get a second look too: many sites load their CAPTCHA with JavaScript.
    // The browser sees the page as a person does, so when it finds the form its verdict wins (CAPTCHA or not, in both directions).
    if (checkOpts.form && [FORM.NEEDS_BROWSER, FORM.OPEN, FORM.CAPTCHA].includes(r.form)) {
      try {
        const b = await withBrowserSlot(() => browserFormCheck(r.form_url || website));
        if (b.form === FORM.OPEN || b.form === FORM.CAPTCHA || r.form === FORM.NEEDS_BROWSER) Object.assign(r, b);
      } catch (e) { log('browser check failed', e.message); }
    }
    checkResults.push({ id, ...r });
  } catch (e) {
    log('A website check failed:', e.message);
    checkResults.push({ id, site: 3, form: checkOpts.form ? 3 : null });
  }
  if (checkResults.length >= 25) await flushChecks();
}
function startCheckWorkers() {
  checkWorkers = Array.from({ length: CHECK_CONCURRENCY }, async () => {
    while (!stopChecks) {
      const item = checkQueue.shift();
      if (item === undefined) { if (mapsDone) return; await sleep(300); continue; }
      if (item === null) return;
      await checkOne(item);
    }
  });
}
let mapsDone = false;

/* ------------------------------------------------------------ snapshot */
async function rebuildSnapshot() {
  const rows = [];
  let after = 0, cols = null;
  while (true) {
    const r = await api('GET', `/api/runner/export?after=${after}&limit=3000`);
    cols = r.cols;
    rows.push(...r.rows);
    if (r.rows.length < 3000) break;
    after = r.rows[r.rows.length - 1][0];
  }
  const seqIdx = cols.indexOf('seq');
  const seq = rows.reduce((m, r) => Math.max(m, r[seqIdx] || 0), 0);
  const gz = gzipSync(Buffer.from(JSON.stringify({ cols, rows, seq })));
  await api('PUT', '/api/runner/snapshot', gz, { raw: true, headers: { 'x-seq': String(seq), 'x-count': String(rows.length), 'content-type': 'application/octet-stream' } });
  log(`Snapshot saved: ${rows.length} leads, ${(gz.length / 1024).toFixed(0)} KB.`);
}

/* ------------------------------------------------------------ main */
async function main() {
  const job = await api('GET', `/api/runner/jobs/${JOB}`);
  log(`Job ${job.id} (${job.kind}), status ${job.status}`);
  const start = await api('POST', `/api/runner/jobs/${JOB}/start`, { run_url: process.env.RUN_URL || '' });
  if (!start.proceed) { log(`Nothing to do: job is ${start.status}.`); return; }
  if (job.kind === 'outreach') {
    let cancelled = false, error = null, requeue = [];
    const hb = setInterval(() => api('POST', `/api/runner/jobs/${JOB}/heartbeat`).then(r => { if (r.status === 'cancelled') cancelled = true; }).catch(() => {}), 60000);
    try { ({ requeue } = await runOutreach({ api, JOB, log, isCancelled: () => cancelled })); }
    catch (e) { error = 'The outreach run failed: ' + String(e.message || e).slice(0, 200); }
    clearInterval(hb);
    await api('POST', `/api/runner/jobs/${JOB}/finish`, { error, requeue });
    if (error) { log(error); process.exitCode = 1; }
    return;
  }
  checkOpts = { form: (job.params.depth || 0) >= 2, email: !!job.params.emails };
  const wantChecks = (job.params.depth || 0) >= 1 || job.params.emails;
  let error = null;

  // Tell the app we're alive every minute for the whole job (map searches and website checks).
  let cancelled = false;
  const heartbeat = setInterval(() => api('POST', `/api/runner/jobs/${JOB}/heartbeat`).then(r => { if (r.status === 'cancelled') { cancelled = true; stopChecks = true; stopMaps = true; } }).catch(() => {}), 60000);
  if (wantChecks) startCheckWorkers(); else mapsDone = true;

  if (job.kind === 'search') {
    const cells = job.cells;
    const bits = job.done_bits ? Buffer.from(job.done_bits.replace(/-/g, '+').replace(/_/g, '/'), 'base64') : Buffer.alloc(0);
    const isDone = i => (bits[i >> 3] || 0) & (1 << (i & 7));
    const todo = cells.map((_, i) => i).filter(i => !isDone(i));
    log(`${todo.length} of ${cells.length} map searches left.`);
    const dir = await mkdtemp(join(tmpdir(), 'lh-'));
    let stop = false, next = 0, posted = 0, chain = Promise.resolve();
    await Promise.all(Array.from({ length: MAP_CONCURRENCY }, async () => {
      while (!stop && !stopMaps && next < todo.length) {
        // Don't run far ahead of the website checks (matters when the limit counts leads with a form).
        while (wantChecks && checkQueue.length > 80 && !stop && !stopMaps) await sleep(500);
        if (stop || stopMaps) break;
        const idx = todo[next++];
        const cell = cells[idx];
        const term = job.params.terms[cell[4]];
        const res = await searchCell(cell, term, dir);
        if (res.blocked) { stop = true; error = 'Google is limiting requests right now. Leads found so far are saved. Press Retry in an hour to continue.'; break; }
        // Post results in order, one at a time, so the server's counters stay exact.
        chain = chain.then(async () => {
          if (stop || stopMaps) return;
          const r = await api('POST', `/api/runner/jobs/${JOB}/cell`, { cell: idx, country: cell[5], places: res.places, extra: res.extra });
          posted++;
          for (const lead of r.new_leads || []) enqueueCheck(lead);
          if (posted % 10 === 0) log(`${posted}/${todo.length} map searches, last: ${res.places.length} results, ${r.new} new.`);
          if (r.stop) { stop = true; log('Stopping: limit reached or job cancelled.'); }
        }).catch(e => { stop = true; error = 'Could not save results: ' + e.message; });
        await chain;
      }
    }));
    await chain;
    rm(dir, { recursive: true, force: true });
  }

  // Website checks: leads queued during the search plus anything left unchecked (resumed jobs, check jobs).
  if (wantChecks && !error) {
    const pending = await api('GET', `/api/runner/jobs/${JOB}/pending-checks`);
    for (const l of pending.leads) enqueueCheck(l);
    log(`Checking ${everQueued.size} websites (${checkOpts.form ? 'with' : 'without'} contact forms${checkOpts.email ? ', with emails' : ''}).`);
  }
  mapsDone = true;
  await Promise.all(checkWorkers);
  await flushChecks(true);
  await closeBrowser();
  if (wantChecks) log(`${checksPosted} websites checked.`);

  clearInterval(heartbeat);
  await api('POST', `/api/runner/jobs/${JOB}/finish`, { error });
  try { await rebuildSnapshot(); } catch (e) { log('Snapshot failed (the app still syncs changes):', e.message); }
  if (error) { log(error); process.exitCode = 1; }
}

main().catch(async (e) => {
  console.error(e);
  try { await api('POST', `/api/runner/jobs/${JOB}/finish`, { error: 'The runner crashed: ' + String(e.message || e).slice(0, 200) + '. Press Retry to continue.' }); } catch { /* ignore */ }
  process.exit(1);
});

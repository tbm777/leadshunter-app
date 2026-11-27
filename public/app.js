// LeadsHunter web app (phase 1: leads). Plain ES modules, no build step.
import { buildCells, cityRadiusKm } from './shared/grid.js';
import { parseAddress, prettyPhone } from './shared/normalize.js';
import { installSelects } from './nselect.js';
import { install as installOutreach, loadOutreach, addToCampaign, outreachNav, leadOutreachInto } from './outreach.js';

/* ================================================================ basics */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = n => (+n || 0).toLocaleString('en-US');
const TZ = 'America/Los_Angeles';
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function whenPT(ms) {
  if (!ms) return '';
  const d = new Date(ms), today = dayKey.format(new Date()), yest = dayKey.format(new Date(Date.now() - 864e5)), k = dayKey.format(d);
  return `${k === today ? 'Today' : k === yest ? 'Yesterday' : dateFmt.format(d)}, ${timeFmt.format(d)} PT`;
}
function dayPT(ms) {
  if (!ms) return '—';
  const k = dayKey.format(new Date(ms));
  return k === dayKey.format(new Date()) ? 'Today' : k === dayKey.format(new Date(Date.now() - 864e5)) ? 'Yesterday' : dateFmt.format(new Date(ms));
}
const P = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  pin: '<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4"/>',
  drag: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  phone: '<path d="M5 3.5h3.2l1.6 4.2-2.1 1.4a11 11 0 0 0 5.7 5.7l1.4-2.1 4.2 1.6v3.2A2 2 0 0 1 17 20.5 14.5 14.5 0 0 1 3.5 7 2 2 0 0 1 5 3.5Z"/>',
  find: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  leads: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/>',
  campaigns: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
  manual: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  messages: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  playbook: '<path d="M12 6.5C9.5 4.8 6 4.5 3 5.3v13.2c3-.8 6.5-.5 9 1.2 2.5-1.7 6-2 9-1.2V5.3c-3-.8-6.5-.5-9 1.2z"/><path d="M12 6.5v13.2"/><path d="M16 5.1V10l1.5-1 1.5 1V5.2"/>',
  senders: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16c.6-1.6 1.9-2.4 3.5-2.4s2.9.8 3.5 2.4M15 10h3M15 13h3"/>',
  industries: '<path d="M3 21h18M5 21V10l5-3v14M10 21V8l9-4v17M14 9h2M14 13h2M14 17h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/>', filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', retry: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>', play: '<path d="M7 4v16l13-8z"/>', logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
};
const ic = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
const FLAGS = {
  US: '<rect width="30" height="20" fill="#B22234"/><path d="M0 2.3h30M0 5.4h30M0 8.5h30M0 11.5h30M0 14.6h30M0 17.7h30" stroke="#fff" stroke-width="1.54"/><rect width="13" height="10.8" fill="#3C3B6E"/>',
  CA: '<rect width="30" height="20" fill="#fff"/><rect width="7.5" height="20" fill="#D52B1E"/><rect x="22.5" width="7.5" height="20" fill="#D52B1E"/><path d="M15 3.6l1.1 2.3 1.5-.7-.5 3.4 2-1.8.6 1.3 1.8-.4-.6 2.1 1 .6-3.4 2.6.5 1.4-3-.5v2.6h-.9v-2.6l-3 .5.5-1.4-3.4-2.6 1-.6-.6-2.1 1.8.4.6-1.3 2 1.8-.5-3.4 1.5.7z" fill="#D52B1E"/>',
  AE: '<rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#00732F"/><rect y="13.33" width="30" height="6.67" fill="#000"/><rect width="8" height="20" fill="#FF0000"/>',
  AU: '<rect width="30" height="20" fill="#012169"/><path d="M0 0l15 10M15 0L0 10" stroke="#fff" stroke-width="2"/><path d="M0 0l15 10M15 0L0 10" stroke="#C8102E" stroke-width=".9"/><path d="M7.5 0v10M0 5h15" stroke="#fff" stroke-width="3"/><path d="M7.5 0v10M0 5h15" stroke="#C8102E" stroke-width="1.6"/><g fill="#fff"><circle cx="7.5" cy="15" r="1.6"/><circle cx="22.5" cy="16.5" r=".9"/><circle cx="19.5" cy="9" r=".9"/><circle cx="22.5" cy="4" r=".9"/><circle cx="25.5" cy="8" r=".9"/><circle cx="24" cy="11.5" r=".5"/></g>',
};
const flag = (c, w = 20) => FLAGS[c] ? `<svg class="flag" width="${w}" height="${Math.round(w * 2 / 3)}" viewBox="0 0 30 20" aria-hidden="true">${FLAGS[c]}</svg>` : '';
function toast(msg, icon = 'check') {
  const t = $('#toast'); t.innerHTML = ic(icon, 15) + `<span>${esc(msg)}</span>`; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}
const closeOverlay = () => { $('#overlay').innerHTML = ''; };

/* ================================================================ API */
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new ApiError(401, 'Please sign in.'); }
  if (res.status === 204) return null;
  let data = {};
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status}).`);
  return data;
}

/* ================================================================ state */
const ST = { lists: [], leadLists: new Map(), industries: [], searches: [], config: {}, cols: [], leads: [], byId: new Map(), seq: 0, views: [], places: null, postal: {}, syncing: false, lastSync: 0 };
const SS = ['Loads', 'Slow (over 5 s)', 'Down', 'Not checked yet', 'No website', 'Blocked us', 'Parked or for sale', 'Social or directory page'];
const SS_SHORT = ['Loads', 'Slow', 'Down', 'Not checked', '', 'Blocked us', 'Parked', 'Profile page'];
const SS_C = ['ok', 'warn', 'bad', 'faint', 'faint', 'warn', 'faint', 'faint'];
const FM = ['Open form', 'CAPTCHA', 'No form found', 'Not checked yet', 'Needs browser check'];
const PF = ['WordPress', 'Wix', 'Squarespace', 'Webflow', 'GoDaddy', 'Shopify', 'Duda', 'Weebly', 'HubSpot', 'Custom', 'Not checked'];
const LS = ['New', 'In campaign', 'Contacted', 'Do not contact', 'Replied'];
const LS_C = ['', 'info', 'ok', 'bad', 'manual'];
const LOCS = [];            // "City, Region" strings
const LOC_IDX = new Map();
function locKey(l) { const k = [l.city, l.region].filter(Boolean).join(', ') || l.country || 'Unknown'; let i = LOC_IDX.get(k); if (i === undefined) { i = LOCS.length; LOCS.push(k); LOC_IDX.set(k, i); } return i; }

function rowToLead(row) {
  const o = {};
  ST.cols.forEach((c, i) => { o[c] = row[i]; });
  if (!o.city && o.address) { const a = parseAddress(o.address, o.country); o.city = a.city; o.region = o.region || a.region; o.postal = o.postal || a.postal; }
  if (o.phone) o.phone = prettyPhone(o.phone);
  if (!o.maps_url && o.name) o.maps_url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.name + (o.address ? ', ' + o.address : ''))}`;
  o.k = ((o.name || '') + ' ' + (o.website || '') + ' ' + (o.phone || '').replace(/\D/g, '')).toLowerCase();
  o.li = locKey(o);
  o.pf = o.platform ? Math.max(0, PF.indexOf(o.platform)) : 10;
  if (o.platform && PF.indexOf(o.platform) < 0) o.pf = 9;
  o.dom = o.website ? o.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
  return o;
}
/** A search that keeps only businesses with a form saves each one first and checks its website after. Until that check
 *  passes, the business is a candidate, not a lead: hide it so counts match the search (candidates that fail are deleted). */
function visibleLeads() {
  const filtered = new Set(ST.searches.filter(s => s.form && s.form !== 'any').map(s => s.id));
  const all = [...ST.byId.values()];
  return filtered.size ? all.filter(l => !(filtered.has(l.search_id) && !l.checked_at)) : all;
}
function applyRows(cols, rows) {
  if (cols) ST.cols = cols;
  let changed = 0;
  for (const r of rows) {
    const l = rowToLead(r);
    const prev = ST.byId.get(l.id);
    if (l.deleted) { if (prev) { ST.byId.delete(l.id); changed++; } continue; }
    ST.byId.set(l.id, l);
    changed++;
    if (l.seq > ST.seq) ST.seq = l.seq;
  }
  if (changed) ST.leads = visibleLeads();
  return changed;
}

/* ================================================================ local storage (IndexedDB cache) */
const DB_NAME = 'leadshunter', DB_VER = 1, CACHE_VER = 3;
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function cacheGet(key) {
  try { const db = await idb(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch { return null; }
}
async function cacheSet(key, val) {
  try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = res; tx.onerror = res; }); } catch { /* storage unavailable: app still works, it just downloads again next time */ }
}
let saveTimer = 0;
function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const rows = ST.leads.map(l => ST.cols.map(c => l[c]));
    cacheSet('leads', { v: CACHE_VER, cols: ST.cols, rows, seq: ST.seq });
  }, 800);
}

/* ================================================================ sync */
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('leadshunter') : null;
bc && (bc.onmessage = (e) => { if (e.data === 'changed') sync(); });

async function loadSnapshot() {
  const res = await fetch('/api/snapshot', { credentials: 'same-origin' });
  if (res.status === 401) { showLogin(); return false; }
  if (res.status !== 200 || !res.body || !('DecompressionStream' in window)) return false;
  const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
  const snap = JSON.parse(text);
  ST.byId.clear(); ST.seq = 0;
  applyRows(snap.cols, snap.rows);
  ST.seq = Math.max(ST.seq, snap.seq || 0);
  return true;
}
async function sync({ quiet = true } = {}) {
  if (ST.syncing) return;
  ST.syncing = true;
  setSync('busy');
  try {
    let total = 0, more = true, guard = 0;
    while (more && guard++ < 200) {
      const r = await api('GET', `/api/changes?since=${ST.seq}&limit=5000`);
      total += applyRows(r.cols, r.rows);
      ST.seq = Math.max(ST.seq, r.seq);
      more = r.more;
    }
    ST.lastSync = Date.now();
    if (total) { saveCacheSoon(); onLeadsChanged(); bc && bc.postMessage('changed'); }
    if (!quiet) toast(total ? `${fmt(total)} lead${total === 1 ? '' : 's'} updated` : 'Up to date');
    setSync('ok');
  } catch (e) {
    setSync('error', e.message);
    if (!quiet) toast(e.message, 'alert');
  } finally { ST.syncing = false; }
}
function setSync(state, msg) {
  const b = $('#syncbtn'); if (!b) return;
  b.classList.toggle('busy', state === 'busy');
  b.classList.toggle('err', state === 'error');
  b.querySelector('span').textContent = state === 'busy' ? 'Syncing…' : state === 'error' ? 'Sync failed, retry' : `Synced ${ST.lastSync ? timeFmt.format(new Date(ST.lastSync)) : ''}`;
  b.title = msg || 'Leads are stored in this browser and kept in sync';
}
async function initLeads() {
  const cached = await cacheGet('leads');
  if (cached && cached.v === CACHE_VER && Array.isArray(cached.rows)) {
    ST.byId.clear(); applyRows(cached.cols, cached.rows); ST.seq = cached.seq || ST.seq;
  } else {
    try { await loadSnapshot(); } catch (e) { console.warn('Snapshot unavailable', e); }
  }
  onLeadsChanged();
  await sync();
  saveCacheSoon();
}

/* ================================================================ shell */
const NAV = [
  ['leads', 'Leads', 'leads'], ['find', 'Find leads', 'find'], ['industries', 'Industries', 'industries'],
];
function shell() {
  $('#root').innerHTML = `<div class="app">
    <aside class="rail">
      <div class="brand"><div class="brand-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></div><div><b>LeadsHunter</b><small>Outreach workspace</small></div></div>
      <nav class="nav" id="nav"></nav>
      <div class="usage" style="gap:8px"><h4>This browser</h4><p id="railcount">—</p><button class="railbtn" data-act="logout">${ic('logout', 15)}<span>Sign out</span></button></div>
      <div class="attrib">Place data © <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames</a> (CC BY 4.0)</div>
    </aside>
    <div class="main">
      <header class="top"><div class="crumbs" id="crumbs"></div><span class="clock num" id="clock" style="margin-left:auto"></span><button class="iconbtn" data-act="theme" id="themebtn" aria-label="Switch light or dark theme"></button></header>
      <main class="page" id="page"></main>
    </div></div>`;
  applyTheme(themeGet());
  tickClock();
}
function renderNav(active) {
  $('#nav').innerHTML = `<div class="nav-label">Leads</div>` + NAV.map(([id, label, icon]) => `<a href="#${id}" class="${active === id ? 'on' : ''}">${ic(icon)}${label}${id === 'leads' ? `<span class="count">${ST.leads.length >= 1000 ? (ST.leads.length / 1000).toFixed(ST.leads.length >= 10000 ? 0 : 1) + 'k' : ST.leads.length}</span>` : ''}</a>`).join('')
    + `<div class="nav-label">Outreach</div>` + outreachNav().map(([id, label, icon, n, dot]) => `<a href="${active !== id && NAV_LAST[id] ? NAV_LAST[id] : '#' + id}" class="${active === id ? 'on' : ''}">${ic(icon)}${label}${n ? `<span class="count hot">${n > 999 ? '999+' : n}</span>` : ''}${dot ? `<i class="navdot ${dot}" title="Needs attention"></i>` : ''}</a>`).join('')
    + `<div class="nav-label">Workspace</div><a href="#usage" class="${active === 'usage' ? 'on' : ''}">${ic('chart')}Usage</a>`;
  const rc = $('#railcount'); if (rc) rc.textContent = `${fmt(ST.leads.length)} leads stored here, so filtering is instant and free.`;
}
function tickClock() { const c = $('#clock'); if (c) c.textContent = timeFmt.format(new Date()) + ' PT'; }
setInterval(tickClock, 30000);
const themeGet = () => { try { return localStorage.getItem('lh-theme') || 'system'; } catch { return 'system'; } };
const prefersDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const effectiveTheme = () => document.documentElement.dataset.theme || (prefersDark() ? 'dark' : 'light');
function applyTheme(t) {
  const r = document.documentElement;
  if (t === 'system') delete r.dataset.theme; else r.dataset.theme = t;
  const b = $('#themebtn'); if (!b) return;
  const dark = effectiveTheme() === 'dark';
  // Show what a click will switch to.
  b.innerHTML = dark
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  b.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  b.setAttribute('aria-label', b.title);
}
window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (themeGet() === 'system') applyTheme('system'); });

function showLogin(msg) {
  stopPolling();
  $('#root').innerHTML = `<div class="login"><form id="loginform">
    <div class="brand" style="padding:0"><div class="brand-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg></div></div>
    <div><h1>Sign in to LeadsHunter</h1><p>Use the app password you set in GitHub.</p></div>
    <div class="field"><label class="flabel" for="pw">Password</label><input class="input big" id="pw" type="password" autocomplete="current-password" required></div>
    <div class="help" id="loginerr" style="color:var(--bad)">${esc(msg || '')}</div>
    <button class="btn primary" style="justify-content:center;padding:11px" type="submit">Sign in</button></form></div>`;
  setTimeout(() => $('#pw')?.focus(), 0);
}
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'loginform') return;
  e.preventDefault();
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try { await api('POST', '/api/login', { password: $('#pw').value }); await boot(); }
  catch (err) { $('#loginerr').textContent = err.message; btn.disabled = false; }
});

/* ================================================================ router */
const TITLES = { leads: 'Leads', find: 'Find leads', industries: 'Industries', usage: 'Usage' };
const V = {}, MOUNT = {}, CRUMBS = {}, NAV_ACTIVE = {}, NAV_LAST = {};
const SCROLL = new Map();   // scroll position per page, restored when you come back
function render() {
  const [view, arg] = (location.hash || '#leads').slice(1).split('/');
  const v = V[view] ? view : 'leads';
  CURRENT_VIEW = v; CURRENT_ARG = arg;
  NAV_LAST[NAV_ACTIVE[v] || v] = location.hash || '#' + v;
  renderNav(NAV_ACTIVE[v] || v);
  $('#crumbs').innerHTML = `<span>Workspace</span><span>›</span>` + (CRUMBS[v] ? CRUMBS[v](arg) : `<b>${TITLES[v]}</b>`);
  // A page that fails to draw shows an error card, never the previous page under the new menu highlight.
  try { $('#page').innerHTML = V[v](arg); MOUNT[v] && MOUNT[v](arg); }
  catch (e) { console.error(e); $('#page').innerHTML = `<div class="card"><div class="empty"><b>This page couldn't load</b>Refresh to try again. If it keeps happening, tell us what you clicked.</div></div>`; }
}
let CURRENT_VIEW = null, CURRENT_ARG = null;
let LAST_HASH = location.hash;
window.addEventListener('hashchange', () => {
  // Remember where each page was scrolled, so coming back lands in the same place.
  if (CURRENT_VIEW === 'leads') { const vt = $('#vt'); if (vt) L$.vtScroll = vt.scrollTop; L$.winScroll = window.scrollY; }
  else SCROLL.set(LAST_HASH, window.scrollY);
  LAST_HASH = location.hash;
  closeOverlay(); render();
  if (CURRENT_VIEW !== 'leads') { const y = SCROLL.get(location.hash) || 0; window.scrollTo(0, y); requestAnimationFrame(() => window.scrollTo(0, y)); setTimeout(() => window.scrollTo(0, y), 250); }
});
function onLeadsChanged() {
  if (CURRENT_VIEW) renderNav(NAV_ACTIVE[CURRENT_VIEW] || CURRENT_VIEW);
  if ($('#vt')) { L$.viewCounts = null; leadsUpdate(); }
  rerenderInd();
}

/* ================================================================ leads page */
const defaultF = () => ({ ind: new Set(), loc: new Set(), rMin: 1, rMax: 5, noRating: true, vMin: 0, vMax: Infinity, web: 'any', site: new Set(), form: new Set(), pf: new Set(), ph: 'any', em: 'any', st: new Set(), add: 0, src: new Set(), hideClosed: true, q: '' });
const L$ = { F: defaultF(), view: null, openDD: null, ddq: '', sort: 'reviews', sel: new Set(), res: [], C: null, ms: 0, fopen: false };
const RV_STOPS = [0, 1, 10, 25, 50, 100, 250, 500, 1000, Infinity];
const ROWH = 54;

function facetArrays() {
  return { 0: new Map(), 1: new Int32Array(LOCS.length), 2: new Int32Array(8), 3: new Int32Array(9), 4: new Int32Array(2), 5: new Int32Array(8), 6: new Int32Array(5), 7: new Int32Array(PF.length), 8: new Int32Array(2), 9: new Int32Array(2), 10: new Int32Array(5), 12: new Map() };
}
function runFilter() {
  const t0 = performance.now(), F = L$.F, q = F.q.trim().toLowerCase();
  const C = facetArrays(), res = [], now = Date.now();
  const addMs = F.add ? F.add * 864e5 : 0;
  for (const L of ST.leads) {
    let n = 0, g = -1;
    if (F.ind.size && !F.ind.has(L.industry_id)) { n++; g = 0; }
    if (F.loc.size && !F.loc.has(L.li)) { n++; g = 1; }
    if (L.rating == null ? !F.noRating : (L.rating < F.rMin - 1e-9 || L.rating > F.rMax + 1e-9)) { n++; g = 2; }
    if (L.reviews < F.vMin || L.reviews > F.vMax) { n++; g = 3; }
    if (F.web !== 'any' && ((F.web === 'yes') !== !!L.website)) { n++; g = 4; }
    if (F.site.size && !F.site.has(L.site_status)) { n++; g = 5; }
    if (F.form.size && !F.form.has(L.form_status)) { n++; g = 6; }
    if (F.pf.size && !F.pf.has(L.pf)) { n++; g = 7; }
    if (F.ph !== 'any' && ((F.ph === 'yes') !== !!L.phone)) { n++; g = 8; }
    if (F.em !== 'any' && ((F.em === 'yes') !== !!L.email)) { n++; g = 9; }
    if (F.st.size && !F.st.has(L.status)) { n++; g = 10; }
    if (addMs && now - L.created_at > addMs) { n++; g = 11; }
    if (F.src.size && !inLists(L, F.src)) { n++; g = 12; }
    if (F.hideClosed && L.closed) { n++; g = 13; }
    if (q && !L.k.includes(q)) { n++; g = 14; }
    if (n > 1) continue;
    const all = n === 0;
    if (all) res.push(L);
    if (all || g === 0) C[0].set(L.industry_id, (C[0].get(L.industry_id) || 0) + 1);
    if (all || g === 1) C[1][L.li]++;
    if ((all || g === 2) && L.rating != null) C[2][Math.max(0, Math.min(7, Math.floor((L.rating - 1) / 0.5)))]++;
    if (all || g === 3) { let b = 0; while (L.reviews >= RV_STOPS[b + 1]) b++; C[3][b]++; }
    if (all || g === 4) C[4][L.website ? 1 : 0]++;
    if (all || g === 5) C[5][L.site_status]++;
    if (all || g === 6) C[6][L.form_status]++;
    if (all || g === 7) C[7][L.pf]++;
    if (all || g === 8) C[8][L.phone ? 1 : 0]++;
    if (all || g === 9) C[9][L.email ? 1 : 0]++;
    if (all || g === 10) C[10][L.status]++;
    if (all || g === 12) { C[12].set(L.search_id, (C[12].get(L.search_id) || 0) + 1); const ls = ST.leadLists.get(L.id); if (ls) for (const id of ls) C[12].set('l' + id, (C[12].get('l' + id) || 0) + 1); }
  }
  const s = L$.sort;
  res.sort(s === 'reviews' ? (a, b) => b.reviews - a.reviews : s === 'rating' ? (a, b) => ((b.rating || 0) - (a.rating || 0)) || b.reviews - a.reviews
    : s === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.created_at - a.created_at);
  L$.res = res; L$.C = C; L$.ms = performance.now() - t0;
}

V.leads = () => `
  <div class="head"><div><div class="eyebrow">CRM</div><h1>Leads</h1><p>Every business you've found and checked. Filtering runs in your browser, so it's instant and doesn't touch your Cloudflare limits.</p></div>
    <div class="row"><button class="syncbtn" data-act="sync" id="syncbtn"><i></i><span>Synced</span></button><button class="btn" data-act="export">${ic('download')}Export</button></div></div>
  <div class="views" id="lv-views"></div>
  <div class="lgrid">
    <aside class="card fpanel ${L$.fopen ? 'open' : ''}" id="lf-panel"></aside>
    <div class="card lmain">
      <div class="lsum" id="lf-sum"></div>
      <div class="ltool"><button class="btn sm fbtn" data-act="fopen">${ic('filter', 14)}Filters</button>
        <div class="lsearch">${ic('find', 15)}<input id="lq" placeholder="Search by name, website or phone" value="${esc(L$.F.q)}" autocomplete="off"></div>
        <div class="row" style="gap:6px;color:var(--muted);font-size:12.5px"><span>Sort</span>${fxsHTML('sort')}</div>
        <span class="lperf" id="lperf"></span></div>
      <div id="lf-selbar"></div>
      <div class="vt" id="vt"><div class="vt-in">
        <div class="vrow vhead"><div><span class="cb" data-act="selall" id="cb-all"></span></div><div><button class="sorth" data-sortcol="name">Business<i></i></button></div><div><button class="sorth" data-sortcol="rating">Rating<i></i></button></div><div>Website</div><div>Form</div><div class="c-ph">Phone</div><div class="c-st">Status</div></div>
        <div class="vbody" id="vt-body"></div></div></div>
    </div>
  </div>`;
MOUNT.leads = () => {
  leadsUpdate();
  setSync(ST.syncing ? 'busy' : 'ok');
  const vt = $('#vt');
  vt.addEventListener('scroll', () => { L$.vtScroll = vt.scrollTop; if (!L$.raf) L$.raf = requestAnimationFrame(() => { L$.raf = 0; renderRows(); }); });
  // Restore the previous position (after the table has its full height).
  if (L$.vtScroll) { vt.scrollTop = L$.vtScroll; renderRows(); }
  requestAnimationFrame(() => window.scrollTo(0, L$.winScroll || 0));
};
function leadsUpdate(panel = true) {
  runFilter();
  if (panel) renderPanel();
  renderViews(); renderSum(); renderSel();
  $('#vt-body').style.height = (L$.res.length * ROWH) + 'px';
  renderRows();
}
function changed(panel = true) { L$.view = null; leadsUpdate(panel); }
function renderViews() {
  const el = $('#lv-views'); if (!el) return;
  el.hidden = !ST.views.length; if (el.hidden) return;
  el.innerHTML = `<span class="savedlbl">Saved views</span><button class="vbtn ${L$.view === 'all' ? 'on' : ''}" data-view="all">All leads</button>` +
    ST.views.map(v => `<span class="vwrap"><button class="vbtn ${L$.view === v.id ? 'on' : ''}" data-view="${v.id}">${esc(v.name)}</button><button class="vdel" data-viewdel="${v.id}" aria-label="Delete view ${esc(v.name)}">${ic('x', 12)}</button></span>`).join('');
}
function withFocus(fn) {
  const a = document.activeElement, id = a && a.id, ss = a && a.selectionStart, pt = $('#lf-panel')?.scrollTop;
  fn();
  const p = $('#lf-panel'); if (p && pt != null) p.scrollTop = pt;
  if (id) { const n = document.getElementById(id); if (n && n !== document.activeElement) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, ss); } catch { /* not a text field */ } } }
}
// Lists: your own lists ('l' + id) and searches (their id). A search is a list of the leads it found.
function inLists(L, sel) { if (sel.has(L.search_id)) return true; const ls = ST.leadLists.get(L.id); if (ls) for (const id of ls) if (sel.has('l' + id)) return true; return false; }
function listName(v) { if (typeof v === 'string' && v[0] === 'l') return ST.lists.find(l => 'l' + l.id === v)?.name || 'List'; return searchName(v); }
async function loadLists() {
  try {
    const r = await api('GET', '/api/lists');
    ST.lists = r.lists; ST.leadLists = new Map();
    for (const [lid, ids] of Object.entries(r.members)) for (const id of ids) { let s = ST.leadLists.get(id); if (!s) ST.leadLists.set(id, s = new Set()); s.add(+lid); }
    if ($('#vt')) { leadsUpdate(); }
  } catch (e) { if (e.status !== 401) console.warn('Lists unavailable', e); }
}
function industryName(id) { return ST.industries.find(i => i.id === id)?.name || 'Other'; }
function searchName(id) { const s = ST.searches.find(x => x.id === id); return s ? s.name : (ST.hiddenNames && ST.hiddenNames[id]) || `Search #${id}`; }
function ddOpts(key) {
  const C = L$.C;
  if (key === 'ind') { const ids = new Set([...ST.industries.map(i => i.id), ...C[0].keys()]); return [...ids].map(id => ({ v: id, l: industryName(id), n: C[0].get(id) || 0 })).filter(o => o.n || !ST.industries.find(i => i.id === o.v)?.archived).sort((a, b) => indRank(a.v) - indRank(b.v)); }
  if (key === 'loc') return LOCS.map((l, i) => ({ v: i, l, n: C[1][i] })).filter(o => o.n || L$.F.loc.has(o.v)).sort((a, b) => b.n - a.n);
  if (key === 'site') return SS.map((l, i) => ({ v: i, l, n: C[5][i] }));
  if (key === 'form') return FM.map((l, i) => ({ v: i, l, n: C[6][i] }));
  if (key === 'pf') return PF.map((l, i) => ({ v: i, l, n: C[7][i] }));
  if (key === 'st') return LS.map((l, i) => ({ v: i, l, n: C[10][i] }));
  if (key === 'src') {
    const mine = ST.lists.map(l => ({ v: 'l' + l.id, l: l.name, n: C[12].get('l' + l.id) || 0, sub: 'Your list' }));
    const searches = [...C[12].keys()].filter(k => typeof k === 'number').map(id => ({ v: id, l: searchName(id), n: C[12].get(id) || 0, sub: `Search · ${dayPT(ST.searches.find(s => s.id === id)?.created_at)}` })).sort((a, b) => b.v - a.v);
    return [...mine, ...searches];
  }
  return [];
}
function dd(key, label, allText) {
  const sel = L$.F[key], opts = ddOpts(key), open = L$.openDD === key;
  const chosen = opts.filter(o => sel.has(o.v));
  const txt = !chosen.length ? allText : chosen.length === 1 ? chosen[0].l : chosen[0].l + ` + ${chosen.length - 1} more`;
  const q = L$.ddq.toLowerCase(), list = opts.filter(o => !q || o.l.toLowerCase().includes(q)).slice(0, 300);
  return `<div class="field dd"><span class="flabel">${label}</span><button class="dd-btn ${chosen.length ? 'set' : ''}" data-dd="${key}" aria-expanded="${open}"><span>${esc(txt)}</span>${chosen.length ? `<b class="dd-n">${chosen.length}</b>` : ''}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
    ${open ? `<div class="dd-pop">${opts.length > 6 ? `<input class="input" id="ddq-${key}" placeholder="Search ${label.toLowerCase()}" value="${esc(L$.ddq)}" autocomplete="off">` : ''}
      <div class="dd-list">${list.map(o => `<div class="dd-opt ${o.n ? '' : 'zero'}" data-ddopt="${key}:${o.v}" role="checkbox" aria-checked="${sel.has(o.v)}" tabindex="0"><span class="cb ${sel.has(o.v) ? 'on' : ''}"></span><span class="dd-l">${esc(o.l)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span><span class="cnt">${fmt(o.n)}</span><button class="only" data-ddonly="${key}:${o.v}">Only</button></div>`).join('') || '<div class="empty" style="padding:14px">Nothing here yet</div>'}</div>
      <div class="dd-foot">${key === 'src' ? `<button class="btn ghost sm" data-act="managelists" style="margin-right:auto">${ic('edit', 13)}Manage lists</button>` : ''}<button class="btn ghost sm" data-ddclear="${key}">Clear</button><button class="btn sm" data-dd="${key}">Done</button></div></div>` : ''}</div>`;
}
function segF(key, label, opts, counts) {
  return `<div class="field"><span class="flabel">${label}</span><div class="seg-c fseg" role="radiogroup" aria-label="${label}">${opts.map(([v, l, ci]) => `<button type="button" role="radio" aria-checked="${String(L$.F[key]) === String(v)}" class="${String(L$.F[key]) === String(v) ? 'on' : ''}" data-fseg="${key}:${v}">${l}${counts && ci != null ? `<span class="fseg-n">${fmt(counts[ci])}</span>` : ''}</button>`).join('')}</div></div>`;
}
function selF(key, label, opts, counts) {
  return `<div class="field"><label class="flabel" for="fs-${key}">${label}</label><select class="input" id="fs-${key}" data-fsel="${key}">${opts.map(([v, l, ci]) => `<option value="${v}" ${String(L$.F[key]) === String(v) ? 'selected' : ''}>${l}${counts && ci != null ? ` (${fmt(counts[ci])})` : ''}</option>`).join('')}</select></div>`;
}
const rvIdxMin = v => { let k = 0; while (k < 8 && RV_STOPS[k + 1] <= v) k++; return k; };
const rvIdxMax = v => { if (v === Infinity) return 9; let k = 1; while (k < 9 && RV_STOPS[k] - 1 < v) k++; return k; };
function rngRating() {
  const F = L$.F, h = L$.C[2], mx = Math.max(...h, 1), p = v => ((v - 1) / 4 * 100);
  return `<div class="rng"><div class="rng-top"><span>Rating</span><span class="num">${F.rMin.toFixed(1)} – ${F.rMax.toFixed(1)} ★</span></div>
    <div class="hist">${[...h].map((n, b) => { const lo = 1 + b * 0.5; return `<i class="${lo + 0.5 > F.rMin && lo < F.rMax ? 'in' : ''}" style="height:${Math.max(4, n / mx * 100)}%" title="${lo.toFixed(1)}–${(lo + 0.5).toFixed(1)}: ${fmt(n)}"></i>`; }).join('')}</div>
    <div class="dual"><div class="track"></div><div class="fill" id="fill-rt" style="left:${p(F.rMin)}%;right:${100 - p(F.rMax)}%"></div><input type="range" aria-label="Minimum rating" min="1" max="5" step="0.1" value="${F.rMin}" data-rng="rMin"><input type="range" aria-label="Maximum rating" min="1" max="5" step="0.1" value="${F.rMax}" data-rng="rMax"></div>
    <div class="rng-in"><input class="input num" type="number" id="n-rMin" min="1" max="5" step="0.1" value="${F.rMin.toFixed(1)}" data-num="rMin" aria-label="Minimum rating"><span>to</span><input class="input num" type="number" id="n-rMax" min="1" max="5" step="0.1" value="${F.rMax.toFixed(1)}" data-num="rMax" aria-label="Maximum rating"></div>
    <label class="ck"><input type="checkbox" data-fchk="noRating" ${F.noRating ? 'checked' : ''}>Include businesses with no reviews yet</label></div>`;
}
function rngReviews() {
  const F = L$.F, h = L$.C[3], mx = Math.max(...h, 1), a = rvIdxMin(F.vMin), b = rvIdxMax(F.vMax);
  const lbl = F.vMax === Infinity ? (F.vMin ? fmt(F.vMin) + '+' : 'Any') : fmt(F.vMin) + ' – ' + fmt(F.vMax);
  return `<div class="rng"><div class="rng-top"><span>Reviews</span><span class="num">${lbl}</span></div>
    <div class="hist">${[...h].map((n, k) => `<i class="${k >= a && k < b ? 'in' : ''}" style="height:${Math.max(4, n / mx * 100)}%" title="${RV_STOPS[k]}${k === 8 ? '+' : '–' + (RV_STOPS[k + 1] - 1)}: ${fmt(n)}"></i>`).join('')}</div>
    <div class="dual"><div class="track"></div><div class="fill" id="fill-rv" style="left:${a / 9 * 100}%;right:${100 - b / 9 * 100}%"></div><input type="range" aria-label="Minimum reviews" min="0" max="9" step="1" value="${a}" data-rng="vMin"><input type="range" aria-label="Maximum reviews" min="0" max="9" step="1" value="${b}" data-rng="vMax"></div>
    <div class="hist-l"><span>0</span><span>10</span><span>50</span><span>250</span><span>1k+</span></div>
    <div class="rng-in"><input class="input num" type="number" id="n-vMin" min="0" value="${F.vMin}" data-num="vMin" aria-label="Minimum reviews"><span>to</span><input class="input num" type="number" id="n-vMax" min="0" placeholder="No max" value="${F.vMax === Infinity ? '' : F.vMax}" data-num="vMax" aria-label="Maximum reviews"></div></div>`;
}
function activeCount() { const F = L$.F, d = defaultF(); let n = 0; for (const k of Object.keys(d)) { if (k === 'q') continue; const a = F[k], b = d[k]; if (a instanceof Set ? a.size : a !== b) n++; } return n; }
function renderPanel() {
  const el = $('#lf-panel'); if (!el) return; const C = L$.C;
  withFocus(() => {
    el.innerHTML = `<div class="fp-h"><b>Filters${activeCount() ? ` <span class="dd-n">${activeCount()}</span>` : ''}</b><button class="btn ghost sm" data-act="reset" ${activeCount() ? '' : 'disabled'}>Reset all</button></div>
    <div class="fp-sec"><h5>Lists</h5>${dd('src', 'List or search', 'All leads')}</div>
    <div class="fp-sec"><h5>Business</h5>${dd('ind', 'Industry', 'All industries')}${dd('loc', 'Location', 'All locations')}${rngRating()}${rngReviews()}
      ${segF('ph', 'Phone number', [['any', 'Any'], ['yes', 'Has', 1], ['no', 'None', 0]], C[8])}
      <label class="ck"><input type="checkbox" data-fchk="hideClosed" ${L$.F.hideClosed ? 'checked' : ''}>Hide permanently closed businesses</label></div>
    <div class="fp-sec"><h5>Website</h5>${segF('web', 'Website', [['any', 'Any'], ['yes', 'Has', 1], ['no', 'None', 0]], C[4])}${dd('site', 'Site status', 'Any status')}${dd('pf', 'Platform', 'Any platform')}</div>
    <div class="fp-sec"><h5>Contact</h5>${dd('form', 'Contact form', 'Any')}${segF('em', 'Email address', [['any', 'Any'], ['yes', 'Found', 1], ['no', 'None', 0]], C[9])}</div>
    <div class="fp-sec" style="border-bottom:0"><h5>Pipeline</h5>${dd('st', 'Lead status', 'Any status')}${segF('add', 'Date added', [[0, 'Any'], [1, '24 h'], [7, '7 days'], [30, '30 days']])}</div>`;
  });
}
function summaryParts() {
  const F = L$.F, p = [];
  const names = (set, fn) => { const a = [...set].map(fn); return a.length > 2 ? a.slice(0, 2).join(', ') + ` + ${a.length - 2} more` : a.join(' or '); };
  if (F.ind.size) p.push(names(F.ind, industryName));
  if (F.loc.size) p.push('in ' + names(F.loc, i => LOCS[i]));
  if (F.rMin > 1 || F.rMax < 5) p.push(`rated ${F.rMin.toFixed(1)}–${F.rMax.toFixed(1)}` + (F.noRating ? ' or unrated' : '')); else if (!F.noRating) p.push('has a rating');
  if (F.vMin > 0 || F.vMax < Infinity) p.push(F.vMax === Infinity ? `${fmt(F.vMin)}+ reviews` : `${fmt(F.vMin)}–${fmt(F.vMax)} reviews`);
  if (F.web !== 'any') p.push(F.web === 'yes' ? 'has a website' : 'no website');
  if (F.site.size) p.push('site ' + names(F.site, i => SS[i].toLowerCase()));
  if (F.pf.size) p.push('on ' + names(F.pf, i => PF[i]));
  if (F.form.size) p.push(names(F.form, i => FM[i].toLowerCase()));
  if (F.em !== 'any') p.push(F.em === 'yes' ? 'email found' : 'no email');
  if (F.ph !== 'any') p.push(F.ph === 'yes' ? 'has phone' : 'no phone');
  if (F.st.size) p.push('status ' + names(F.st, i => LS[i].toLowerCase()));
  if (F.src.size) p.push(F.src.size === 1 ? `in “${listName([...F.src][0])}”` : `in ${F.src.size} lists`);
  if (F.add) p.push(F.add === 1 ? 'added in the last 24 hours' : `added in the last ${F.add} days`);
  if (!F.hideClosed) p.push('including closed');
  if (F.q.trim()) p.push(`matching “${F.q.trim()}”`);
  return p;
}
function renderSum() {
  const p = summaryParts();
  $('#lf-sum').innerHTML = `<span><b class="big num">${fmt(L$.res.length)}</b> of ${fmt(ST.leads.length)} leads</span><span class="lsum-t">${esc(p.length ? p.join(' · ') : 'No filters applied')}</span>${p.length ? `<span class="row" style="margin-left:auto;gap:4px"><button class="btn ghost sm" data-act="saveview">${ic('plus', 13)}Save as view</button><button class="btn ghost sm" data-act="reset">Clear all</button></span>` : ''}`;
  $('#lperf').textContent = ST.leads.length ? `Filtered ${fmt(ST.leads.length)} leads in ${Math.max(1, Math.round(L$.ms))} ms` : '';
  const fb = document.querySelector('.fbtn'); if (fb) fb.innerHTML = ic('filter', 14) + 'Filters' + (activeCount() ? ` (${activeCount()})` : '');
}
function renderSel() {
  for (const id of [...L$.sel]) if (!ST.byId.has(id)) L$.sel.delete(id);
  const n = L$.sel.size, m = L$.res.length, allIn = m && n >= m && L$.res.every(l => L$.sel.has(l.id));
  const cb = $('#cb-all'); if (cb) cb.className = 'cb ' + (allIn ? 'on' : n ? 'part' : '');
  const inMyList = L$.F.src.size === 1 && String([...L$.F.src][0])[0] === 'l';
  $('#lf-selbar').innerHTML = n ? `<div class="selbar"><b class="num">${fmt(n)} selected</b>${!allIn && m > n ? `<button class="linkbtn" data-act="selall">Select all ${fmt(m)}</button>` : ''}<button class="linkbtn muted" data-act="clearsel">Clear</button>
    <div class="selacts"><button class="btn sm" data-act="addcamp">${ic('campaigns', 14)}Add to campaign</button><button class="btn sm" data-act="addlist">${ic('leads', 14)}Add to list</button>${inMyList ? `<button class="btn sm ghost" data-act="rmlist">${ic('x', 14)}Remove from list</button>` : ''}
      <div class="kebab selmore"><button class="iconbtn sm" data-act="selmore" aria-label="More actions" aria-haspopup="menu" title="More">⋯</button>${L$.selMore ? `<div class="menu" role="menu"><button role="menuitem" data-act="export">${ic('download', 14)}Export</button><button role="menuitem" data-act="checkmodal">${ic('globe', 14)}Check websites</button><button role="menuitem" class="danger" data-act="bdnc">${ic('shield', 14)}Do not contact</button><button role="menuitem" class="danger" data-act="bdelask">${ic('trash', 14)}Delete leads</button></div>` : ''}</div></div></div>` : '';
}
function renderRows() {
  const vt = $('#vt'), body = $('#vt-body'); if (!vt || !body) return;
  if (!ST.leads.length) {
    body.style.height = '280px';
    body.innerHTML = `<div class="empty" style="position:absolute;inset:0;display:grid;place-content:center;gap:8px"><b>No leads yet</b><span>Run your first search and businesses show up here as they're found.</span><a class="btn" href="#find" style="justify-self:center">${ic('find')}Find leads</a></div>`;
    return;
  }
  const top = Math.max(0, vt.scrollTop - 38);
  const a = Math.max(0, Math.floor(top / ROWH) - 8), b = Math.min(L$.res.length, Math.ceil((top + vt.clientHeight) / ROWH) + 8);
  let h = '';
  for (let r = a; r < b; r++) {
    const L = L$.res[r], on = L$.sel.has(L.id);
    h += `<div class="vrow ${on ? 'sel' : ''}" style="top:${r * ROWH}px" data-lead="${L.id}"><div><span class="cb ${on ? 'on' : ''}" data-lsel="${L.id}"></span></div>
      <div class="cell2"><div class="biz">${esc(L.name)}${L.closed ? ' <span class="tagc">Closed</span>' : ''}</div><div class="sub">${esc(LOCS[L.li])} <span class="dotsep">·</span> ${esc(industryName(L.industry_id))}</div></div>
      <div class="cell2 num">${L.rating == null ? '<span class="none">No reviews</span>' : `<div><span class="stars">★</span> <b>${L.rating.toFixed(1)}</b></div><div class="sub">${fmt(L.reviews)}<span class="rvw"> review${L.reviews === 1 ? '' : 's'}</span></div>`}</div>
      <div class="cell2">${L.website ? `<div class="dom">${esc(L.dom)}</div><div class="sub st-${SS_C[L.site_status]}"><i class="sdot"></i>${SS_SHORT[L.site_status]}</div>` : '<span class="none">No website</span>'}</div>
      <div>${L.form_status === 0 ? '<span class="pill c-ok">Open form</span>' : L.form_status === 1 ? `<span class="pill c-manual">${esc(L.captcha || 'CAPTCHA')}</span>` : L.form_status === 4 ? '<span class="pill c-idle">Needs browser</span>' : L.form_status === 3 ? '<span class="none">Not checked</span>' : '<span class="none">None</span>'}</div>
      <div class="num c-ph">${L.phone ? esc(L.phone) : '<span class="none">—</span>'}</div>
      <div class="c-st">${L.status === 0 ? '<span class="none">New</span>' : `<span class="stxt st-${LS_C[L.status]}"><i class="sdot"></i>${LS[L.status]}</span>`}</div></div>`;
  }
  body.innerHTML = h || `<div class="empty" style="position:absolute;inset:0"><b>No leads match these filters</b>Widen the rating or review range, or clear a filter on the left.</div>`;
  if (!L$.res.length) body.style.height = '240px';
  document.querySelectorAll('[data-sortcol]').forEach(el => el.classList.toggle('on', L$.sort === el.dataset.sortcol));
}

/* ---------- lead drawer */
function checksHTML(L, running) {
  const row = (c, k, t) => `<div class="check">${running ? '<span class="spin"></span>' : `<span style="color:var(--${c})">${ic(c === 'ok' ? 'check' : c === 'bad' ? 'x' : c === 'manual' ? 'manual' : 'alert', 15)}</span>`}${k}<span class="st sub" style="color:var(--muted)">${running ? 'Checking…' : esc(t)}</span></div>`;
  const ss = L.site_status;
  const siteTxt = ss === 0 || ss === 1 ? `Loaded in ${((L.site_ms || 0) / 1000).toFixed(1)} s` : SS[ss];
  return row(['ok', 'warn', 'bad', 'idle', 'idle', 'warn', 'idle', 'idle'][ss], 'Website', siteTxt)
    + row(['ok', 'manual', 'idle', 'idle', 'warn'][L.form_status], 'Contact form', L.form_status === 1 ? `${L.captcha || 'CAPTCHA'}${L.form_url ? ' · ' + pathOf(L.form_url) : ''}` : L.form_status === 0 && L.form_url ? `Found on ${pathOf(L.form_url)}` : FM[L.form_status])
    + row(L.platform ? 'ok' : 'idle', 'Platform', L.platform || 'Not checked yet')
    + row(L.email ? 'ok' : 'idle', 'Email', L.email || (L.checked_at ? 'None found' : 'Not checked yet'));
}
const pathOf = u => { try { const x = new URL(u); return x.pathname === '/' ? 'Home page' : decodeURIComponent(x.pathname).replace(/\/$/, ''); } catch { return u; } };
const hostOf = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
let DRAWER_ID = null;
function leadDrawer(id) {
  const L = ST.byId.get(id); if (!L) return;
  DRAWER_ID = id;
  const idx = L$.res.findIndex(x => x.id === id), total = L$.res.length;
  const fs = L.form_status, ss = L.site_status;
  const formPill = fs === 0 ? '<span class="pill c-ok">Open form</span>' : fs === 1 ? `<span class="pill c-manual">${esc(L.captcha || 'CAPTCHA')}</span>` : fs === 4 ? '<span class="pill c-warn">Needs browser check</span>' : fs === 3 ? '<span class="pill c-idle">Not checked</span>' : '<span class="pill c-idle">No form found</span>';
  const siteTxt = !L.website ? 'No website' : ss === 0 || ss === 1 ? `${SS_SHORT[ss]} · ${((L.site_ms || 0) / 1000).toFixed(1)} s` : SS[ss];
  const formHelp = fs === 0 ? 'No CAPTCHA detected.' : fs === 1 ? 'The form uses a CAPTCHA, so it needs a person to send it.' : fs === 4 ? 'The form is built with JavaScript and couldn’t be confirmed.' : fs === 3 ? (L.website ? 'Run a check to look for a contact form.' : 'This business has no website.') : 'No contact form was found on the home page or contact pages.';
  const row = (k, v) => `<div class="dk"><dt>${k}</dt><dd>${v}</dd></div>`;
  const copyBtn = (v, label = 'Copy') => `<button class="dcopy" data-copy="${esc(v)}" title="Copy">${ic('copy', 13)}<span>${label}</span></button>`;
  $('#overlay').innerHTML = `<div class="scrim" data-act="close"><div class="drawer ld" data-stop role="dialog" aria-label="${esc(L.name)}">
    <div class="ld-top">
      <div class="ld-nav"><button class="iconbtn sm" data-lnav="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="Previous lead" title="Previous (↑)">${ic('back', 14)}</button><span class="num">${idx >= 0 ? `${fmt(idx + 1)} of ${fmt(total)}` : ''}</span><button class="iconbtn sm" data-lnav="1" ${idx < 0 || idx >= total - 1 ? 'disabled' : ''} aria-label="Next lead" title="Next (↓)">${ic('arrow', 14)}</button></div>
      <button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="ld-head">
      <h2>${esc(L.name)}</h2>
      <div class="ld-sub">${esc(LOCS[L.li])} · ${esc(industryName(L.industry_id))}${L.rating != null ? ` · <span class="stars">★</span> ${L.rating.toFixed(1)} <span class="ld-muted">(${fmt(L.reviews)})</span>` : ''}${L.closed ? ' · <span class="pill c-bad">Permanently closed</span>' : ''}</div>
      <div class="ld-actions">
        ${L.form_url && (fs === 0 || fs === 1 || fs === 4) ? `<a class="btn sm primary" href="${esc(L.form_url)}" target="_blank" rel="noopener noreferrer">${ic('ext', 13)}Open form</a>` : ''}
        ${L.website ? `<a class="btn sm" href="${esc(L.website)}" target="_blank" rel="noopener noreferrer">${ic('globe', 13)}Website</a>` : ''}
        ${L.maps_url ? `<a class="btn sm" href="${esc(L.maps_url)}" target="_blank" rel="noopener noreferrer">${ic('find', 13)}Google Maps</a>` : ''}
        ${L.phone ? `<button class="btn sm" data-copy="${esc(L.phone)}">${ic('copy', 13)}${esc(L.phone)}</button>` : ''}
      </div>
    </div>
    <section class="ld-sec ld-form">
      <div class="ld-sech"><h5>Contact form</h5>${formPill}</div>
      ${L.form_url && (fs === 0 || fs === 1 || fs === 4) ? `<div class="ld-url"><a href="${esc(L.form_url)}" target="_blank" rel="noopener noreferrer" title="${esc(L.form_url)}">${ic('ext', 13)}<span>${esc(hostOf(L.form_url))}<b>${esc(pathOf(L.form_url) === 'Home page' ? '' : pathOf(L.form_url))}</b></span></a>${copyBtn(L.form_url)}</div>` : ''}
      <p class="ld-help">${formHelp}${L.form_url && pathOf(L.form_url) === 'Home page' && fs !== 3 ? ' Found on the home page.' : ''}</p>
      <dl class="ld-dl">${row('Website', L.website ? `<span class="st-${SS_C[ss]}"><i class="sdot"></i>${esc(siteTxt)}</span>` : '<span class="ld-muted">No website</span>')}${row('Platform', esc(L.platform || '—'))}${row('Email', L.email ? `${esc(L.email)} ${copyBtn(L.email, '')}` : `<span class="ld-muted">${L.checked_at ? 'None found' : 'Not checked'}</span>`)}</dl>
      <div class="ld-foot"><span class="ld-muted">${L.checked_at ? `Checked ${whenPT(L.checked_at)}` : 'Not checked yet'}</span><button class="btn sm ghost" data-act="checkone" data-id="${L.id}" ${L.website ? '' : 'disabled'}>${ic('retry', 13)}Check again</button></div>
    </section>
    <section class="ld-sec"><h5>Business</h5><dl class="ld-dl">
      ${row('Phone', L.phone ? `${esc(L.phone)} ${copyBtn(L.phone, '')}` : '<span class="ld-muted">Not listed</span>')}
      ${row('Website', L.website ? `<a href="${esc(L.website)}" target="_blank" rel="noopener noreferrer">${esc(L.dom)}</a>` : '<span class="ld-muted">Not listed</span>')}
      ${row('Address', L.address ? `${esc(L.address)} ${copyBtn(L.address, '')}` : '—')}
      ${row('Category', esc(L.category || '—'))}
      ${row('Found by', `${esc(searchName(L.search_id))} · ${dayPT(L.created_at)}`)}</dl></section>
    <section class="ld-sec"><h5>Status</h5>
      <div class="seg-c ld-status" role="radiogroup" aria-label="Lead status">${[0, 2, 4, 3].map(i => `<button type="button" role="radio" aria-checked="${L.status === i}" class="${L.status === i ? 'on' : ''}" data-lstat="${L.id}:${i}">${LS[i]}</button>`).join('')}</div>
      <div id="ld-out" data-lid="${L.id}">${L.status === 1 ? '<span class="help">In a campaign…</span>' : ''}</div></section>
    <section class="ld-sec" style="border-bottom:0"><h5>Notes</h5><textarea class="input" id="dnote" data-lnote="${L.id}" style="min-height:84px" placeholder="Add a note about this business">${esc(L.notes || '')}</textarea><span class="help" id="dnote-h">Saved automatically.</span></section>
  </div></div>`;
  leadOutreachInto($('#ld-out'), L);
}
function navDrawer(step) {
  const idx = L$.res.findIndex(x => x.id === DRAWER_ID); const next = L$.res[idx + step];
  if (!next) return;
  const keepScroll = document.querySelector('.ld')?.scrollTop || 0;
  leadDrawer(next.id);
  const d = document.querySelector('.ld'); if (d) d.scrollTop = Math.min(keepScroll, 0);
  // keep the table in step with the panel
  const vt = $('#vt'); const ri = idx + step; if (vt) { const top = ri * ROWH; if (top < vt.scrollTop || top > vt.scrollTop + vt.clientHeight - ROWH) vt.scrollTop = Math.max(0, top - vt.clientHeight / 2); }
}

/* ---------- export */
const XCOLS = [
  ['name', 'Name', 'Business', L => L.name], ['phone', 'Phone', 'Business', L => phoneOut(L)], ['website', 'Website', 'Business', L => L.website || ''],
  ['industry', 'Industry', 'Business', L => industryName(L.industry_id)], ['category', 'Google category', 'Business', L => L.category || ''], ['address', 'Address', 'Business', L => L.address || ''],
  ['city', 'City', 'Business', L => L.city || ''], ['region', 'State / province', 'Business', L => L.region || ''], ['postal', 'Postal code', 'Business', L => L.postal || ''], ['country', 'Country', 'Business', L => L.country || ''],
  ['rating', 'Rating', 'Business', L => L.rating ?? ''], ['reviews', 'Reviews', 'Business', L => L.reviews], ['maps', 'Maps link', 'Business', L => L.maps_url || ''],
  ['site', 'Site status', 'Website check', L => L.website ? SS[L.site_status] : 'No website'], ['platform', 'Platform', 'Website check', L => L.platform || ''],
  ['form', 'Contact form', 'Contact', L => FM[L.form_status]], ['formurl', 'Form page', 'Contact', L => L.form_url || ''], ['captcha', 'CAPTCHA type', 'Contact', L => L.form_status === 1 ? (L.captcha || '') : ''], ['email', 'Email', 'Contact', L => L.email || ''],
  ['status', 'Lead status', 'Pipeline', L => LS[L.status]], ['search', 'Found by search', 'Pipeline', L => searchName(L.search_id)], ['added', 'Date added', 'Pipeline', L => dayKey.format(new Date(L.created_at))], ['notes', 'Notes', 'Pipeline', L => L.notes || ''],
];
const XPRESETS = { basic: ['name', 'phone', 'website'], standard: ['name', 'phone', 'website', 'email', 'city', 'region', 'rating', 'reviews', 'form', 'formurl', 'status'], full: XCOLS.map(c => c[0]) };
const XPRESET_INFO = { basic: ['Basic', 'Name, phone, website'], standard: ['Standard', 'Adds email, location, reviews and form'], full: ['Everything', 'All columns'] };
// One screen: which leads, which columns, which format. Filtering happens on the Leads page itself.
const XP = (() => { const d = { scope: 'view', src: null, preset: 'standard', cols: new Set(XPRESETS.standard), skipDnc: true, fmt: 'csv' };
  try { const s = JSON.parse(localStorage.getItem('lh-export2') || 'null'); if (s) return { ...d, skipDnc: s.skipDnc !== false, fmt: ['csv', 'xlsx', 'copy'].includes(s.fmt) ? s.fmt : 'csv' }; } catch { /* default */ }
  return d; })();
function saveXP() { try { localStorage.setItem('lh-export2', JSON.stringify({ skipDnc: XP.skipDnc, fmt: XP.fmt })); } catch { /* ignore */ } }
const phoneOut = L => L.phone || '';
const xCols = () => XCOLS.filter(c => XP.cols.has(c[0]));
function defaultFile() {
  const base = XP.scope === 'search' ? searchName(XP.src) : XP.scope === 'sel' ? 'selected' : XP.scope === 'view' && summaryParts().length ? summaryParts().slice(0, 2).join(' ') : 'all';
  return ('leads ' + base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + dayKey.format(new Date());
}
function openExport(scope, src) {
  XP.src = scope === 'search' ? src : null;
  XP.scope = scope || 'view';
  if (XP.scope === 'sel' && !L$.sel.size) XP.scope = 'view';
  if (XP.scope === 'view' && !$('#vt')) runFilter();
  XP.preset = 'standard'; XP.cols = new Set(XPRESETS.standard); XP.custom = false;   // always opens on Standard
  exportModal();
}
function xBase(scope) { return scope === 'sel' ? [...L$.sel].map(id => ST.byId.get(id)).filter(Boolean) : scope === 'view' ? L$.res : scope === 'search' ? ST.leads.filter(L => L.search_id === XP.src) : ST.leads; }
function xRows() { const base = xBase(XP.scope); return XP.skipDnc ? base.filter(L => L.status !== 3) : base; }
function exportModal() {
  const rows = xRows(), cols = xCols(), groups = [...new Set(XCOLS.map(c => c[2]))];
  const filtered = summaryParts().length > 0;
  const scopes = [
    XP.src != null && ['search', searchName(XP.src)],
    L$.sel.size && ['sel', 'Selected'],
    ['view', filtered ? 'Filtered view' : 'All leads'],
    filtered && ['all', 'All leads'],
  ].filter(Boolean);
  const dnc = xBase(XP.scope).filter(L => L.status === 3).length;
  const ok = rows.length && cols.length;
  const go = XP.fmt === 'copy' ? `${ic('copy', 14)}Copy ${fmt(rows.length)} rows` : `${ic('download', 14)}Download ${XP.fmt === 'xlsx' ? 'Excel' : 'CSV'}`;
  $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal xm" data-stop role="dialog" aria-label="Export leads">
   <div class="xm-h"><div><h2>Export leads</h2><p class="help">${filtered && XP.scope === 'view' ? `Uses your filters: ${esc(summaryParts().join(' · '))}` : 'Narrow it down with the filters on the Leads page first.'}</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
   <div class="xm-b">
    <div class="xm-sec"><span class="fx-k">Leads</span>
      <div class="xm-scopes">${scopes.map(([k, l]) => `<button type="button" class="xm-scope ${XP.scope === k ? 'on' : ''}" data-xscopebtn="${k}"><b>${esc(l)}</b><span class="num">${fmt(xBase(k).length)} leads</span></button>`).join('')}</div>
      ${dnc || XP.skipDnc === false ? `<label class="ck xm-dnc"><input type="checkbox" data-xopt="skipDnc" ${XP.skipDnc ? 'checked' : ''}>Leave out ${fmt(dnc)} marked Do not contact</label>` : ''}</div>
    <div class="xm-sec"><div class="xm-row"><span class="fx-k">Columns</span><button type="button" class="linkbtn" data-xcustom="1">${XP.custom ? 'Hide columns' : 'Choose columns'}</button></div>
      <div class="xm-presetcards">${Object.entries(XPRESET_INFO).map(([k, [t, d]]) => `<button type="button" class="xm-pcard ${XP.preset === k ? 'on' : ''}" data-xpreset="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
      ${XP.custom ? `<div class="xcols">${groups.map(g => `<div><h6>${g}</h6>${XCOLS.filter(c => c[2] === g).map(c => `<label class="ck"><input type="checkbox" data-xcol="${c[0]}" ${XP.cols.has(c[0]) ? 'checked' : ''}>${c[1]}</label>`).join('')}</div>`).join('')}</div>` : ''}</div>
    <div class="xm-sec"><span class="fx-k">Format</span>
      <div class="seg-c xm-seg">${[['csv', 'CSV'], ['xlsx', 'Excel'], ['copy', 'Copy for Google Sheets']].map(([k, l]) => `<button type="button" class="${XP.fmt === k ? 'on' : ''}" data-xfmt="${k}">${l}</button>`).join('')}</div></div>
   </div>
   <div class="xm-f"><span class="xm-count num"><b>${fmt(rows.length)}</b> lead${rows.length === 1 ? '' : 's'} · ${cols.length} column${cols.length === 1 ? '' : 's'}</span>
     <button class="btn primary" style="margin-left:auto" data-xact="go" ${ok ? '' : 'disabled'}>${go}</button></div>
  </div></div>`;
}
function delimited(sep) {
  const cols = xCols();
  const q = v => { v = String(v ?? ''); if (/^[=@\t\r]/.test(v) || (/^[+\-]/.test(v) && !/^[+\-]?[\d\s().-]+$/.test(v))) v = "'" + v; return sep === ',' ? (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v) : v.replace(/[\t\n\r]/g, ' '); };
  return [cols.map(c => q(c[1])).join(sep), ...xRows().map(L => cols.map(c => q(c[3](L))).join(sep))].join('\r\n');
}
function saveFile(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
let xlsxLib = null;
function loadXLSX() {
  if (xlsxLib) return xlsxLib;
  xlsxLib = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => { xlsxLib = null; rej(new Error('Could not load the Excel exporter. Check your connection or export as CSV.')); }; document.head.appendChild(s); });
  return xlsxLib;
}
async function doExport(kind) {
  saveXP();
  const n = xRows().length, file = defaultFile();
  if (XP.fmt === 'copy') {
    try { await navigator.clipboard.writeText(delimited('\t')); closeOverlay(); toast(`Copied ${fmt(n)} rows. Paste into Google Sheets or Excel`); } catch { toast('Your browser blocked copying. Choose CSV instead', 'alert'); }
    return;
  }
  if (XP.fmt === 'csv') { saveFile(new Blob(['﻿' + delimited(',')], { type: 'text/csv;charset=utf-8' }), file + '.csv'); }
  else {
    try {
      const X = await loadXLSX(), cols = xCols();
      const data = [cols.map(c => c[1]), ...xRows().map(L => cols.map(c => c[3](L)))];
      const ws = X.utils.aoa_to_sheet(data), wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, 'Leads');
      X.writeFile(wb, file + '.xlsx');
    } catch (e) { toast(e.message, 'alert'); return; }
  }
  closeOverlay(); toast(`Exported ${fmt(n)} leads`, 'download');
}

/* ---------- checks */
const CK = { form: true, email: false };
function checkModal(ids) {
  const leads = ids.map(id => ST.byId.get(id)).filter(Boolean), withW = leads.filter(L => L.website).length;
  $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Check websites">
   <div class="card-h"><div><h2>Check ${fmt(leads.length)} lead${leads.length === 1 ? '' : 's'}</h2><p>${fmt(withW)} have a website. Leads without one are skipped.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
   <div class="card-b" style="display:flex;flex-direction:column;gap:10px">
    <label class="opt on"><input type="checkbox" checked disabled><div><b>Website loads</b><span>Is the site up, and how fast does it load? Always included.</span></div></label>
    <label class="opt ${CK.form ? 'on' : ''}"><input type="checkbox" data-ck="form" ${CK.form ? 'checked' : ''}><div><b>Contact form</b><span>Is there a form, does it have a CAPTCHA, which platform is it?</span></div></label>
    <label class="opt ${CK.email ? 'on' : ''}"><input type="checkbox" data-ck="email" ${CK.email ? 'checked' : ''}><div><b>Email addresses</b><span>Look for an email on the home page and contact page.</span></div></label>
    <span class="help">Runs in the background on GitHub. Results appear in the table as they finish.</span></div>
   <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-ckgo="${ids.join(',')}" ${withW ? '' : 'disabled'}>${ic('globe', 14)}Start checks</button></div></div></div>`;
}
async function startCheck(ids) {
  try {
    const r = await api('POST', '/api/checks', { ids, form: CK.form, email: CK.email });
    upsertSearch(r.search); closeOverlay(); toast(`Checking ${fmt(ids.length)} website${ids.length === 1 ? '' : 's'}. Results appear as they finish`, 'globe'); startPolling();
  } catch (e) {
    if (e.status === 502) { closeOverlay(); toast(e.message, 'alert'); refreshSearches(); } else toast(e.message, 'alert');
  }
}

/* ================================================================ searches: list + polling */
function upsertSearch(s) { const i = ST.searches.findIndex(x => x.id === s.id); if (i >= 0) ST.searches[i] = s; else ST.searches.unshift(s); }
const ACTIVE = s => s.status === 'queued' || s.status === 'running';
let pollTimer = 0, pollTick = 0;
function startPolling() { if (!pollTimer) pollTimer = setInterval(poll, 4000); }
function stopPolling() { clearInterval(pollTimer); pollTimer = 0; }
async function poll() {
  if (document.hidden) return;
  const active = ST.searches.filter(ACTIVE);
  if (!active.length) { stopPolling(); await sync(); return; }
  pollTick++;
  try {
    for (const s of active.slice(0, 5)) {
      const r = await api('GET', `/api/searches/${s.id}`);
      const was = s.status;
      upsertSearch(r.search);
      if (was !== r.search.status && !ACTIVE(r.search)) announce(r.search);
    }
    renderJobs();
    if (pollTick % 2 === 0) await sync();
  } catch (e) { console.warn('poll failed', e); }
}
function announce(s) {
  if (s.status === 'done') toast(s.kind === 'check' ? `${s.name}: done` : `${s.name}: ${fmt(s.new)} new lead${s.new === 1 ? '' : 's'}`);
  else if (s.status === 'failed') toast(`${s.name} stopped. Open Find leads for details`, 'alert');
}
async function refreshSearches() { try { const r = await api('GET', '/api/searches?limit=60'); ST.searches = r.searches; ST.leads = visibleLeads(); renderJobs(); if (ST.searches.some(ACTIVE)) startPolling(); } catch { /* keep old list */ } }
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#root .app')) { sync(); if (ST.searches.some(ACTIVE)) startPolling(); } });

/* ================================================================ find leads */
const RAD = { mi: [[0, 'City only'], [10, '+ 10 mi'], [25, '+ 25 mi'], [50, '+ 50 mi']], km: [[0, 'City only'], [15, '+ 15 km'], [40, '+ 40 km'], [80, '+ 80 km']] };
const PRAD = { mi: [[5, '5 mi around'], [10, '10 mi around'], [25, '25 mi around']], km: [[8, '8 km around'], [15, '15 km around'], [40, '40 km around']] };
const COUNTRY = { US: { name: 'United States', unit: 'mi', rw: 'state', ph: 'City, state or ZIP code' }, CA: { name: 'Canada', unit: 'km', rw: 'province', ph: 'City, province or postal code' }, AU: { name: 'Australia', unit: 'km', rw: 'state', ph: 'City, state or postcode' }, AE: { name: 'UAE', unit: 'km', rw: 'emirate', ph: 'City or emirate' } };
const LIMITS = [100, 250, 500, 1000, 0];
const FS = { ind: null, terms: new Set(), extra: [], country: 'US', locs: [], q: '', open: false, hi: 0, items: [], name: '', nameEdited: false, paste: false, pasteMsg: '', limit: 500, depth: 0, emails: false, showTerms: false, busy: false, allHist: false, minRev: 0, maxRev: 100, countryMenu: false, editName: false, website: 'yes', form: 'any' };
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
async function loadPlaces() {
  if (ST.places) return ST.places;
  const res = await fetch('/geo/places.json');
  if (!res.ok) throw new Error('Place data is missing. Run the Deploy workflow again so it can download it.');
  const raw = await res.json();
  for (const cc of Object.keys(raw)) raw[cc].cities.forEach(c => { c.n = norm(c[0] + ' ' + c[1]); });
  return (ST.places = raw);
}
async function loadPostal(cc) {
  if (ST.postal[cc] !== undefined) return ST.postal[cc];
  try { const r = await fetch(`/geo/postal-${cc}.json`); ST.postal[cc] = r.ok ? await r.json() : null; } catch { ST.postal[cc] = null; }
  return ST.postal[cc];
}
const curInd = () => (FS.ind == null ? null : ST.industries.find(i => i.id === FS.ind)) || null;
// Similar terms ("roofer", "roofing company") mostly find the same businesses: start with the first two.
const defaultTerms = (d) => new Set((d?.terms || []).slice(0, 2).map((_, i) => i));
const activeTerms = () => { const d = curInd(); return d ? [...d.terms.filter((_, i) => FS.terms.has(i)), ...FS.extra] : []; };
const unitOf = cc => COUNTRY[cc].unit;
const toKm = (v, cc) => unitOf(cc) === 'mi' ? v * 1.609 : v;
function circlesFor(l) {
  if (l.type === 'city') return [{ lat: l.lat, lon: l.lon, r: cityRadiusKm(l.pop) + toKm(RAD[unitOf(l.country)][l.rad][0], l.country), country: l.country }];
  if (l.type === 'postal') return [{ lat: l.lat, lon: l.lon, r: toKm(PRAD[unitOf(l.country)][l.rad][0], l.country), country: l.country }];
  if (l.type === 'region') {
    const cities = (ST.places?.[l.country]?.cities || []).filter(c => c[2] === l.region);
    let pick = cities.filter(c => c[5] >= 20000);
    if (pick.length < 5) pick = cities.slice(0, 40);
    return pick.map(c => ({ lat: c[3], lon: c[4], r: cityRadiusKm(c[5]), country: l.country }));
  }
  return [];
}
const locTitle = l => l.type === 'city' && l.country !== 'AE' ? `${l.label}, ${l.region}` : l.label;
function locSub(l) { const c = COUNTRY[l.country]; const rn = ST.places?.[l.country]?.regions?.[l.region]; return l.type === 'city' ? `${rn || l.region}, ${c.name}` : l.type === 'region' ? `Entire ${c.rw} · ${c.name}` : `${l.place ? l.place + ', ' : ''}${c.name}`; }
function autoName() { const d = curInd(); if (!d) return 'New search'; if (!FS.locs.length) return d.name; const l = FS.locs[0]; return `${d.name} · ${l.type === 'postal' ? l.code : l.label}${FS.locs.length > 1 ? ` + ${FS.locs.length - 1} more` : ''}`; }
function estimate() {
  const circles = FS.locs.flatMap(circlesFor), terms = activeTerms();
  if (!circles.length || !terms.length) return { n: 0, pts: 0 };
  const n = buildCells(circles, terms.length).length;
  return { n, pts: n / terms.length };
}

function locResults(q) {
  const P = ST.places; if (!P) return [];
  const out = [], nq = norm(q), toks = nq.split(' ').filter(Boolean), cc = FS.country, g = P[cc];
  if (!nq) { g.cities.slice(0, 8).forEach(c => out.push({ grp: `Largest cities in ${COUNTRY[cc].name}`, type: 'city', label: c[0], region: c[2], country: cc, lat: c[3], lon: c[4], pop: c[5] })); return out; }
  const raw = q.trim();
  const post = ST.postal[cc];
  if (post) {
    const key = cc === 'CA' ? raw.toUpperCase().replace(/\s+/g, ' ').slice(0, 3) : raw.toUpperCase();
    const hit = post[key] || (cc === 'CA' ? post[raw.toUpperCase().replace(/\s+/g, ' ')] : null);
    if (hit) out.push({ grp: 'Postal code', type: 'postal', code: key, label: (cc === 'US' ? 'ZIP code ' : cc === 'AU' ? 'Postcode ' : 'Postal code ') + key, place: hit[2], region: hit[3], country: cc, lat: hit[0], lon: hit[1], rad: 1 });
  } else if (/^\d{4,5}$|^[a-z]\d[a-z]/i.test(raw)) { loadPostal(cc).then(() => { if (FS.open) renderPop(); }); }
  const cityMatch = (code) => {
    const G = P[code], res = [];
    for (const c of G.cities) {
      const hay = c.n + ' ' + norm(c[2] + ' ' + (G.regions[c[2]] || ''));
      const words = hay.split(' ');
      if (!toks.every(t => words.some(w => w.startsWith(t)))) continue;
      const score = (c.n.startsWith(nq) ? 0 : c.n.startsWith(toks[0]) ? 1 : 2);
      res.push({ c, score });
      if (res.length > 400) break;
    }
    return res.sort((a, b) => a.score - b.score || b.c[5] - a.c[5]);
  };
  const cities = cityMatch(cc).slice(0, 7).map(({ c }) => ({ grp: 'Cities', type: 'city', label: c[0], region: c[2], country: cc, lat: c[3], lon: c[4], pop: c[5] }));
  const regions = Object.entries(g.regions).filter(([code, name]) => norm(name).split(' ').some(w => w.startsWith(nq)) || norm(name).startsWith(nq) || (nq.length >= 2 && norm(code) === nq))
    .slice(0, 4).map(([code, name]) => ({ grp: COUNTRY[cc].rw[0].toUpperCase() + COUNTRY[cc].rw.slice(1) + 's', type: 'region', label: name, region: code, country: cc }));
  const cityNameHit = cities.some(c => norm(c.label).startsWith(nq));
  out.push(...(regions.length && !cityNameHit ? [...regions, ...cities] : [...cities, ...regions]));
  for (const oc of Object.keys(P)) { if (oc === cc) continue; cityMatch(oc).slice(0, 3).forEach(({ c }) => out.push({ grp: 'In ' + COUNTRY[oc].name, type: 'city', label: c[0], region: c[2], country: oc, lat: c[3], lon: c[4], pop: c[5] })); }
  return out;
}
const sameLoc = (a, b) => a.type === b.type && a.label === b.label && (a.region || '') === (b.region || '') && a.country === b.country;
function addLoc(it) {
  if (FS.locs.some(l => sameLoc(l, it))) { toast('Already added', 'alert'); return false; }
  FS.locs.push({ ...it, grp: undefined, rad: it.type === 'region' ? 0 : 1 }); return true;
}

/* ---------- modern dropdowns (Find leads) ---------- */
const FX = { open: null, q: '', hi: 0 };
const chev = '<svg class="fxs-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';
function fxsDefs(id) {
  if (id === 'ind') return { cls: 'fxs-ind', search: true, value: FS.ind, opts: ST.industries.filter(x => !x.archived).map(x => ({ v: x.id, l: x.name, sub: x.terms.join(', ') })) };
  if (id === 'limit') return { cls: 'fxs-mini', value: FS.limit, opts: [100, 250, 500, 1000, 2500, 5000, 0].map(n => ({ v: n, l: n ? fmt(n) : 'No limit', sub: n ? '' : 'Run the whole area' })), custom: true };
  if (id === 'sort') return { cls: 'fxs-sort', value: L$.sort, opts: [['reviews', 'Most reviews'], ['rating', 'Highest rating'], ['added', 'Newest first'], ['name', 'Name A–Z']].map(([v, l]) => ({ v, l })) };
  const m = id.match(/^rad-(\d+)$/);
  if (m) { const l = FS.locs[+m[1]]; if (!l) return null; const u = unitOf(l.country); return { cls: 'fxs-chip', value: l.rad, opts: (l.type === 'postal' ? PRAD : RAD)[u].map(([, lab], k) => ({ v: k, l: lab.replace(' around', '') })) }; }
  return null;
}
function fxsHTML(id) {
  const d = fxsDefs(id); if (!d) return '';
  const cur = d.opts.find(o => o.v === d.value) || (id === 'limit' ? { l: fmt(FS.limit) } : id === 'ind' ? { l: 'Pick an industry', ph: true } : d.opts[0]);
  const open = FX.open === id, q = FX.q.toLowerCase();
  const list = d.opts.filter(o => !q || o.l.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q));
  return `<div class="fxs ${d.cls}" data-fxs="${id}"><button type="button" class="fxs-btn" data-fxsopen="${id}" aria-haspopup="listbox" aria-expanded="${open}"><span class="${cur.ph ? 'fxs-ph' : ''}">${esc(cur.l)}</span>${chev}</button>${open ? `<div class="fxs-pop" role="listbox">
    ${d.search ? `<div class="fxs-search">${ic('find', 14)}<input id="fxs-q" placeholder="Search" value="${esc(FX.q)}" autocomplete="off"></div>` : ''}
    <div class="fxs-list">${list.map((o, i) => `<button type="button" role="option" aria-selected="${o.v === d.value}" class="fxs-opt ${o.v === d.value ? 'sel' : ''} ${i === FX.hi ? 'hi' : ''}" data-fxsval="${id}" data-v="${o.v}"><span class="fxs-ol"><b>${esc(o.l)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>${o.v === d.value ? ic('check', 15) : ''}</button>`).join('') || '<div class="fxs-empty">No matches</div>'}</div>
    ${d.custom ? `<div class="fxs-custom"><label for="fxs-num">Custom</label><input id="fxs-num" type="number" min="1" step="50" placeholder="e.g. 750" inputmode="numeric"><button type="button" class="btn sm" data-fxscustom="${id}">Set</button></div>` : ''}</div>` : ''}</div>`;
}
function fxsRerender(id) { const el = document.querySelector(`[data-fxs="${id}"]`); if (el) el.outerHTML = fxsHTML(id); }
function fxsOpen(id) {
  const prev = FX.open; FX.open = FX.open === id ? null : id; FX.q = ''; FX.hi = Math.max(0, (fxsDefs(id)?.opts || []).findIndex(o => o.v === fxsDefs(id).value));
  if (prev && prev !== id) fxsRerender(prev);
  fxsRerender(id);
  if (FX.open) { const sq = $('#fxs-q'); if (sq) sq.focus(); else document.querySelector(`[data-fxs="${id}"] .fxs-opt.hi`)?.focus(); document.querySelector(`[data-fxs="${id}"] .fxs-opt.hi`)?.scrollIntoView({ block: 'nearest' }); }
}
function fxsClose() { if (!FX.open) return; const id = FX.open; FX.open = null; fxsRerender(id); }
function fxsSet(id, raw) {
  if (id === 'sort') { L$.sort = raw; FX.open = null; fxsRerender('sort'); leadsUpdate(false); const vt = $('#vt'); if (vt) vt.scrollTop = 0; return; }
  const v = Number(raw);
  if (id === 'ind') { FS.ind = v; FS.terms = defaultTerms(curInd()); FS.extra = []; FX.open = null; fxsRerender('ind'); refreshFind(['what']); return; }
  if (id === 'limit') { FS.limit = v > 0 ? Math.floor(v) : 0; FX.open = null; fxsRerender('limit'); refreshFind([]); return; }
  const m = id.match(/^rad-(\d+)$/); if (m) { FS.locs[+m[1]].rad = v; FX.open = null; refreshFind(['where']); }
}

V.find = () => {
  if (FS.ind != null && !ST.industries.find(i => i.id === FS.ind && !i.archived)) { FS.ind = null; FS.terms = new Set(); FS.extra = []; }
  const cfg = ST.config || {};
  return `
  <div class="head"><div><div class="eyebrow">Google Maps</div><h1>Find leads</h1></div></div>
  ${!cfg.github ? `<div class="banner">${ic('alert', 18)}<div><b>Searches can't start yet</b>Add the <code>GH_TOKEN</code> secret in GitHub and run Deploy again.</div></div>` : ''}
  <div class="card fx">
    <div class="fx-bar">
      <div class="fx-field fx-ind"><span class="fx-lbl">Industry</span>${fxsHTML('ind')}</div>
      <div class="fx-field fx-loc combo" id="combo"><label class="fx-lbl" for="fs-loc">Location</label>
        <div class="fx-locin">
          <button class="fx-flag" data-fsx="cmenu" aria-label="Country: ${COUNTRY[FS.country].name}" aria-haspopup="true">${flag(FS.country, 20)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg></button>
          <input id="fs-loc" role="combobox" aria-expanded="false" aria-controls="loc-pop" autocomplete="off" placeholder="${COUNTRY[FS.country].ph}" value="${esc(FS.q)}">
        </div>
        ${FS.countryMenu ? `<div class="menu fx-cmenu" role="menu">${Object.keys(COUNTRY).map(c => `<button role="menuitem" data-fsx="country" data-c="${c}" class="${FS.country === c ? 'on' : ''}">${flag(c, 20)}${COUNTRY[c].name}</button>`).join('')}</div>` : ''}
        <div class="combo-pop" id="loc-pop" hidden></div></div>
      <button class="btn primary fx-go" id="fs-go" data-fsx="start">${ic('find')}Start search</button>
    </div>
    <div id="fs-where">${whereHTML()}</div>
    <div class="fx-opts">
      <div class="fx-opt"><span class="fx-lbl">Leads</span>${fxsHTML('limit')}</div>
      <div class="fx-opt"><span class="fx-lbl">Reviews</span>
        <div class="fx-range"><input id="fs-rmin" class="fx-mini num" type="number" min="0" inputmode="numeric" placeholder="Min" aria-label="Minimum reviews" value="${FS.minRev || ''}"><span>–</span><input id="fs-rmax" class="fx-mini num" type="number" min="0" inputmode="numeric" placeholder="Max" aria-label="Maximum reviews" value="${FS.maxRev ?? ''}"></div></div>
      <div class="fx-opt"><span class="fx-lbl">Website</span><div class="seg-c fx-seg3" role="radiogroup" aria-label="Website" id="fs-web">${webHTML()}</div></div>
      <div class="fx-opt fx-grow"><span class="fx-lbl">Also check</span><div class="fx-pills" id="fs-collect">${collectHTML()}</div></div>
    </div>
    <div class="fx-foot"><div id="fs-termhelp" class="fx-terms">${termHelp()}</div><div id="fs-sum" class="fx-est">${sumHTML()}</div></div>
    <div id="fs-what">${FS.showTerms ? termsBox() : ''}</div>
    ${FS.paste ? `<div class="pastebox fx-paste"><textarea class="input" id="fs-paste" placeholder="One location per line&#10;Austin, TX&#10;78704&#10;Toronto&#10;Dubai" style="min-height:110px"></textarea><div class="row" style="justify-content:space-between"><span class="help" id="paste-msg">${esc(FS.pasteMsg)}</span><div class="row" style="gap:6px"><button class="btn sm ghost" data-fsx="pastetoggle">Cancel</button><button class="btn sm primary" data-fsx="pasteapply">Add locations</button></div></div></div>` : ''}
  </div>
  <div class="card"><div class="card-h"><div><h3>Search history</h3></div><button class="btn ghost sm" data-act="refreshjobs">Refresh</button></div>
    <div id="jobs">${jobsHTML()}</div></div>`;
};
MOUNT.find = () => {
  loadPlaces().then(() => { const w = $('#fs-where'); if (w) w.innerHTML = whereHTML(); refreshFind([]); }).catch(e => toast(e.message, 'alert'));
  updateStart();
  if (ST.searches.some(ACTIVE)) startPolling();
};
function termHelp() {
  const t = activeTerms(), d = curInd(); if (!d) return '';
  return `<span class="fx-k">Terms</span> ${t.slice(0, 3).map(x => `<span class="fx-term">${esc(x)}</span>`).join('')}${t.length > 3 ? `<span class="fx-term">+${t.length - 3}</span>` : ''}<button class="linkbtn muted" data-fsx="terms">${FS.showTerms ? 'Done' : 'Edit'}</button>`;
}
function termsBox() {
  const d = curInd(); if (!d) return '';
  return `<div class="termbox fx-termbox"><p class="help fx-termhint">Similar terms mostly find the same businesses, so one or two distinct terms is usually enough.</p><div class="termlist">${d.terms.map((t, i) => `<div class="termrow" data-fsterm="${i}" role="checkbox" tabindex="0" aria-checked="${FS.terms.has(i)}"><span class="cb ${FS.terms.has(i) ? 'on' : ''}"></span><span>${esc(t)}</span></div>`).join('')}
   ${FS.extra.map((t, i) => `<div class="termrow"><span class="cb on"></span><span>${esc(t)}</span><span class="sub">This search only</span><button class="btn ghost sm" data-fsextra="${i}" aria-label="Remove ${esc(t)}">${ic('x', 13)}</button></div>`).join('')}
   <div class="termadd">${ic('plus', 14)}<input id="fs-extra" placeholder="Add a term for this search" autocomplete="off"></div></div></div>`;
}
function whereHTML() {
  const chips = FS.locs.map((l, i) => {
    const u = unitOf(l.country), n = l.type === 'region' ? circlesFor(l).length : 0;
    return `<span class="fx-chip">${flag(l.country, 16)}<b>${esc(locTitle(l))}</b>${l.type === 'region' ? `<span class="fx-chipnote">${n ? `${fmt(n)} ${n === 1 ? 'city' : 'cities'}` : 'whole ' + COUNTRY[l.country].rw}</span>` : fxsHTML('rad-' + i)}<button data-fsx="rmloc" data-i="${l.type ? i : i}" aria-label="Remove ${esc(l.label)}">${ic('x', 12)}</button></span>`;
  }).join('');
  return `<div class="fx-chips">${chips}${FS.locs.length ? '' : '<span class="fx-hint">Add one or more cities, states or postcodes.</span>'}<button class="linkbtn muted" data-fsx="pastetoggle">${ic('plus', 12)} Paste a list</button>${FS.locs.length > 1 ? '<button class="linkbtn muted" data-fsx="clearlocs">Clear</button>' : ''}</div>`;
}
const WEB = [['any', 'Any'], ['yes', 'Has website'], ['no', 'No website']];
function webHTML() { return WEB.map(([k, l]) => `<button type="button" role="radio" aria-checked="${FS.website === k}" class="${FS.website === k ? 'on' : ''}" data-web="${k}">${l}</button>`).join(''); }
function collectHTML() {
  if (FS.website === 'no') return `<span class="fx-pillnote">Nothing to check for businesses without a website.</span>`;
  const pill = (k, label, on, tip, locked) => `<button type="button" class="fx-pill ${on ? 'on' : ''}" data-chk="${k}" aria-pressed="${on}" title="${tip}" ${locked ? 'data-locked="1"' : ''}><span class="fx-tick">${on ? ic('check', 12) : ''}</span>${label}</button>`;
  return pill('site', 'Website loads', FS.depth >= 1, 'Checks that each website is up, and how fast it loads.', FS.depth === 2)
    + pill('form', 'Contact form', FS.depth === 2, 'Finds the contact form, CAPTCHA and platform. Best for outreach.')
    + pill('email', 'Emails', FS.emails, 'Looks for an email address on each website.')
    + (FS.depth === 2 ? `<div class="fx-keep"><span class="fx-k">Keep</span><div class="seg-c fx-seg4" role="radiogroup" aria-label="Which businesses to keep">${KEEP.map(([k, l, tip]) => `<button type="button" role="radio" aria-checked="${FS.form === k}" class="${FS.form === k ? 'on' : ''}" data-keep="${k}" title="${tip}">${l}</button>`).join('')}</div></div>` : '');
}
const KEEP = [['any', 'All', 'Keep every business, with or without a form'], ['form', 'Has a form', 'Only businesses with a contact form'], ['open', 'No CAPTCHA', 'Only businesses whose form has no CAPTCHA'], ['captcha', 'CAPTCHA only', 'Only businesses whose form has a CAPTCHA']];
const dur = s => !s ? '—' : s < 60 ? `${s} s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
function startProblem() {
  const terms = activeTerms(), { n } = estimate();
  if (!ST.config.github) return 'Connect GitHub first';
  if (!curInd()) return 'Pick an industry';
  if (!terms.length) return 'Pick at least one search term';
  if (!FS.locs.length) return 'Add a location';
  if (n > 6000 && !FS.limit) return `Too big: ${fmt(n)} map searches (max 6,000). Set a lead limit or use a smaller area`;
  if (FS.maxRev != null && FS.maxRev < (FS.minRev || 0)) return 'Max reviews is below min';
  return '';
}
function sumHTML() {
  const { n, pts } = estimate();
  const avg = pts * 13, f = FS.limit && avg ? Math.min(1, FS.limit / avg) : 1;
  const maps = Math.round(n * f * 2 / 4), biz = Math.min(avg, FS.limit || avg);
  const site = FS.depth >= 1 || FS.emails ? Math.round(biz * (FS.depth === 2 ? 1.8 : 1) * (FS.emails ? 1.3 : 1) / 20) : 0;
  const hi = Math.round(pts * 18), est = FS.limit ? Math.min(hi, FS.limit) : hi;
  const name = FS.nameEdited ? FS.name : autoName();
  const nameHTML = FS.editName ? `<input id="fs-name" class="input fx-nameinput" value="${esc(name)}" maxlength="80" aria-label="Search name">` : `<button class="fx-name" data-fsx="name" title="Rename this search">${esc(name)} ${ic('edit', 12)}</button>`;
  const p = startProblem();
  return `${nameHTML}<span class="fx-dot">·</span>${p ? `<span class="fx-warn">${esc(p)}</span>` : `${n > 6000 ? '<span class="fx-note" title="The area is larger than one search can cover, so it searches the biggest cities first and stops at your lead limit.">largest cities first</span><span class="fx-dot">·</span>' : ''}<span>up to <b class="num">${fmt(est)}</b> ${FS.depth === 2 && FS.form !== 'any' ? { form: 'with a form', open: 'with an open form', captcha: 'with a CAPTCHA form' }[FS.form] : 'leads'}</span><span class="fx-dot">·</span><span>about <b class="num">${dur(maps + site + 45)}</b></span>`}`;
}
function updateStart() { const b = $('#fs-go'); if (!b) return; const p = startProblem(); b.disabled = !!p || FS.busy; b.title = p; b.innerHTML = FS.busy ? '<span class="spin"></span>Starting…' : ic('find') + 'Start search'; }
function refreshFind(parts) {
  if (!$('#fs-sum')) return;
  if (parts.includes('what')) $('#fs-what').innerHTML = FS.showTerms ? termsBox() : '';
  if (parts.includes('where')) $('#fs-where').innerHTML = whereHTML();
  const th = $('#fs-termhelp'); if (th) th.innerHTML = termHelp();
  if (!(document.activeElement && document.activeElement.id === 'fs-name')) $('#fs-sum').innerHTML = sumHTML();
  updateStart();
}
function renderPop() {
  const pop = $('#loc-pop'), inp = $('#fs-loc'); if (!pop) return;
  if (!FS.open || !ST.places) { pop.hidden = true; inp && inp.setAttribute('aria-expanded', 'false'); return; }
  const items = locResults(FS.q); FS.items = items; FS.hi = Math.min(FS.hi, Math.max(0, items.length - 1));
  let g = '', h = '';
  items.forEach((it, i) => {
    if (it.grp !== g) { g = it.grp; h += `<div class="cmdk-grp">${esc(g)}</div>`; }
    const added = FS.locs.some(l => sameLoc(l, it));
    h += `<button class="combo-it ${i === FS.hi ? 'on' : ''}" data-fsx="addloc" data-li="${i}" ${added ? 'disabled' : ''}>${flag(it.country, 20)}<span><b>${esc(it.label)}</b><small>${esc(it.type === 'postal' ? (it.place ? it.place + ' · ' : '') + 'Area around this postal code' : locSub(it))}${it.type === 'city' && it.pop ? ' · pop. ' + fmt(it.pop) : ''}</small></span>${added ? '<em>Added</em>' : ''}</button>`;
  });
  if (!items.length) h = `<div class="empty" style="padding:18px"><b>No match for “${esc(FS.q)}”</b>Check the spelling, try the ${COUNTRY[FS.country].rw} instead, or switch country above.</div>`;
  pop.innerHTML = h; pop.hidden = false; inp.setAttribute('aria-expanded', 'true');
  pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
async function pasteApply() {
  await Promise.all(Object.keys(COUNTRY).map(loadPostal));
  const lines = $('#fs-paste').value.split(/\n|;/).map(s => s.trim()).filter(Boolean);
  let added = 0; const miss = [], keep = FS.country;
  for (const line of lines) {
    let hit = null;
    for (const c of [keep, ...Object.keys(COUNTRY).filter(k => k !== keep)]) {
      FS.country = c;
      const r = locResults(line).filter(x => !x.grp.startsWith('In ') && !x.grp.startsWith('Largest'));
      const first = norm(line.split(',')[0]);
      const exact = r.find(x => norm(x.label) === first);
      hit = exact || (r[0] && (r[0].type === 'postal' || norm(r[0].label).startsWith(first)) ? r[0] : null);
      if (hit) break;
    }
    FS.country = keep;
    if (hit) { if (!FS.locs.some(l => sameLoc(l, hit))) { addLoc(hit); added++; } } else miss.push(line);
  }
  FS.pasteMsg = `Added ${added} location${added === 1 ? '' : 's'}.` + (miss.length ? ` Couldn't find: ${miss.slice(0, 4).join(', ')}${miss.length > 4 ? '…' : ''}` : '');
  if (!miss.length) FS.paste = false;
  render(); toast(`Added ${added} location${added === 1 ? '' : 's'}`);
}
async function startSearch() {
  const terms = activeTerms(), circles = FS.locs.flatMap(circlesFor);
  const name = FS.nameEdited && FS.name.trim() ? FS.name.trim() : autoName();
  FS.busy = true; updateStart();
  try {
    const r = await api('POST', '/api/searches', { name, industry_id: FS.ind, terms, circles, limit: FS.limit, depth: FS.depth, emails: FS.emails, minReviews: FS.minRev || 0, maxReviews: FS.maxRev, website: FS.website, form: FS.depth === 2 ? FS.form : 'any', locationLabels: FS.locs.map(locTitle) });
    upsertSearch(r.search); toast(`“${name}” started`); FS.nameEdited = false; FS.name = ''; startPolling();
  } catch (e) {
    toast(e.message, 'alert');
    if (e.status === 502) refreshSearches();
  } finally { FS.busy = false; refreshFind([]); renderJobs(); }
}
function etaText(j) {
  if (j.status !== 'running' || !j.started_at || !j.total || !j.done) return '';
  const el = Date.now() - j.started_at, left = (el / j.done) * (j.total - j.done);
  if (left < 60e3) return 'less than a minute left';
  return `about ${Math.round(left / 60e3)} min left`;
}
function jobsHTML() {
  if (!ST.searches.length) return `<div class="empty"><b>No searches yet</b>Your searches and their progress show up here.</div>`;
  const list = FS.allHist ? ST.searches : ST.searches.slice(0, 10);
  return list.map(j => {
    const active = ACTIVE(j), check = j.kind === 'check', stuck = active && Date.now() - (j.heartbeat_at || j.started_at || j.created_at) > 5 * 60 * 1000;
    const mapsDone = !j.total || j.done >= j.total || j.limit_reached;
    const checking = j.status === 'running' && (check || (mapsDone && j.to_check > j.checked));
    const stage = j.status === 'queued' ? 'Starting' : checking ? 'Checking websites' : j.status === 'running' ? 'Searching Google Maps' : '';
    const pill = stuck ? '<span class="pill c-warn">Not responding</span>' : active ? `<span class="pill c-info">${stage}</span>` : j.status === 'failed' ? '<span class="pill c-bad">Stopped</span>' : j.status === 'cancelled' ? '<span class="pill c-idle">Cancelled</span>' : '<span class="pill c-ok">Done</span>';
    const pct = check ? (j.to_check ? j.checked / j.to_check : 0) : checking ? (j.to_check ? j.checked / j.to_check : 1) : (j.total ? j.done / j.total : 0);
    const progressLine = j.status === 'queued' ? 'Waiting for GitHub to start the runner…'
      : checking ? `${fmt(j.checked)} of ${fmt(j.to_check)} websites checked`
      : `${fmt(j.done)} of ${fmt(j.total)} map searches${etaText(j) ? ' · ' + etaText(j) : ''}`;
    const meta = [whenPT(j.created_at), check ? '' : (j.locations || []).slice(0, 3).join(', ') + ((j.locations || []).length > 3 ? ` +${j.locations.length - 3}` : ''), check ? '' : (['Business info', 'Website check', 'Contact form check'][j.depth] || '') + (j.emails ? ' + emails' : ''), check || (!j.minReviews && j.maxReviews == null) ? '' : `${fmt(j.minReviews || 0)}–${j.maxReviews == null ? 'any' : fmt(j.maxReviews)} reviews`, check || !j.website || j.website === 'any' ? '' : j.website === 'yes' ? 'with website' : 'no website', check || !j.form || j.form === 'any' ? '' : { form: 'has a form', open: 'no CAPTCHA', captcha: 'CAPTCHA only' }[j.form]].filter(Boolean).join(' · ');
    const stats = check
      ? `<span><b>${fmt(j.checked)}</b> of ${fmt(j.to_check)} checked</span>`
      : j.form && j.form !== 'any' ? `<span><b>${fmt(j.qualified)}</b> ${{ form: 'with a form', open: 'with an open form', captcha: 'with a CAPTCHA form' }[j.form]}</span><span>${fmt(j.checked)} websites checked</span><span>${fmt(Math.max(0, j.checked - j.qualified))} didn't match</span>${j.limit_reached ? `<span class="okline">${ic('check', 13)}Reached your limit of ${fmt(j.limit)}</span>` : ''}`
      : `<span><b>${fmt(j.new)}</b> new lead${j.new === 1 ? '' : 's'}</span><span>${fmt(j.found)} found</span><span>${fmt(j.dup)} already in Leads</span>${j.excluded ? `<button class="linkbtn muted" data-excl="${j.id}">${fmt(j.excluded)} excluded</button>` : ''}${j.filtered ? `<span>${fmt(j.filtered)} skipped by your filters</span>` : ''}${!active && j.to_check ? `<span>${fmt(j.checked)} websites checked</span>` : ''}${j.limit_reached ? `<span class="okline">${ic('check', 13)}Reached your limit of ${fmt(j.limit)}</span>` : ''}`;
    const actions = active
      ? `${j.run_url ? `<a class="btn sm ghost" href="${esc(j.run_url)}" target="_blank" rel="noopener">${ic('ext', 13)}Log</a>` : ''}${stuck ? `<button class="btn sm" data-jact="retry" data-id="${j.id}">${ic('retry', 13)}Retry</button>` : ''}<button class="btn sm ghost" data-jact="cancel" data-id="${j.id}">Cancel</button>`
      : `${j.status === 'failed' || j.status === 'cancelled' ? `<button class="btn sm" data-jact="retry" data-id="${j.id}" title="Continue where it stopped">${ic('retry', 13)}${j.done ? 'Resume' : 'Retry'}</button>` : ''}
         ${!check && viewN(j) ? `<button class="btn sm btn-soft" data-jact="view" data-id="${j.id}">View ${fmt(viewN(j))} lead${viewN(j) === 1 ? '' : 's'} ${ic('arrow', 13)}</button>` : ''}
         <div class="kebab"><button class="iconbtn sm" data-menu="${j.id}" aria-label="More actions" aria-haspopup="true">⋯</button>${OPENMENU === j.id ? `<div class="menu" role="menu">
           ${!check && j.new ? `<button role="menuitem" data-jact="export" data-id="${j.id}">${ic('download', 14)}Export leads</button>` : ''}
           ${!check ? `<button role="menuitem" data-jact="again" data-id="${j.id}">${ic('play', 13)}Run again</button>` : ''}
           ${j.run_url ? `<a role="menuitem" href="${esc(j.run_url)}" target="_blank" rel="noopener">${ic('ext', 13)}Open log</a>` : ''}
           <button role="menuitem" class="danger" data-jact="delete" data-id="${j.id}">${ic('trash', 14)}Delete from history</button></div>` : ''}</div>`;
    return `<div class="job ${active ? 'live' : ''}"><div class="job-main">
      <div class="row job-title"><b>${esc(j.name)}</b>${pill}</div>
      <div class="job-meta">${esc(meta)}</div>
      ${active ? `<div class="job-prog"><div class="seg" style="height:6px"><i style="width:${Math.max(2, Math.min(100, pct * 100))}%;background:var(--info)"></i></div><span class="num">${progressLine}</span></div>` : ''}
      <div class="jstats num">${stats}</div>
      ${j.status === 'failed' && j.error ? `<div class="job-err">${ic('alert', 15)}<span>${esc(j.error)}</span></div>` : ''}
      ${!check && j.status === 'done' && j.limit && !j.limit_reached ? `<div class="job-note">${ic('alert', 15)}<span>Searched the whole area and found ${fmt(j.form && j.form !== 'any' ? j.qualified : j.new)} of the ${fmt(j.limit)} you wanted. Try a larger area, more locations or a nearby city.</span></div>` : ''}</div>
      <div class="row job-acts">${actions}</div></div>`;
  }).join('') + (ST.searches.length > 10 ? `<div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:center"><button class="btn ghost sm" data-act="allhist">${FS.allHist ? 'Show fewer' : `Show all ${ST.searches.length} searches`}</button></div>` : '');
}
let OPENMENU = null;
// Leads you still have from a search (deleted ones don't count); while it runs, its own running total.
const viewN = (j) => ACTIVE(j) ? (j.form && j.form !== 'any' ? j.qualified : j.new) : ST.leads.reduce((n, L) => n + (L.search_id === j.id ? 1 : 0), 0);
function renderJobs() { const el = $('#jobs'); if (el) el.innerHTML = jobsHTML(); }
async function excludedModal(id) {
  $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop><div class="card-b"><span class="spin"></span> Loading…</div></div></div>`;
  try {
    const r = await api('GET', `/api/searches/${id}/excluded`), s = ST.searches.find(x => x.id === id);
    $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Excluded results">
      <div class="card-h"><div><h2>Excluded results (${fmt(r.excluded.length)})</h2><p>Google returned these, but their category isn't on ${esc(industryName(s?.industry_id))}'s accepted list, so they never entered your leads.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
      <div class="tbl-wrap" style="max-height:420px"><table><thead><tr><th>Business</th><th>Google category</th><th></th></tr></thead><tbody>${r.excluded.map(x => `<tr><td><div class="biz">${esc(x.name)}</div><div class="sub">${esc(x.address || '')}</div></td><td class="sub">${esc(x.category || 'No category')}</td><td>${x.category ? `<button class="btn sm ghost" data-acceptcat="${esc(x.category)}" data-ind="${s?.industry_id}">Accept category</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">Nothing was excluded.</div></td></tr>'}</tbody></table></div>
      <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0"><span class="help">Accepting a category adds it to the industry. Future searches keep those businesses; run the search again to bring these in.</span><button class="btn" data-act="close">Done</button></div></div></div>`;
  } catch (e) { closeOverlay(); toast(e.message, 'alert'); }
}
function loadIntoForm(j) {
  FS.ind = j.industry_id; const d = curInd();
  FS.terms = new Set((d?.terms || []).map((t, i) => (!j.terms.length || j.terms.includes(t)) ? i : -1).filter(i => i >= 0));
  FS.extra = j.terms.filter(t => !d?.terms.includes(t)); FS.limit = j.limit; FS.depth = j.depth; FS.emails = j.emails; FS.minRev = j.minReviews || 0; FS.maxRev = j.maxReviews ?? null; FS.website = j.website || 'any'; FS.form = j.form || 'any';
  FS.name = j.name; FS.nameEdited = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('Settings loaded. Add the locations again, then press Start search');
}

/* ================================================================ industries */
const IP = { q: '', sort: 'mine', showRemoved: false, menu: null };
const byPos = (a, b) => (a.position || 0) - (b.position || 0) || a.name.localeCompare(b.name);
V.industries = () => `
  <div class="head"><div><div class="eyebrow">Setup</div><h1>Industries</h1><p>What to search for, and which Google categories count as a match.</p></div>
    <button class="btn primary" data-act="indnew">${ic('plus')}Add industry</button></div>
  <div class="indtools">
    <div class="lsearch">${ic('find', 15)}<input id="ind-q" placeholder="Search industries or terms" value="${esc(IP.q)}" autocomplete="off"></div>
    <div class="seg-c" role="radiogroup" aria-label="Sort">${[['mine', 'Your order'], ['leads', 'Most leads'], ['recent', 'Recently searched'], ['name', 'A–Z']].map(([k, l]) => `<button role="radio" aria-checked="${IP.sort === k}" class="${IP.sort === k ? 'on' : ''}" data-indsort="${k}">${l}</button>`).join('')}</div>
  </div>
  <div id="indgrid">${industriesGrid()}</div>`;
function industryStats() {
  const counts = new Map(), cats = new Map();
  for (const L of ST.leads) {
    counts.set(L.industry_id, (counts.get(L.industry_id) || 0) + 1);
    if (L.category) { let m = cats.get(L.industry_id); if (!m) cats.set(L.industry_id, m = new Map()); m.set(L.category, (m.get(L.category) || 0) + 1); }
  }
  const last = new Map(); for (const s of ST.searches) if (s.industry_id && (!last.has(s.industry_id) || s.created_at > last.get(s.industry_id))) last.set(s.industry_id, s.created_at);
  return { counts, cats, last };
}
function industriesGrid() {
  const { counts, last } = industryStats(), q = IP.q.trim().toLowerCase();
  let act = ST.industries.filter(d => !d.archived && (!q || d.name.toLowerCase().includes(q) || d.terms.some(t => t.toLowerCase().includes(q))));
  act.sort(IP.sort === 'leads' ? (a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.name.localeCompare(b.name) : IP.sort === 'recent' ? (a, b) => (last.get(b.id) || 0) - (last.get(a.id) || 0) || a.name.localeCompare(b.name) : IP.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : byPos);
  const canDrag = IP.sort === 'mine' && !q;
  const arc = ST.industries.filter(d => d.archived);
  const card = d => {
    const n = counts.get(d.id) || 0, ls = last.get(d.id);
    return `<article class="indcard${canDrag ? ' inddrag' : ''}" data-indid="${d.id}">
      <div class="indcard-top"><h3>${esc(d.name)}</h3>
        <div class="kebab"><button class="iconbtn sm" data-indmenu="${d.id}" aria-label="More actions for ${esc(d.name)}" aria-haspopup="true">⋯</button>${IP.menu === d.id ? `<div class="menu" role="menu"><button role="menuitem" data-indedit="${d.id}">${ic('edit', 14)}Edit</button><button role="menuitem" class="danger" data-indrm="${d.id}">${ic('trash', 14)}Remove</button></div>` : ''}</div></div>
      <div class="indcard-stats"><span><b class="num">${fmt(n)}</b> lead${n === 1 ? '' : 's'}</span><span class="dotsep">·</span><span>${ls ? 'Searched ' + dayPT(ls).toLowerCase().replace(/^(\w)/, (m) => /\d/.test(m) ? m : m) : 'Never searched'}</span></div>
      <div class="indcard-terms">${d.terms.slice(0, 4).map((t, i) => `<span class="fx-term ${i < 2 ? 'def' : ''}" ${i < 2 ? 'title="Searched by default"' : ''}>${esc(t)}</span>`).join('')}${d.terms.length > 4 ? `<span class="fx-term">+${d.terms.length - 4}</span>` : ''}</div>
      <div class="indcard-cats" title="${esc(d.categories.join(', '))}">${d.categories.length ? `Accepts ${esc(d.categories.slice(0, 2).join(', '))}${d.categories.length > 2 ? ` and ${d.categories.length - 2} more` : ''}` : 'Accepts any Google category'}</div>
      <div class="indcard-acts"><button class="btn sm" data-indfind="${d.id}">${ic('find', 13)}Find leads</button><button class="btn sm ghost" data-indedit="${d.id}">Edit</button>${n ? `<button class="btn sm ghost" data-indleads="${d.id}">View leads</button>` : ''}</div>
    </article>`;
  };
  return `${canDrag && act.length > 1 ? `<p class="help indhint">${ic('drag', 13)}Drag cards to put the trades you use most first. This order is used everywhere you pick an industry.</p>` : ''}<div class="indgrid">${act.map(card).join('')}${!q ? `<button class="indcard indadd" data-act="indnew">${ic('plus', 20)}<b>Add industry</b><span>Any trade you want to find</span></button>` : ''}</div>
    ${!act.length && q ? `<div class="empty"><b>No industry matches “${esc(IP.q)}”</b><button class="linkbtn" data-act="indnew">Add it as a new industry</button></div>` : ''}
    ${arc.length ? `<div class="indremoved"><button class="linkbtn muted" data-act="indshowrm">${IP.showRemoved ? 'Hide' : 'Show'} ${arc.length} removed industr${arc.length === 1 ? 'y' : 'ies'}</button>
      ${IP.showRemoved ? `<div class="card">${arc.map(d => `<div class="indrm-row"><b>${esc(d.name)}</b><span class="sub">${fmt(counts.get(d.id) || 0)} leads kept</span><button class="btn sm" data-indrestore="${d.id}">Restore</button></div>`).join('')}</div>` : ''}</div>` : ''}`;
}
function indRank(id) { const i = ST.industries.findIndex(x => x.id === id); return i < 0 ? 1e9 : i; }
/* drag to reorder industry cards (mouse and touch; long-press on phones) */
const indDrag = { justDropped: false };
document.addEventListener('pointerdown', e => {
  const card = e.target.closest('.indcard.inddrag');
  if (!card || e.button > 0 || e.target.closest('button, a, input, .menu')) return;
  Object.assign(indDrag, { card, x: e.clientX, y: e.clientY, started: false, armed: e.pointerType !== 'touch' });
  if (e.pointerType === 'touch') indDrag.timer = setTimeout(() => { indDrag.armed = true; card.classList.add('ind-lift'); }, 280);
});
document.addEventListener('pointermove', e => {
  const d = indDrag; if (!d.card) return;
  if (!d.started) {
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.armed) { if (dist > 8) { clearTimeout(d.timer); d.card = null; } return; }
    if (dist < 6) return;
    const r = d.card.getBoundingClientRect(), g = d.card.cloneNode(true);
    g.classList.add('ind-ghost'); g.style.width = r.width + 'px'; g.style.height = r.height + 'px'; document.body.appendChild(g);
    Object.assign(d, { started: true, ghost: g, offX: e.clientX - r.left, offY: e.clientY - r.top });
    d.card.classList.add('ind-placeholder'); d.card.classList.remove('ind-lift'); document.body.classList.add('dragging-notes');
  }
  e.preventDefault();
  d.ghost.style.transform = `translate(${e.clientX - d.offX}px, ${e.clientY - d.offY}px) rotate(1.5deg)`;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.indcard.inddrag');
  if (over && over !== d.card) { const r = over.getBoundingClientRect(); over.parentNode.insertBefore(d.card, e.clientX > r.left + r.width / 2 ? over.nextSibling : over); }
  const edge = 70; if (e.clientY < edge) scrollBy(0, -12); else if (e.clientY > innerHeight - edge) scrollBy(0, 12);
}, { passive: false });
document.addEventListener('pointerup', async () => {
  const d = indDrag; clearTimeout(d.timer); if (!d.card) return;
  d.card.classList.remove('ind-lift');
  if (!d.started) { d.card = null; return; }
  d.ghost.remove(); d.card.classList.remove('ind-placeholder'); document.body.classList.remove('dragging-notes'); d.card = null;
  d.justDropped = true; setTimeout(() => { d.justDropped = false; }, 60);
  const shown = [...document.querySelectorAll('.indcard[data-indid]')].map(x => +x.dataset.indid);
  const rest = ST.industries.filter(x => !shown.includes(x.id)).map(x => x.id);   // removed industries keep their place at the end
  const ids = [...shown, ...rest];
  ids.forEach((id, i) => { const x = ST.industries.find(y => y.id === id); if (x) x.position = i + 1; });
  ST.industries.sort(byPos); rerenderInd();
  try { await api('PUT', '/api/industries/order', { ids }); } catch (err) { toast(err.message, 'alert'); }
});
function rerenderInd() { const g = $('#indgrid'); if (g) g.innerHTML = industriesGrid(); }
let EDIT = null;
function indModal() {
  const e = EDIT, { cats } = industryStats();
  const found = e.id == null ? [] : [...(cats.get(e.id) || new Map()).entries()].filter(([c]) => !e.categories.some(x => x.toLowerCase() === c.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const tok = (k, ph) => `<div class="tok" data-tokbox="${k}">${e[k].map((t, i) => `<span class="term">${esc(t)}<button data-tokdel="${k}:${i}" aria-label="Remove ${esc(t)}">×</button></span>`).join('')}<input id="tok-${k}" data-tok="${k}" placeholder="${ph}" autocomplete="off"></div>`;
  $('#overlay').innerHTML = `<div class="scrim" data-act="close"><div class="drawer inddrawer" data-stop role="dialog" aria-label="${e.id == null ? 'Add industry' : 'Edit industry'}">
    <div class="drawer-h"><div><div class="eyebrow" style="margin:0 0 4px">${e.id == null ? 'New industry' : 'Edit industry'}</div><h2>${esc(e.name || 'Untitled')}</h2></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <section><label class="flabel" for="ind-name">Name</label><input class="input big" id="ind-name" value="${esc(e.name)}" placeholder="e.g. Fence Installers"></section>
    <section><span class="flabel">Search terms</span>${tok('terms', 'Type a term, press Enter')}<span class="help">Put the best term first. Searches start with the first two, so make the second one find different businesses (e.g. “roofer” then “roof repair”, tested on Google Maps).</span></section>
    <section><span class="flabel">Accepted Google categories</span>${tok('categories', 'Type a category, press Enter')}<span class="help">${e.categories.length ? 'Results in other categories go to “excluded”.' : 'Empty means every category is accepted.'}</span>
      ${found.length ? `<div class="catsug"><span class="flabel" style="font-size:11.5px">Found in your leads</span><div class="catsug-list">${found.map(([c, n]) => `<button class="catsug-btn" data-addcat="${esc(c)}">${ic('plus', 12)}${esc(c)}<span>${fmt(n)}</span></button>`).join('')}</div></div>` : ''}</section>
    <div id="ind-err" class="help" style="color:var(--bad);padding:0 20px"></div>
    <div class="drawer-foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="indsave">${e.id == null ? 'Add industry' : 'Save changes'}</button></div>
  </div></div>`;
  setTimeout(() => $(e.id == null ? '#ind-name' : '#tok-terms')?.focus(), 0);
}
async function saveIndustry() {
  const e = EDIT; e.name = $('#ind-name').value.trim();
  for (const k of ['terms', 'categories']) { const v = $('#tok-' + k).value.trim(); if (v) e[k].push(v); }
  try {
    const r = e.id == null ? await api('POST', '/api/industries', e) : await api('PUT', `/api/industries/${e.id}`, e);
    const i = ST.industries.findIndex(x => x.id === r.industry.id); if (i >= 0) ST.industries[i] = r.industry; else ST.industries.push(r.industry);
    ST.industries.sort(byPos);
    closeOverlay(); if ($('#indgrid')) rerenderInd(); else render(); toast(e.id == null ? `${r.industry.name} added` : 'Changes saved');
  } catch (err) { $('#ind-err').textContent = err.message; }
}

/* ================================================================ usage */
let USAGE = null, USAGE_ERR = '', SCORE = null;
V.usage = () => `
  <div class="head"><div><div class="eyebrow">Workspace</div><h1>Usage</h1><p>Cloudflare's free daily limits reset at 4:00 PM PT (midnight UTC). Numbers can lag a few minutes.</p></div>
    <button class="btn" data-act="usagerefresh">${ic('retry', 14)}Refresh</button></div>
  <div id="usage">${usageHTML()}</div>`;
MOUNT.usage = () => loadUsage();
async function loadUsage() {
  USAGE_ERR = '';
  const el = $('#usage'); if (el && !USAGE) el.innerHTML = usageHTML();
  const sc = api('GET', '/api/scorecard?days=7').then(r => { SCORE = r; }).catch(() => {});
  try { USAGE = await api('GET', '/api/usage'); } catch (e) { USAGE_ERR = e.message; }
  await sc;
  const e2 = $('#usage'); if (e2) e2.innerHTML = usageHTML();
}
function meter(label, used, limit, note) {
  const pct = limit ? Math.min(100, used / limit * 100) : 0;
  const tone = pct >= 85 ? 'bad' : pct >= 60 ? 'warn' : 'ok';
  return `<div class="um"><div class="um-top"><span>${label}</span><span class="num"><b>${fmt(Math.round(used))}</b> / ${fmt(limit)}</span></div>
    <div class="um-bar"><i style="width:${Math.max(pct, used ? 1.5 : 0)}%;background:var(--${tone})"></i></div><div class="um-sub"><span>${pct < 1 && used ? '<1' : Math.round(pct)}% used</span>${note ? `<span>${note}</span>` : ''}</div></div>`;
}
const mb = b => b == null ? '—' : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
/** Engine scorecard: each production target, pass or fail, over the last 7 days. */
function scoreCard() {
  if (!SCORE) return '';
  const d = SCORE.detail, tag = p => p === true ? '<span class="sc-tag ok">Pass</span>' : p === false ? '<span class="sc-tag bad">Fail</span>' : '<span class="sc-tag">Not measured</span>';
  const st = Object.entries(d.stages).filter(([, v]) => v.p50 != null);
  const label = { open: 'Open page', settle: 'Page settles', find: 'Find form', fill: 'Fill fields', submit: 'Submit and confirm' };
  return `<div class="card ucard sc"><div class="card-h"><div><h3>Engine scorecard</h3><p>Last 7 days · ${fmt(d.forms)} forms in ${fmt(d.outreach_jobs)} runs · ${fmt(d.runner_minutes)} runner minutes</p></div></div>
    <div class="card-b"><div class="sc-rows">${SCORE.lines.map(l => `<div class="sc-row"><span>${esc(l.label)}</span><b class="num">${l.value == null ? '—' : esc(String(l.value)) + (l.unit ? ' ' + esc(l.unit) : '')}</b>${tag(l.pass)}<small>${esc(l.note)}</small></div>`).join('')}</div>
    ${st.length ? `<div class="sc-stages"><h6>Where the time goes (typical / slowest 5%)</h6>${st.map(([k, v]) => `<div><span>${label[k] || k}</span><b class="num">${v.p50} s</b><small class="num">${v.p95} s</small></div>`).join('')}</div>` : ''}</div></div>`;
}
function usageHTML() {
  if (USAGE_ERR) return `<div class="banner">${ic('alert', 18)}<div><b>Couldn't load usage</b>${esc(USAGE_ERR)}</div></div>`;
  if (!USAGE) return `<div class="card card-b"><span class="spin"></span>&nbsp; Loading usage…</div>`;
  const u = USAGE, cf = u.cloudflare || {}, gh = u.github || {}, L = u.leads || {}, T = u.today || {}, lim = u.limits;
  const cfCard = cf.connected ? `<div class="card ucard"><div class="card-h"><div><h3>Cloudflare today</h3><p>Free plan · day ${esc(cf.day || '')} (UTC)</p></div></div><div class="card-b ugrid">
      ${cf.workerRequests != null ? meter('Worker requests', cf.workerRequests, lim.workerRequests, cf.workerErrors ? `${fmt(cf.workerErrors)} errors` : '') : ''}
      ${cf.d1RowsWritten != null ? meter('Database rows written', cf.d1RowsWritten, lim.d1RowsWritten) : ''}
      ${cf.d1RowsRead != null ? meter('Database rows read', cf.d1RowsRead, lim.d1RowsRead) : ''}
      ${cf.kvWrites != null ? meter('KV writes', cf.kvWrites, lim.kvWrites) : ''}
      ${cf.kvReads != null ? meter('KV reads', cf.kvReads, lim.kvReads) : ''}
      ${cf.errors && cf.errors.length ? `<div class="help" style="grid-column:1/-1;color:var(--warn)">Some numbers aren't available: ${esc(cf.errors.join('; '))}</div>` : ''}</div></div>`
    : `<div class="card ucard"><div class="card-h"><div><h3>Cloudflare today</h3><p>Live free-plan usage needs a read-only analytics token.</p></div></div><div class="card-b usetup">
      <ol><li>Open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">Cloudflare API tokens</a> → <b>Create Token</b> → <b>Create Custom Token</b>.</li>
      <li>Add the permission <b>Account → Account Analytics → Read</b>, choose your account, then create it and copy the token.</li>
      <li>Add it to GitHub as a secret named <code>CF_ANALYTICS_TOKEN</code>, then run <b>Deploy</b> again.</li></ol></div></div>`;
  const ghCard = gh.connected ? `<div class="card ucard"><div class="card-h"><div><h3>GitHub Actions this month</h3><p>Free and unlimited on a public repository</p></div></div><div class="card-b ustats">
      ${gh.error ? `<div class="help" style="color:var(--warn)">${esc(gh.error)}</div>` : `
      <div><b class="num">${fmt(gh.runner.runs)}</b><span>search and check jobs</span></div>
      <div><b class="num">${fmt(gh.runner.minutes)}</b><span>minutes of scraping</span></div>
      <div><b class="num">${fmt(gh.runner.today)}</b><span>jobs today</span></div>
      <div><b class="num">${fmt(gh.deploy.runs)}</b><span>deploys (${fmt(gh.deploy.minutes)} min)</span></div>`}</div></div>` : '';
  return `<div class="ulayout">
    ${scoreCard()}
    ${cfCard}
    <div class="card ucard"><div class="card-h"><div><h3>Storage</h3><p>Cloudflare D1 database</p></div></div><div class="card-b ugrid">
      ${u.storage.bytes != null ? meter('Database size', u.storage.bytes / 1048576, u.storage.limit / 1048576, `${mb(u.storage.bytes)} of 500 MB`).replace(/<b>[^<]*<\/b> \/ [^<]*<\/span>/, `<b>${mb(u.storage.bytes)}</b> / 500 MB</span>`) : '<div class="help">Size not reported yet.</div>'}
      <div class="um"><div class="um-top"><span>Leads in this browser</span><span class="num"><b>${fmt(ST.leads.length)}</b></span></div><div class="um-sub"><span>Filtering and export run here, using no Cloudflare quota.</span></div></div></div></div>
    <div class="card ucard"><div class="card-h"><div><h3>Activity</h3><p>Today means since midnight PT</p></div></div><div class="card-b ustats">
      <div><b class="num">${fmt(L.total)}</b><span>leads in total</span></div>
      <div><b class="num">${fmt(L.today)}</b><span>added today</span></div>
      <div><b class="num">${fmt(L.d7)}</b><span>added in 7 days</span></div>
      <div><b class="num">${fmt(L.d30)}</b><span>added in 30 days</span></div>
      <div><b class="num">${fmt(T.searches)}</b><span>searches today</span></div>
      <div><b class="num">${fmt(T.checked)}</b><span>websites checked today</span></div>
      <div><b class="num">${fmt(L.openForm)}</b><span>leads with an open form</span></div>
      <div><b class="num">${fmt(L.captcha)}</b><span>leads with a CAPTCHA form</span></div></div></div>
    ${ghCard}
    <p class="help">Updated ${whenPT(u.at)}.</p></div>`;
}

/* ================================================================ events */
document.addEventListener('click', async (e) => {
  const lp = e.target.closest('[data-pick]'); if (lp) { lmPick(+lp.dataset.pick); return; }
  if (L$.selMore && !e.target.closest('.selmore')) { L$.selMore = false; renderSel(); }
  const t = e.target, ds = k => t.closest(`[data-${k}]`)?.dataset[k];
  let v;
  if (t.closest('[data-act="close"]') && (!t.closest('[data-stop]') || t.closest('button[data-act="close"]'))) { closeOverlay(); return; }
  if (L$.openDD && !t.closest('.dd')) { L$.openDD = null; L$.ddq = ''; renderPanel(); }
  if (FS.open && !t.closest('#combo')) { FS.open = false; renderPop(); }
  if (FS.countryMenu && !t.closest('[data-fsx="cmenu"]') && !t.closest('.fx-cmenu')) { FS.countryMenu = false; render(); }
  if ((v = ds('fxsopen')) !== undefined) { e.stopPropagation(); fxsOpen(v); return; }
  if ((v = ds('fxsval')) !== undefined) { fxsSet(v, t.closest('[data-fxsval]').dataset.v); return; }
  if ((v = ds('fxscustom')) !== undefined) { const n = parseInt($('#fxs-num').value, 10); if (n > 0) fxsSet(v, n); return; }
  if (FX.open && !t.closest('.fxs')) fxsClose();
  if ((v = ds('web')) !== undefined) { FS.website = v; if (v === 'no') { FS.depth = 0; FS.emails = false; FS.form = 'any'; } if (v === 'any' && FS.form !== 'any') FS.form = 'any'; $('#fs-web').innerHTML = webHTML(); $('#fs-collect').innerHTML = collectHTML(); refreshFind([]); return; }
  if ((v = ds('keep')) !== undefined) { FS.form = v; if (v !== 'any' && FS.website !== 'yes') { FS.website = 'yes'; $('#fs-web').innerHTML = webHTML(); } $('#fs-collect').innerHTML = collectHTML(); refreshFind([]); return; }
  if ((v = ds('chk')) !== undefined) {
    if (v === 'site') { if (FS.depth === 2) { toast('The contact form check includes the website check', 'alert'); return; } FS.depth = FS.depth >= 1 ? 0 : 1; if (FS.depth === 0) FS.emails = false; }
    if (v === 'form') { FS.depth = FS.depth === 2 ? 1 : 2; if (FS.depth !== 2) FS.form = 'any'; }
    if (v === 'email') { FS.emails = !FS.emails; if (FS.emails && FS.depth === 0) FS.depth = 1; }
    $('#fs-collect').innerHTML = collectHTML(); refreshFind([]); return;
  }
  if ((v = ds('depthb')) !== undefined) { FS.depth = +v; if (FS.depth === 0) FS.emails = false; $('#fs-collect').innerHTML = collectHTML(); const em = $('#fs-emails'); if (em) em.checked = FS.emails; refreshFind([]); return; }
  if ((v = ds('copy')) !== undefined) { try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast('Copy blocked by the browser', 'alert'); } return; }
  if ((v = ds('sortcol')) !== undefined) { L$.sort = L$.sort === v ? 'reviews' : v; fxsRerender('sort'); leadsUpdate(false); $('#vt').scrollTop = 0; return; }
  if ((v = ds('fseg')) !== undefined) { const i = v.indexOf(':'), k = v.slice(0, i), val = v.slice(i + 1); L$.F[k] = k === 'add' ? +val : val; changed(); return; }
  if ((v = ds('dd')) !== undefined) { L$.openDD = L$.openDD === v ? null : v; L$.ddq = ''; renderPanel(); setTimeout(() => $('#ddq-' + v)?.focus(), 0); return; }
  if ((v = ds('ddonly')) !== undefined) { e.stopPropagation(); const [k, val] = v.split(':'); L$.F[k] = new Set([+val]); changed(); return; }
  if ((v = ds('ddopt')) !== undefined) { const [k, raw] = v.split(':'); const val = /^l\d+$/.test(raw) ? raw : +raw; const s = L$.F[k]; s.has(val) ? s.delete(val) : s.add(val); changed(); return; }
  if ((v = ds('ddclear')) !== undefined) { L$.F[v] = new Set(); changed(); return; }
  if ((v = ds('view')) !== undefined) { applyView(v); return; }
  if ((v = ds('viewdel')) !== undefined) { try { await api('DELETE', `/api/views/${v}`); ST.views = ST.views.filter(x => String(x.id) !== v); renderViews(); toast('View deleted'); } catch (err) { toast(err.message, 'alert'); } return; }
  if ((v = ds('lsel')) !== undefined) { e.stopPropagation(); const id = +v; L$.sel.has(id) ? L$.sel.delete(id) : L$.sel.add(id); renderSel(); renderRows(); return; }
  if ((v = ds('lead')) !== undefined) { leadDrawer(+v); return; }
  if ((v = ds('lnav')) !== undefined) { navDrawer(+v); return; }
  if ((v = ds('lstat')) !== undefined) {
    const [lid, st] = v.split(':').map(Number), cur = ST.byId.get(lid);
    if (cur && cur.status === st) return;
    if (cur && cur.status === 1 && st === 0) { toast('This lead is in a campaign. Open the campaign and remove it there to set it back to New.', 'alert'); return; }
    saveLead(lid, { status: st }, () => { toast(st === 4 ? 'Marked replied. Follow-ups for this lead are stopped.' : st === 3 ? 'Marked do not contact. Unsent campaign messages are skipped.' : st === 2 && cur?.status === 1 ? 'Marked contacted. Unsent campaign messages are skipped.' : 'Status saved'); if (DRAWER_ID === lid) leadDrawer(lid); });
    return;
  }
  if ((v = ds('xpreset')) !== undefined) { XP.preset = v; XP.cols = new Set(XPRESETS[v]); exportModal(); return; }
  if ((v = ds('xscopebtn')) !== undefined) { XP.scope = v; exportModal(); return; }
  if ((v = ds('xcustom')) !== undefined) { XP.custom = !XP.custom; exportModal(); return; }
  if ((v = ds('xfmt')) !== undefined) { XP.fmt = v; saveXP(); exportModal(); return; }
  if ((v = ds('xact')) !== undefined) { doExport(v); return; }
  if ((v = ds('ckgo')) !== undefined) { startCheck(v.split(',').map(Number)); return; }
  if ((v = ds('excl')) !== undefined) { excludedModal(+v); return; }
  if ((v = ds('acceptcat')) !== undefined) {
    const indId = +t.closest('[data-ind]').dataset.ind;
    try { const r = await api('POST', `/api/industries/${indId}/categories`, { category: v }); const i = ST.industries.findIndex(x => x.id === indId); if (i >= 0) ST.industries[i] = r.industry; t.closest('button').outerHTML = '<span class="pill c-ok">Accepted</span>'; } catch (err) { toast(err.message, 'alert'); }
    return;
  }
  if ((v = ds('menu')) !== undefined) { e.stopPropagation(); OPENMENU = OPENMENU === +v ? null : +v; renderJobs(); return; }
  if (OPENMENU !== null && !t.closest('.menu')) { OPENMENU = null; renderJobs(); }
  if ((v = ds('jact')) !== undefined) {
    const id = +t.closest('[data-id]').dataset.id, j = ST.searches.find(x => x.id === id);
    OPENMENU = null;
    if (v === 'delete') {
      $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Delete search"><div class="card-h"><div><h2>Delete “${esc(j.name)}”?</h2></div></div><div class="card-b"><p style="margin:0">It's removed from Search history.${j.new ? ` The <b>${fmt(j.new)} leads</b> it found stay in Leads.` : ''}</p></div>
        <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-jdel="${id}" style="background:var(--bad);border-color:var(--bad);color:#fff">${ic('trash', 14)}Delete</button></div></div></div>`;
      return;
    }
    if (v === 'view') { L$.F = defaultF(); L$.F.src = new Set([id]); L$.view = null; location.hash = '#leads'; }
    else if (v === 'export') openExport('search', id);
    else if (v === 'again') loadIntoForm(j);
    else if (v === 'cancel' || v === 'retry') {
      try { const r = await api('POST', `/api/searches/${id}/${v}`); upsertSearch(r.search); renderJobs(); if (v === 'retry') { toast('Search restarted'); startPolling(); } else toast('Search cancelled. Leads found so far were kept'); }
      catch (err) { toast(err.message, 'alert'); if (err.status === 502) refreshSearches(); }
    }
    return;
  }
  if ((v = ds('jdel')) !== undefined) {
    const id = +v, j = ST.searches.find(x => x.id === id);
    try { await api('DELETE', `/api/searches/${id}`); ST.hiddenNames[id] = j?.name; ST.searches = ST.searches.filter(x => x.id !== id); closeOverlay(); renderJobs(); toast('Search deleted'); }
    catch (err) { toast(err.message, 'alert'); }
    return;
  }
  if ((v = ds('indmenu')) !== undefined) { e.stopPropagation(); IP.menu = IP.menu === +v ? null : +v; rerenderInd(); return; }
  if (IP.menu !== null && !t.closest('.menu')) { IP.menu = null; rerenderInd(); }
  if ((v = ds('indsort')) !== undefined) { IP.sort = v; document.querySelectorAll('[data-indsort]').forEach(b => { b.classList.toggle('on', b.dataset.indsort === v); b.setAttribute('aria-checked', b.dataset.indsort === v); }); rerenderInd(); return; }
  if ((v = ds('indfind')) !== undefined) { const d = ST.industries.find(x => x.id === +v); FS.ind = d.id; FS.terms = defaultTerms(d); FS.extra = []; location.hash = '#find'; return; }
  if ((v = ds('indleads')) !== undefined) { L$.F = defaultF(); L$.F.ind = new Set([+v]); L$.view = null; location.hash = '#leads'; return; }
  if ((v = ds('addcat')) !== undefined) { EDIT.name = $('#ind-name').value; for (const k of ['terms', 'categories']) { const x = $('#tok-' + k)?.value.trim(); if (x) EDIT[k].push(x); } EDIT.categories.push(v); indModal(); return; }
  if ((v = ds('indedit')) !== undefined) { IP.menu = null; const d = ST.industries.find(x => x.id === +v); EDIT = { id: d.id, orig: d.name, name: d.name, terms: [...d.terms], categories: [...d.categories] }; indModal(); return; }
  if ((v = ds('indrm')) !== undefined) {
    const d = ST.industries.find(x => x.id === +v), n = ST.leads.filter(L => L.industry_id === d.id).length;
    $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop><div class="card-h"><div><h2>Remove ${esc(d.name)}?</h2></div></div><div class="card-b"><p style="margin:0">It won't appear in Find leads anymore. Its <b>${fmt(n)} leads</b> stay in your workspace with the same label, and you can restore it later.</p></div>
      <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-indrmok="${d.id}" style="background:var(--bad);border-color:var(--bad);color:#fff">Remove industry</button></div></div></div>`;
    return;
  }
  if ((v = ds('indrmok')) !== undefined || (v = ds('indrestore')) !== undefined) {
    const restore = t.closest('[data-indrestore]'), id = +v;
    try { await api(restore ? 'POST' : 'DELETE', restore ? `/api/industries/${id}/restore` : `/api/industries/${id}`); ST.industries.find(x => x.id === id).archived = !restore; closeOverlay(); if ($('#indgrid')) rerenderInd(); else render(); toast(restore ? 'Industry restored' : 'Industry removed'); } catch (err) { toast(err.message, 'alert'); }
    return;
  }
  if ((v = ds('tokdel')) !== undefined) { const [k, i] = v.split(':'); EDIT.name = $('#ind-name').value; EDIT[k].splice(+i, 1); indModal(); return; }
  if (t.closest('[data-tokbox]') && !t.closest('button')) t.closest('[data-tokbox]').querySelector('input')?.focus();
  if ((v = ds('limit')) !== undefined) { FS.limit = +v; $('#fs-limit').value = FS.limit || ''; document.querySelectorAll('[data-limit]').forEach(b => b.classList.toggle('on', +b.dataset.limit === FS.limit)); refreshFind([]); return; }
  const term = t.closest('[data-fsterm]'); if (term) { const i = +term.dataset.fsterm; FS.terms.has(i) ? FS.terms.delete(i) : FS.terms.add(i); refreshFind(['what']); return; }
  if ((v = ds('fsextra')) !== undefined) { FS.extra.splice(+v, 1); refreshFind(['what']); return; }
  if (t.id === 'fs-loc') { FS.open = true; renderPop(); return; }
  if ((v = ds('fsx')) !== undefined) {
    const b = t.closest('[data-fsx]');
    switch (v) {
      case 'terms': FS.showTerms = !FS.showTerms; refreshFind(['what']); if (FS.showTerms) setTimeout(() => $('#fs-extra')?.focus(), 0); break;
      case 'cmenu': FS.countryMenu = !FS.countryMenu; render(); break;
      case 'country': FS.country = b.dataset.c; FS.countryMenu = false; FS.q = ''; FS.hi = 0; render(); setTimeout(() => { $('#fs-loc').focus(); FS.open = true; renderPop(); }, 0); break;
      case 'name': FS.editName = true; $('#fs-sum').innerHTML = sumHTML(); setTimeout(() => { const i = $('#fs-name'); if (i) { i.focus(); i.select(); } }, 0); break;
      case 'addloc': { const it = FS.items[+b.dataset.li]; if (it && addLoc(it)) { FS.q = ''; $('#fs-loc').value = ''; FS.hi = 0; refreshFind(['where']); renderPop(); $('#fs-loc').focus(); } break; }
      case 'rmloc': FS.locs.splice(+b.dataset.i, 1); refreshFind(['where']); break;
      case 'clearlocs': FS.locs = []; refreshFind(['where']); break;
      case 'pastetoggle': FS.paste = !FS.paste; FS.pasteMsg = ''; render(); setTimeout(() => $('#fs-paste')?.focus(), 0); break;
      case 'pasteapply': pasteApply(); break;
      case 'resetname': FS.nameEdited = false; FS.name = ''; $('#fs-name').value = autoName(); refreshFind([]); break;
      case 'start': startSearch(); break;
    }
    return;
  }
  const a = ds('act'); if (!a) return;
  switch (a) {
    case 'logout':
      $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Sign out" style="width:min(400px,100%)">
        <div class="card-h"><div><h2>Sign out?</h2><p>You'll need the app password to sign back in. Campaigns keep sending on schedule while you're signed out.</p></div></div>
        <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close" autofocus>Stay signed in</button><button class="btn primary" data-act="logoutok">${ic('logout', 14)}Sign out</button></div></div></div>`;
      setTimeout(() => document.querySelector('[data-act="logoutok"]')?.focus(), 0);
      break;
    case 'logoutok': closeOverlay(); await api('POST', '/api/logout').catch(() => {}); showLogin(); break;
    case 'theme': { const n = effectiveTheme() === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('lh-theme', n); } catch { /* ignore */ } applyTheme(n); break; }
    case 'sync': sync({ quiet: false }); break;
    case 'reset': L$.F = defaultF(); L$.view = null; if ($('#lq')) $('#lq').value = ''; leadsUpdate(); break;
    case 'fopen': L$.fopen = !L$.fopen; $('#lf-panel').classList.toggle('open', L$.fopen); break;
    case 'selall': { const allIn = L$.res.length && L$.res.every(l => L$.sel.has(l.id)); if (allIn && t.closest('#cb-all')) L$.sel.clear(); else L$.res.forEach(l => L$.sel.add(l.id)); renderSel(); renderRows(); break; }
    case 'clearsel': L$.sel.clear(); renderSel(); renderRows(); break;
    case 'export': openExport(L$.sel.size ? 'sel' : 'view'); break;
    case 'checkmodal': checkModal([...L$.sel]); break;
    case 'addcamp': addToCampaign([...L$.sel]); break;
    case 'addlist': listModal([...L$.sel]); break;
    case 'selmore': L$.selMore = !L$.selMore; renderSel(); break;
    case 'managelists': L$.openDD = null; renderPanel(); listModal([]); break;
    case 'listedit': { LM.editing = +t.closest('[data-lid]').dataset.lid; listModal(LM.ids); setTimeout(() => { const i = $('#lm-edit'); if (i) { i.focus(); i.select(); } }, 0); break; }
    case 'listeditcancel': LM.editing = null; listModal(LM.ids); break;
    case 'listeditsave': listRename(); break;
    case 'listdelask': LM.deleting = +t.closest('[data-lid]').dataset.lid; listModal(LM.ids); break;
    case 'listdelno': LM.deleting = null; listModal(LM.ids); break;
    case 'rmlist': {
      const lid = +String([...L$.F.src][0]).slice(1), ids = [...L$.sel];
      try { await api('POST', `/api/lists/${lid}/leads`, { ids, remove: true }); ids.forEach(id => ST.leadLists.get(id)?.delete(lid)); L$.sel.clear(); toast(`Removed ${fmt(ids.length)} from “${listName('l' + lid)}”`); loadLists(); } catch (err) { toast(err.message, 'alert'); }
      break;
    }
    case 'listgo': listSave(); break;
    case 'listcreate': { const name = $('#lm-name').value.trim(); if (!name) { $('#lm-err').textContent = 'Give the list a name.'; break; } try { await api('POST', '/api/lists', { name }); await loadLists(); listModal([]); toast(`Created “${name}”`); } catch (err) { $('#lm-err').textContent = err.message; } break; }
    case 'listdel': {
      const lid = +t.closest('[data-lid]').dataset.lid, l = ST.lists.find(x => x.id === lid);
      try { await api('DELETE', `/api/lists/${lid}`); L$.F.src.delete('l' + lid); LM.deleting = null; toast(`Deleted “${l.name}”. Its leads are still in Leads.`); await loadLists(); listModal(LM.ids); } catch (err) { toast(err.message, 'alert'); }
      break;
    }
    case 'checkone': checkModal([+t.closest('[data-id]').dataset.id]); break;
    case 'bdelask': {
      const n = L$.sel.size; L$.selMore = false;
      $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop role="dialog" aria-label="Delete leads">
        <div class="card-h"><div><h2>Delete ${fmt(n)} lead${n === 1 ? '' : 's'}?</h2><p>They're removed from your leads, lists and any campaign items not yet sent. What was already sent stays in the campaign history. This can't be undone, though a new search that finds the same business adds it back.</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
        <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn danger" data-act="bdel">${ic('trash', 14)}Delete ${fmt(n)} lead${n === 1 ? '' : 's'}</button></div></div></div>`;
      break;
    }
    case 'bdel': {
      const ids = [...L$.sel];
      try { await api('POST', '/api/leads/delete', { ids }); closeOverlay(); L$.sel.clear(); await sync(); toast(`${fmt(ids.length)} lead${ids.length === 1 ? '' : 's'} deleted`, 'trash'); } catch (err) { toast(err.message, 'alert'); }
      break;
    }
    case 'bdnc': {
      const ids = [...L$.sel];
      try { await api('POST', '/api/leads/bulk', { ids, status: 3 }); toast(`${fmt(ids.length)} leads marked do not contact`, 'shield'); L$.sel.clear(); await sync(); } catch (err) { toast(err.message, 'alert'); }
      break;
    }
    case 'saveview':
      $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal" data-stop><div class="card-h"><div><h2>Save view</h2><p>${esc(summaryParts().join(' · ') || 'All leads')}</p></div></div><div class="card-b"><div class="field"><label for="vname">Name</label><input class="input" id="vname" placeholder="e.g. Florida painters, 4.5+"></div><div id="verr" class="help" style="color:var(--bad)"></div></div><div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end"><button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="saveviewok">Save view</button></div></div></div>`;
      setTimeout(() => $('#vname').focus(), 0); break;
    case 'saveviewok': {
      const F = L$.F, d = defaultF(), f = {};
      for (const k of Object.keys(d)) { if (F[k] instanceof Set) { if (F[k].size) f[k] = [...F[k]]; } else if (F[k] !== d[k] && k !== 'q') f[k] = F[k] === Infinity ? 'inf' : F[k]; }
      for (const k of ['loc']) if (f[k]) f[k + 'Names'] = f[k].map(i => LOCS[i]);
      try { const r = await api('POST', '/api/views', { name: $('#vname').value.trim(), filters: f }); ST.views.push(r.view); L$.view = r.view.id; closeOverlay(); renderViews(); toast('View saved'); } catch (err) { $('#verr').textContent = err.message; }
      break;
    }
    case 'refreshjobs': refreshSearches(); break;
    case 'usagerefresh': loadUsage(); break;
    case 'allhist': FS.allHist = !FS.allHist; renderJobs(); break;
    case 'indnew': EDIT = { id: null, name: IP.q.trim() && !ST.industries.some(d => d.name.toLowerCase() === IP.q.trim().toLowerCase()) ? IP.q.trim() : '', terms: [], categories: [] }; indModal(); break;
    case 'indshowrm': IP.showRemoved = !IP.showRemoved; rerenderInd(); break;
    case 'indsave': saveIndustry(); break;
  }
});
/* Add to list */
const LM = { ids: [], pick: null, editing: null, deleting: null };
function listModal(ids) {
  LM.ids = ids; const manage = !ids.length;
  if (LM.pick !== 'new' && !ST.lists.some(l => l.id === LM.pick)) LM.pick = ST.lists[0]?.id ?? 'new';
  const row = l => {
    if (LM.editing === l.id) return `<div class="lmrow editing" data-lid="${l.id}"><input class="input" id="lm-edit" value="${esc(l.name)}" maxlength="80" aria-label="List name"><button class="btn sm primary" data-act="listeditsave">Save</button><button class="btn sm ghost" data-act="listeditcancel">Cancel</button></div>`;
    if (LM.deleting === l.id) return `<div class="lmrow deleting" data-lid="${l.id}"><span>Delete <b>${esc(l.name)}</b>? Its ${fmt(l.count)} lead${l.count === 1 ? '' : 's'} stay in Leads.</span><button class="btn sm danger-solid" data-act="listdel" data-confirm="1">Delete</button><button class="btn sm ghost" data-act="listdelno">Keep</button></div>`;
    return `<div class="lmrow ${!manage && LM.pick === l.id ? 'on' : ''}" data-lid="${l.id}">${manage ? `<span class="lmdot"></span>` : `<input type="radio" name="lmpick" value="${l.id}" ${LM.pick === l.id ? 'checked' : ''} aria-label="${esc(l.name)}">`}
      <label class="lmname" ${manage ? '' : `data-pick="${l.id}"`}><b>${esc(l.name)}</b><span>${fmt(l.count)} lead${l.count === 1 ? '' : 's'}</span></label>
      <button class="iconbtn sm" data-act="listedit" title="Rename" aria-label="Rename ${esc(l.name)}">${ic('edit', 13)}</button><button class="iconbtn sm lmtrash" data-act="listdelask" title="Delete" aria-label="Delete ${esc(l.name)}">${ic('trash', 13)}</button></div>`;
  };
  $('#overlay').innerHTML = `<div class="scrim modal-scrim" data-act="close"><div class="modal lmodal" data-stop role="dialog" aria-label="${manage ? 'Your lists' : 'Add to list'}">
    <div class="card-h"><div><h2>${manage ? 'Your lists' : `Add ${fmt(ids.length)} lead${ids.length === 1 ? '' : 's'} to a list`}</h2><p>${manage ? 'Rename or delete lists. Deleting a list never deletes its leads.' : 'Pick a list or start a new one. Every search is also a list automatically.'}</p></div><button class="btn ghost sm" data-act="close" aria-label="Close">${ic('x')}</button></div>
    <div class="card-b lmbody">
      ${ST.lists.length ? `<div class="lmlist">${ST.lists.map(row).join('')}</div>` : `<p class="help" style="margin:0">No lists yet.</p>`}
      <div class="lmnew ${!manage && LM.pick === 'new' ? 'on' : ''}">${manage ? '' : `<input type="radio" name="lmpick" value="new" ${LM.pick === 'new' ? 'checked' : ''} aria-label="New list">`}<input class="input" id="lm-name" placeholder="${manage ? 'New list name' : 'Or create a new list…'}" autocomplete="off" maxlength="80">${manage ? `<button class="btn sm" data-act="listcreate">${ic('plus', 13)}Create</button>` : ''}</div>
      <div class="help" id="lm-err" style="color:var(--bad)"></div></div>
    <div class="card-h" style="border-top:1px solid var(--line);border-bottom:0;justify-content:flex-end">${manage ? `<button class="btn" data-act="close">Done</button>` : `<button class="btn" data-act="close">Cancel</button><button class="btn primary" data-act="listgo">${ic('plus', 14)}Add to list</button>`}</div></div></div>`;
}
function lmPick(v, focus = true) {
  LM.pick = v;
  document.querySelectorAll('[name="lmpick"]').forEach(r => { r.checked = r.value === String(v); });
  document.querySelectorAll('.lmrow').forEach(r => r.classList.toggle('on', +r.dataset.lid === v));
  document.querySelector('.lmnew')?.classList.toggle('on', v === 'new');
  if (v === 'new' && focus) $('#lm-name')?.focus();
}
async function listRename() {
  const name = $('#lm-edit').value.trim(); if (!name) return;
  try { await api('PUT', `/api/lists/${LM.editing}`, { name }); LM.editing = null; await loadLists(); listModal(LM.ids); toast('List renamed'); } catch (e) { $('#lm-err').textContent = e.message; }
}
async function listSave() {
  const btn = document.querySelector('[data-act="listgo"]'); btn.disabled = true;
  try {
    let lid = LM.pick;
    if (lid === 'new') { const name = $('#lm-name').value.trim(); if (!name) { $('#lm-err').textContent = 'Give the list a name.'; btn.disabled = false; return; } lid = (await api('POST', '/api/lists', { name })).list.id; }
    await api('POST', `/api/lists/${lid}/leads`, { ids: LM.ids });
    closeOverlay(); L$.sel.clear(); await loadLists();
    toast(`Added ${fmt(LM.ids.length)} to “${listName('l' + lid)}”`);
  } catch (e) { $('#lm-err').textContent = e.message; btn.disabled = false; }
}
function applyView(id) {
  L$.F = defaultF(); L$.view = id === 'all' ? 'all' : +id;
  const v = ST.views.find(x => x.id === +id);
  if (v) {
    const f = typeof v.filters === 'string' ? JSON.parse(v.filters) : v.filters;
    for (const [k, val] of Object.entries(f)) {
      if (k.endsWith('Names')) continue;
      if (k === 'loc') { L$.F.loc = new Set((f.locNames || []).map(n => LOC_IDX.get(n)).filter(i => i !== undefined)); continue; }
      L$.F[k] = Array.isArray(val) ? new Set(val) : val === 'inf' ? Infinity : val;
    }
  }
  if ($('#lq')) $('#lq').value = L$.F.q;
  leadsUpdate(); $('#vt').scrollTop = 0; renderViews();
}
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.id === 'lm-edit' && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); e.stopPropagation(); if (e.key === 'Enter') listRename(); else { LM.editing = null; listModal(LM.ids); } return; }
  if (t.id === 'lm-name' && e.key === 'Enter') { e.preventDefault(); document.querySelector(LM.ids.length ? '[data-act="listgo"]' : '[data-act="listcreate"]')?.click(); return; }
  if (t.dataset && t.dataset.tok && (e.key === 'Enter' || e.key === ',')) { e.preventDefault(); const v = t.value.trim(); if (!v) return; EDIT.name = $('#ind-name').value; EDIT[t.dataset.tok].push(v); const k = t.dataset.tok; indModal(); setTimeout(() => $('#tok-' + k)?.focus(), 0); return; }
  if (t.dataset && t.dataset.tok && e.key === 'Backspace' && !t.value && EDIT[t.dataset.tok].length) { EDIT.name = $('#ind-name').value; EDIT[t.dataset.tok].pop(); const k = t.dataset.tok; indModal(); setTimeout(() => $('#tok-' + k)?.focus(), 0); return; }
  if (t.classList && (t.classList.contains('dd-opt') || t.classList.contains('termrow')) && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); t.click(); return; }
  if (t.id === 'fs-loc') {
    const n = FS.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); FS.open = true; FS.hi = Math.min(n - 1, FS.hi + 1); renderPop(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); FS.hi = Math.max(0, FS.hi - 1); renderPop(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = FS.items[FS.hi]; if (FS.open && it && addLoc(it)) { FS.q = ''; t.value = ''; FS.hi = 0; refreshFind(['where']); renderPop(); } }
    else if (e.key === 'Escape') { FS.open = false; renderPop(); }
    else if (e.key === 'Backspace' && !t.value && FS.locs.length) { FS.locs.pop(); refreshFind(['where']); }
    return;
  }
  if (FX.open && (t.id === 'fxs-q' || t.closest?.('.fxs'))) {
    const opts = [...document.querySelectorAll(`[data-fxs="${FX.open}"] .fxs-opt`)];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); FX.hi = Math.max(0, Math.min(opts.length - 1, FX.hi + (e.key === 'ArrowDown' ? 1 : -1))); opts.forEach((o, i) => o.classList.toggle('hi', i === FX.hi)); opts[FX.hi]?.scrollIntoView({ block: 'nearest' }); if (t.id !== 'fxs-q') opts[FX.hi]?.focus(); return; }
    if (e.key === 'Enter' && t.id === 'fxs-q') { e.preventDefault(); const o = opts[FX.hi]; if (o) fxsSet(FX.open, o.dataset.v); return; }
    if (e.key === 'Enter' && t.id === 'fxs-num') { e.preventDefault(); const n = parseInt(t.value, 10); if (n > 0) fxsSet(FX.open, n); return; }
    if (e.key === 'Escape') { e.preventDefault(); const id = FX.open; fxsClose(); document.querySelector(`[data-fxs="${id}"] .fxs-btn`)?.focus(); return; }
  }
  if (t.id === 'fs-name' && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); FS.editName = false; t.blur(); $('#fs-sum').innerHTML = sumHTML(); return; }
  if (t.id === 'fs-extra' && e.key === 'Enter') { e.preventDefault(); const v = t.value.trim(); if (v && !activeTerms().includes(v)) { FS.extra.push(v); refreshFind(['what']); setTimeout(() => $('#fs-extra')?.focus(), 0); } return; }
  if (document.querySelector('.ld') && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k')) { e.preventDefault(); navDrawer(e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1); return; }
  if (e.key === 'Escape') { if (L$.openDD) { L$.openDD = null; renderPanel(); } else closeOverlay(); }
});
let noteTimer = 0;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'lq') { L$.F.q = t.value; changed(); return; }
  if (t.id === 'lm-name' && LM.ids.length && LM.pick !== 'new') { lmPick('new', false); return; }
  if (t.id === 'ind-q') { IP.q = t.value; rerenderInd(); return; }
  if (t.id === 'ind-name' && $('.inddrawer h2')) { $('.inddrawer h2').textContent = t.value || 'Untitled'; }
  if (t.id && t.id.startsWith('ddq-')) { L$.ddq = t.value; renderPanel(); return; }
  if (t.id === 'fs-loc') { FS.q = t.value; FS.hi = 0; FS.open = true; renderPop(); return; }
  if (t.id === 'fxs-q') { FX.q = t.value; FX.hi = 0; const id = FX.open; const pos = t.selectionStart; fxsRerender(id); const n = $('#fxs-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
  if (t.id === 'fs-name') { FS.name = t.value; FS.nameEdited = !!t.value.trim(); return; }
  if (t.id === 'fs-rmin' || t.id === 'fs-rmax') { const v = t.value === '' ? null : Math.max(0, parseInt(t.value, 10) || 0); if (t.id === 'fs-rmin') FS.minRev = v || 0; else FS.maxRev = v; refreshFind([]); return; }
  if (t.id === 'fs-limit') { const v = parseInt(t.value, 10); FS.limit = v > 0 ? v : 0; refreshFind([]); return; }
  if (t.dataset.lnote) { clearTimeout(noteTimer); $('#dnote-h').textContent = 'Saving…'; noteTimer = setTimeout(() => saveLead(+t.dataset.lnote, { notes: t.value }, () => { const h = $('#dnote-h'); if (h) h.textContent = 'Saved.'; }), 700); return; }
  if (t.dataset.rng) {
    const k = t.dataset.rng, F = L$.F; let v = +t.value;
    if (k === 'rMin') { F.rMin = Math.min(v, F.rMax); t.value = F.rMin; $('#n-rMin').value = F.rMin.toFixed(1); }
    if (k === 'rMax') { F.rMax = Math.max(v, F.rMin); t.value = F.rMax; $('#n-rMax').value = F.rMax.toFixed(1); }
    if (k === 'vMin') { const b = rvIdxMax(F.vMax); v = Math.min(v, b - 1); t.value = v; F.vMin = RV_STOPS[v]; $('#n-vMin').value = F.vMin; }
    if (k === 'vMax') { const a = rvIdxMin(F.vMin); v = Math.max(v, a + 1); t.value = v; F.vMax = v === 9 ? Infinity : RV_STOPS[v] - 1; $('#n-vMax').value = F.vMax === Infinity ? '' : F.vMax; }
    const fr = $('#fill-rt'); if (fr) { fr.style.left = ((F.rMin - 1) / 4 * 100) + '%'; fr.style.right = (100 - (F.rMax - 1) / 4 * 100) + '%'; }
    const fv = $('#fill-rv'); if (fv) { fv.style.left = (rvIdxMin(F.vMin) / 9 * 100) + '%'; fv.style.right = (100 - rvIdxMax(F.vMax) / 9 * 100) + '%'; }
    changed(false);
  }
});
document.addEventListener('focusout', (e) => { if (e.target.id === 'fs-name' && FS.editName) { FS.editName = false; setTimeout(() => { const sm = $('#fs-sum'); if (sm) sm.innerHTML = sumHTML(); }, 0); } });
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.rng) { renderPanel(); return; }
  if (t.dataset.num) {
    const k = t.dataset.num, F = L$.F, v = t.value === '' ? null : +t.value;
    if (k === 'rMin') F.rMin = Math.max(1, Math.min(v ?? 1, F.rMax)); if (k === 'rMax') F.rMax = Math.min(5, Math.max(v ?? 5, F.rMin));
    if (k === 'vMin') F.vMin = Math.max(0, Math.min(v ?? 0, F.vMax)); if (k === 'vMax') F.vMax = v == null ? Infinity : Math.max(v, F.vMin);
    changed(); return;
  }
  if (t.dataset.fsel) { const k = t.dataset.fsel; L$.F[k] = k === 'add' ? +t.value : t.value; changed(); return; }
  if (t.dataset.fchk) { L$.F[t.dataset.fchk] = t.checked; changed(); return; }
  if (t.id === 'lsort') { L$.sort = t.value; leadsUpdate(false); $('#vt').scrollTop = 0; return; }
  if (t.dataset.lstatus) { saveLead(+t.dataset.lstatus, { status: +t.value }, () => toast('Status saved')); return; }
  if (t.dataset.xopt) { XP[t.dataset.xopt] = t.checked; exportModal(); return; }
  if (t.dataset.xcol) { t.checked ? XP.cols.add(t.dataset.xcol) : XP.cols.delete(t.dataset.xcol); XP.preset = Object.entries(XPRESETS).find(([, a]) => a.length === XP.cols.size && a.every(c => XP.cols.has(c)))?.[0] || 'custom'; exportModal(); return; }
  if (t.name === 'lmpick') { lmPick(t.value === 'new' ? 'new' : +t.value); return; }
  if (t.dataset.ck) { CK[t.dataset.ck] = t.checked; t.closest('.opt').classList.toggle('on', t.checked); return; }
  if (t.id === 'fs-ind') { FS.ind = +t.value; FS.terms = defaultTerms(curInd()); FS.extra = []; refreshFind(['what']); return; }
  if (t.dataset.depth != null) { FS.depth = +t.dataset.depth; if (FS.depth === 0) FS.emails = false; $('#fs-collect').innerHTML = collectHTML(); refreshFind([]); return; }
  if (t.id === 'fs-emails') { FS.emails = t.checked; if (FS.emails && FS.depth === 0) FS.depth = 1; $('#fs-collect').innerHTML = collectHTML(); refreshFind([]); return; }
  if (t.dataset.locrad != null) { FS.locs[+t.dataset.locrad].rad = +t.value; refreshFind(['where']); return; }
});
async function saveLead(id, patch, done) {
  try {
    const r = await api('PATCH', `/api/leads/${id}`, patch);
    applyRows(r.cols, [r.row]); saveCacheSoon(); bc && bc.postMessage('changed');
    if ($('#vt')) leadsUpdate();
    done && done();
  } catch (err) { toast(err.message, 'alert'); }
}

/* ================================================================ boot */
async function boot() {
  let data;
  try { data = await api('GET', '/api/bootstrap'); } catch (e) { if (e.status !== 401) $('#root').innerHTML = `<div class="boot"><div class="banner">${ic('alert', 18)}<div><b>LeadsHunter could not load</b>${esc(e.message)} <button class="linkbtn" onclick="location.reload()">Try again</button></div></div></div>`; return; }
  ST.industries = data.industries; ST.searches = data.searches; ST.leads = visibleLeads(); ST.hiddenNames = data.hiddenNames || {}; ST.config = data.config; ST.cols = data.cols;
  try { ST.views = (await api('GET', '/api/views')).views; } catch { ST.views = []; }
  shell(); render();
  loadOutreach(); loadLists();
  await initLeads();
  if (ST.searches.some(ACTIVE)) startPolling();
  setInterval(() => { if (!document.hidden && !pollTimer) sync(); }, 60000);
}
installSelects();
installOutreach({
  $, esc, fmt, ic, api, toast, closeOverlay, whenPT, ST, V, MOUNT, TITLES, CRUMBS, NAV_ACTIVE, render, renderNav, sync: () => sync(),
  openLead: (id) => { if (ST.byId.has(id)) leadDrawer(id); else toast('This lead is no longer in your list.', 'alert'); },
  currentView: () => CURRENT_VIEW, currentArg: () => CURRENT_ARG, clearSelection: () => { L$.sel.clear(); if ($('#vt')) { renderSel(); renderRows(); } },
});
boot();

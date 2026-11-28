// Holds the fill data per tab (so forms inside iframes can get it too) and talks to LeadsHunter (no CORS limits here).
const S = chrome.storage.session;
const key = (t, k) => `${k}:${t}`;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tab = sender.tab && sender.tab.id;
  (async () => {
    if (msg.type === 'setPayload') { await S.set({ [key(tab, 'p')]: msg.payload }); return reply({ ok: true }); }
    if (msg.type === 'getPayload') { const r = await S.get(key(tab, 'p')); return reply(r[key(tab, 'p')] || null); }
    if (msg.type === 'setPending') { await S.set({ [key(tab, 'pending')]: { ...msg.pending, until: Date.now() + 5 * 60e3 } }); return reply({ ok: true }); }
    if (msg.type === 'getPending') { const r = await S.get(key(tab, 'pending')); const p = r[key(tab, 'pending')]; return reply(p && p.until > Date.now() ? p : null); }
    if (msg.type === 'closeTab') { if (tab != null) chrome.tabs.remove(tab); return reply({ ok: true }); }
    if (msg.type === 'clearPending') { await S.remove([key(tab, 'pending'), key(tab, 'p')]); return reply({ ok: true }); }
    if (msg.type === 'markSent') {
      try {
        const res = await fetch(`${msg.api}/api/ext/sent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oid: msg.oid, token: msg.token, evidence: msg.evidence || '' }) });
        const j = await res.json().catch(() => ({}));
        return reply({ ok: res.ok, error: j.error });
      } catch (e) { return reply({ ok: false, error: 'LeadsHunter could not be reached.' }); }
    }
    reply(null);
  })();
  return true;
});
chrome.tabs.onRemoved.addListener(t => S.remove([key(t, 'p'), key(t, 'pending')]));

// Deletes every lead (same as selecting all and pressing Delete leads): browsers drop them on their next sync.
// Unsent campaign items, scheduled follow-ups and list memberships go too; sent history stays. Prints counts only.
const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (process.env.CONFIRM !== 'DELETE ALL LEADS') { console.log('Not confirmed: type DELETE ALL LEADS to run.'); process.exit(1); }
const cf = async (path, body) => { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!j.success) throw new Error(JSON.stringify(j.errors).slice(0, 300)); return j.result; };
const db = (await cf('/d1/database?name=leadshunter')).find(d => d.name === 'leadshunter');
const q = async (sql) => (await cf(`/d1/database/${db.uuid}/query`, { sql }))[0];
const before = (await q('SELECT COUNT(*) AS n FROM leads WHERE deleted = 0')).results[0].n;
const t = Date.now();
// New, unique sync numbers above the current counter so every browser sees the deletion.
await q(`UPDATE leads SET deleted = 1, seq = (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'seq') + id, updated_at = ${t} WHERE deleted = 0`);
await q("UPDATE meta SET v = CAST((SELECT MAX(seq) FROM leads) AS TEXT) WHERE k = 'seq' AND (SELECT MAX(seq) FROM leads) > CAST(v AS INTEGER)");
const out = await q("DELETE FROM outreach WHERE status IN ('queued','manual','failed','skipped')");
await q('UPDATE outreach SET next_at = NULL WHERE next_at IS NOT NULL');
await q('DELETE FROM list_leads');
const after = (await q('SELECT COUNT(*) AS n FROM leads WHERE deleted = 0')).results[0].n;
console.log(`Leads deleted: ${before} (left: ${after}). Unsent campaign items removed: ${out.meta?.changes ?? '?'}.`);

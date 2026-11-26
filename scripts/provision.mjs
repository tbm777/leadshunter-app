// Finds or creates the D1 database and KV namespace, then writes wrangler.toml. Runs in the deploy workflow.
import { readFileSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.CLOUDFLARE_API_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const REPO = process.env.GITHUB_REPOSITORY || process.env.GH_REPO || '';
if (!TOKEN || !ACCOUNT) { console.error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set as GitHub secrets.'); process.exit(1); }

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = (data.errors || []).map(e => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API ${method} ${path} failed: ${msg}. Check the token permissions (Workers Scripts, D1 and Workers KV Storage: Edit).`);
  }
  return data.result;
}

const dbs = await cf('GET', '/d1/database?name=leadshunter&per_page=50');
let db = (dbs || []).find(d => d.name === 'leadshunter');
if (!db) { db = await cf('POST', '/d1/database', { name: 'leadshunter' }); console.log('Created D1 database leadshunter'); }
const kvs = await cf('GET', '/storage/kv/namespaces?per_page=100');
let kv = (kvs || []).find(k => k.title === 'leadshunter');
if (!kv) { kv = await cf('POST', '/storage/kv/namespaces', { title: 'leadshunter' }); console.log('Created KV namespace leadshunter'); }

const toml = readFileSync('wrangler.template.toml', 'utf8')
  .replace('__D1_ID__', db.uuid).replace('__KV_ID__', kv.id).replace('__GH_REPO__', REPO).replace('__CF_ACCOUNT__', ACCOUNT);
writeFileSync('wrangler.toml', toml);
console.log(`wrangler.toml ready (D1 ${db.uuid.slice(0, 8)}…, KV ${kv.id.slice(0, 8)}…, repo ${REPO || 'unknown'}).`);

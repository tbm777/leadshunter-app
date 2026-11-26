# LeadsHunter

Find local businesses on Google Maps (United States, Canada, Australia and the UAE), check their websites and contact forms, and keep them in a fast, filterable lead list.
Runs entirely on free plans: **Cloudflare Workers + D1 + KV** for the app and data, **GitHub Actions** (public repo) for scraping and website checks.

## How it works

```
Browser ──► Cloudflare Worker (API + app) ──► D1 (leads, searches) / KV (snapshot)
                    │  starts a job (workflow_dispatch)
                    ▼
            GitHub Actions runner ── gosom (fast mode, no browser) ──► Google Maps
                    │                └─ website + contact form checks (Playwright only when needed)
                    └─ posts results back to the Worker
```

- **Leads live in your browser** (IndexedDB) and sync by sequence number, so filtering 30k+ leads is instant and uses no Cloudflare quota.
- **Searches** split each area into a grid of map searches (dense cells split again) and stop at your “Leads wanted” limit.
- **Duplicates** are matched on Google place ID, website domain and phone number. Off-category results go to “Excluded”.
- **Jobs resume**: every map search is tracked, so a crashed or cancelled job continues where it stopped when you press Retry.
- All times are shown in Los Angeles time (PT). Cloudflare’s free daily limits reset at 4:00 PM PT.

## One-time setup

Add these **repository secrets** (Settings → Secrets and variables → Actions → New repository secret):

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → Custom. Permissions: *Account · Workers Scripts · Edit*, *Account · D1 · Edit*, *Account · Workers KV Storage · Edit*, *Account · Account Settings · Read*, *User · User Details · Read*. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → right sidebar “Account ID”. |
| `APP_PASSWORD` | The password you’ll use to sign in to the app. Use something long. |
| `RUNNER_SECRET` | Any long random string (e.g. from a password manager). Shared by the app and the runner. |
| `GH_TOKEN` | GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: only this repo. Permission: *Actions: Read and write*. Lets the app start search jobs. |

Then run **Actions → Deploy → Run workflow** (it also runs on every push to `main`). The first deploy creates the D1 database and KV namespace, downloads place data from GeoNames, and prints your app URL (`https://leadshunter.<your-subdomain>.workers.dev`).

> If this is a brand-new Cloudflare account, open **Workers & Pages** once in the dashboard so your `workers.dev` subdomain exists.

## Development

```bash
npm install
npm test                       # unit tests
cp wrangler.template.toml wrangler.toml   # fill in any IDs for local use
printf 'APP_PASSWORD=dev\nRUNNER_SECRET=dev-secret\n' > .dev.vars
npx wrangler d1 migrations apply leadshunter --local
npx wrangler dev
```

Run a job locally against the dev server: `LH_API=http://localhost:8787 RUNNER_SECRET=dev-secret JOB_ID=1 GMAPS_BIN=./gmaps node runner/run.mjs`.

Place data © [GeoNames](https://www.geonames.org), CC BY 4.0.

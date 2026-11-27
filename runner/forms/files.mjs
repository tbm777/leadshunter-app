// Branded files for forms that require an upload. Each campaign picks a template (default: The Bat Marketing).
// PDF → both pages. Image-only forms → page 1 (subject + message) as PNG/JPG. Plain text when only .txt is allowed.
import fs from 'node:fs';
import * as bat from '../../public/shared/templates/bat-marketing.js';

const TYPES = { woff2: 'font/woff2', webp: 'image/webp', png: 'image/png' };
let DATA = null;
const dataAssets = (tpl) => (DATA ||= Object.fromEntries(Object.entries(tpl.ASSETS).map(([k, f]) => [k, `data:${TYPES[f.split('.').pop()]};base64,${fs.readFileSync(new URL(`../../public/templates/assets/${f}`, import.meta.url)).toString('base64')}`])));

const TEMPLATES = { 'bat-marketing': bat };

function wanted(accept) {
  const a = (accept || '').toLowerCase();
  if (!a || a.includes('*/*')) return 'pdf';
  if (a.includes('pdf')) return 'pdf';
  if (a.includes('image/') || /\.(png|jpe?g|gif|webp)/.test(a)) return /png|image\/\*/.test(a) ? 'png' : 'jpg';
  if (a.includes('text/plain') || a.includes('.txt')) return 'txt';
  if (/\.docx?|msword|officedocument/.test(a)) return null; // Word only: manual queue
  return 'pdf';
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Returns { name, mimeType, buffer } for Playwright's setInputFiles, or null if the type can't be produced. */
export async function brandedFile(context, accept, profile) {
  const kind = wanted(accept);
  if (!kind) return null;
  const tpl = TEMPLATES[profile.fileTemplate || 'bat-marketing'] || bat;
  const base = slug(profile.fileName || `${profile.company || 'introduction'} ${profile.leadCompany ? 'for ' + profile.leadCompany : ''}`) || 'introduction';
  if (kind === 'txt') return { name: `${base}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`${profile.subject || ''}\n\n${profile.message}\n`) };
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 816, height: 1056 });
    await page.setContent(tpl.render({ ...(profile.fileData || {}), subject: profile.subject, message: profile.message }, dataAssets(tpl)), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__fitted === true, null, { timeout: 8000 }).catch(() => {});
    if (kind === 'pdf') return { name: `${base}.pdf`, mimeType: 'application/pdf', buffer: await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true }) };
    const type = kind === 'jpg' ? 'jpeg' : 'png';
    return { name: `${base}.${kind}`, mimeType: `image/${type}`, buffer: await page.locator('.p1').screenshot({ type, ...(type === 'jpeg' ? { quality: 88 } : {}) }) };
  } finally { await page.close(); }
}

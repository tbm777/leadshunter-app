// Branded files for forms that require an upload: a PDF of the message, or an image when only images are accepted.
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

function wanted(accept) {
  const a = (accept || '').toLowerCase();
  if (!a || a.includes('*/*')) return 'pdf';
  if (a.includes('pdf') || a.includes('application/')) return 'pdf';
  if (a.includes('image/') || /\.(png|jpe?g|gif|webp)/.test(a)) return /png/.test(a) || a.includes('image/') ? 'png' : 'jpg';
  if (a.includes('text/plain') || a.includes('.txt')) return 'txt';
  if (/\.docx?|msword|officedocument/.test(a)) return 'pdf-fallback';
  return 'pdf';
}

function html(profile) {
  const brand = esc(profile.company || `${profile.firstName} ${profile.lastName}`);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;margin:0;color:#14161b}
    .bar{background:${profile.brandColor || '#EE6420'};color:#fff;padding:28px 40px}
    .bar b{font-size:22px;display:block}.bar span{opacity:.9;font-size:13px}
    .body{padding:32px 40px;font-size:14px;line-height:1.6;white-space:pre-wrap}
    h1{font-size:18px;margin:0 0 14px}.foot{padding:0 40px 28px;color:#5f6674;font-size:12px}
  </style></head><body>
    <div class="bar"><b>${brand}</b><span>${esc(profile.website || '')}${profile.phone ? ' · ' + esc(profile.phone) : ''}${profile.email ? ' · ' + esc(profile.email) : ''}</span></div>
    <div class="body"><h1>${esc(profile.subject || 'Introduction')}</h1>${esc(profile.message)}</div>
    <div class="foot">${esc(profile.firstName)} ${esc(profile.lastName)} · ${brand}</div>
  </body></html>`;
}

/** Returns { name, mimeType, buffer } for Playwright's setInputFiles, or null if the type can't be produced. */
export async function brandedFile(context, accept, profile) {
  const kind = wanted(accept);
  const base = (profile.company || 'introduction').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'introduction';
  if (kind === 'txt') return { name: `${base}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`${profile.subject || ''}\n\n${profile.message}\n\n${profile.firstName} ${profile.lastName}\n${profile.company || ''}\n${profile.phone || ''}\n${profile.email || ''}`) };
  if (kind === 'pdf-fallback') return null; // .doc/.docx only: send to the manual queue
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 900, height: kind === 'pdf' ? 1100 : 360 });
    await page.setContent(html(profile), { waitUntil: 'load' });
    if (kind === 'pdf') return { name: `${base}.pdf`, mimeType: 'application/pdf', buffer: await page.pdf({ format: 'Letter', printBackground: true }) };
    const type = kind === 'jpg' ? 'jpeg' : 'png';
    return { name: `${base}.${kind}`, mimeType: `image/${type}`, buffer: await page.screenshot({ type, fullPage: true }) };
  } finally { await page.close(); }
}

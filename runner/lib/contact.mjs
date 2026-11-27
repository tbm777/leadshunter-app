// Same-site links that look like a contact or quote page, most likely first (shared by the website check and the robot).
const CONTACT_RE = /contact|get[\s-]?in[\s-]?touch|quote|estimate|appointment|book|request|reach[\s-]?us|consult|schedule/i;
const norm = u => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return null; } };
/** Links on the page that look like a contact or quote page, same site only. */
export async function contactPages(page, base) {
  const host = new URL(base).hostname.replace(/^www\./, '');
  const links = await page.$$eval('a[href]', as => as.map(a => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 60) }))).catch(() => []);
  const out = [];
  for (const l of links) {
    let u; try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host) continue;
    if (!CONTACT_RE.test(l.text) && !CONTACT_RE.test(u.pathname)) continue;
    const n = norm(u.href); if (n && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => (/contact/i.test(b) ? 1 : 0) - (/contact/i.test(a) ? 1 : 0)).slice(0, 3);
}


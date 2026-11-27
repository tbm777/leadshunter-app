// "The Bat Marketing" outreach file. Page 1: the campaign's subject and message. Page 2: the offer.
import fs from 'node:fs';

const asset = (f, type) => `data:${type};base64,${fs.readFileSync(new URL(`./assets/${f}`, import.meta.url)).toString('base64')}`;
let A = null;
const assets = () => (A ||= {
  r: asset('dmsans-400.woff2', 'font/woff2'), m: asset('dmsans-500.woff2', 'font/woff2'), b: asset('dmsans-700.woff2', 'font/woff2'), mascot: asset('bat-mascot.webp', 'image/webp'),
});
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const DEFAULTS = {
  brand: 'THE BAT MARKETING', tagline: 'Marketing growth systems for contractors', website: 'thebatmarketing.com', bookUrl: 'https://thebatmarketing.com',
  offerKicker: 'WHAT YOU GET', offerTitle: 'Get found. Get reviews.\nNever miss a lead.',
  features: [
    ['Missed-call text-back', 'Every missed caller gets an instant text, so they wait for you instead of calling someone else.'],
    ['Website chat to text', 'Visitor questions arrive on your phone as texts you can answer in seconds.'],
    ['More Google reviews', 'Automatic review requests after each job, with gentle follow-ups.'],
    ['Old leads brought back', 'Revive past estimates and past customers who never booked.'],
    ['A site built to convert', 'A contractor website designed to start conversations, not just sit there.'],
    ['One simple dashboard', 'Chats, texts, reviews and follow-ups in one place. We handle setup and support.'],
  ],
  ctaKicker: 'READY WHEN YOU ARE', ctaTitle: "Let's talk for 15 minutes.", ctaText: 'One package: $297/month, all inclusive.\nNo long-term contract. No pressure.', ctaButton: 'Book a Call',
};

// Message → paragraphs. A trailing sign-off ("Best,\nDustin\nThe Bat Marketing") gets the name in bold and the company in grey.
function messageHTML(message) {
  const paras = String(message || '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  const last = paras[paras.length - 1] || '';
  const lines = last.split('\n').map(s => s.trim()).filter(Boolean);
  let sign = '';
  if (/^(best|thanks|thank you|cheers|regards|kind regards|best regards|sincerely|talk soon|warmly)\b.{0,15}$/i.test(lines[0] || '') && lines.length <= 4) {
    paras.pop();
    sign = `<p class="sign">${esc(lines[0])}${lines[1] ? `<br><b>${esc(lines[1])}</b>` : ''}${lines.slice(2).map(l => `<br><span>${esc(l)}</span>`).join('')}</p>`;
  } else if (paras.length && /\n/.test(last)) {
    // "Best,\nDustin" glued to the last paragraph without a blank line
    const ls = last.split('\n'); const i = ls.findIndex(l => /^(best|thanks|cheers|regards|sincerely|talk soon)\b/i.test(l.trim()));
    if (i > 0 && ls.length - i <= 4) { paras[paras.length - 1] = ls.slice(0, i).join('\n'); const s = ls.slice(i).map(x => x.trim()); sign = `<p class="sign">${esc(s[0])}${s[1] ? `<br><b>${esc(s[1])}</b>` : ''}${s.slice(2).map(l => `<br><span>${esc(l)}</span>`).join('')}</p>`; }
  }
  return paras.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') + sign;
}

export function render(data) {
  const d = { ...DEFAULTS, ...data }, a = assets();
  const head = (n) => `<div class="top"><div><i class="bar"></i><b>${esc(d.brand)}</b></div><span>0${n} / 02</span></div>`;
  const foot = `<div class="foot"><span>${esc(d.tagline)}</span><a href="https://${esc(d.website.replace(/^https?:\/\//, ''))}">${esc(d.website.replace(/^https?:\/\//, ''))}</a></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:DM;font-weight:400;src:url(${a.r}) format('woff2')}
  @font-face{font-family:DM;font-weight:500;src:url(${a.m}) format('woff2')}
  @font-face{font-family:DM;font-weight:700;src:url(${a.b}) format('woff2')}
  @page{size:Letter;margin:0}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:#FAF9F6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:DM,Helvetica,Arial,sans-serif;color:#111214}
  .page{width:816px;height:1056px;padding:86px 86px 0;position:relative;overflow:hidden;page-break-after:always;background:#FAF9F6}
  .page:last-child{page-break-after:auto}
  .top{display:flex;justify-content:space-between;align-items:flex-end;font-size:13.5px}
  .top b{display:block;font-weight:700;letter-spacing:.01em}.top span{color:#6b6e75}
  .bar{display:block;width:29px;height:4px;background:#F2B807;margin-bottom:12px}
  .kicker{font-size:11px;color:#55585f;letter-spacing:.02em;margin-top:84px;text-transform:uppercase}
  h1{font-weight:700;font-size:38px;line-height:1.2;letter-spacing:-.02em;margin-top:6px;max-width:500px}
  .rule{width:53px;height:4px;background:#F2B807;margin:22px 0 30px}
  .msg{font-size:15.4px;line-height:1.67;color:#16171a}.msg p{margin-bottom:15px}
  .sign b{font-weight:700}.sign span{color:#72757c}
  .foot{position:absolute;left:86px;right:86px;bottom:76px;border-top:1px solid #e3e1db;padding-top:9px;display:flex;justify-content:space-between;font-size:11.5px;color:#6b6e75}
  .foot a{color:#6b6e75;text-decoration:none}
  .p2 h1{max-width:none;margin-bottom:40px}
  .grid{display:grid;grid-template-columns:1fr 1fr;column-gap:48px}
  .feat{display:flex;gap:16px;border-top:1px solid #e3e1db;padding:12px 0 18px;min-height:99px}
  .feat i{font-style:normal;color:#E0A800;font-weight:700;font-size:12px;flex:0 0 20px;padding-top:4px}
  .feat b{display:block;font-size:16.5px;font-weight:700;margin-bottom:3px}.feat p{font-size:13.6px;line-height:1.55;color:#5b5e65}
  .cta{position:relative;margin-top:44px;background:#0D0E11;border-radius:16px;height:236px;padding:36px 40px;color:#fff}
  .p2 .cta{position:absolute;left:86px;right:86px;top:691px;margin:0}
  .cta small{color:#F2B807;font-size:11px;letter-spacing:.02em}.cta h2{font-size:28.5px;font-weight:700;letter-spacing:-.02em;margin:6px 0 12px}
  .cta p{color:#c9cbd0;font-size:14px;line-height:1.6}
  .cta a{display:inline-flex;align-items:center;gap:8px;margin-top:16px;background:#F2B807;color:#111;font-weight:700;font-size:16.5px;padding:15px 58px;border-radius:30px;text-decoration:none}
  .cta img{position:absolute;right:14px;bottom:0;height:282px}
  </style></head><body>
  <section class="page p1">${head(1)}
    <div class="kicker">Subject</div><h1 id="subj">${esc(d.subject)}</h1><div class="rule"></div>
    <div class="msg" id="msg">${messageHTML(d.message)}</div>${foot}</section>
  <section class="page p2">${head(2)}
    <div class="kicker">${esc(d.offerKicker)}</div><h1>${esc(d.offerTitle).replace(/\n/g, '<br>')}</h1>
    <div class="grid">${d.features.map(([t, p], i) => `<div class="feat"><i>0${i + 1}</i><div><b>${esc(t)}</b><p>${esc(p)}</p></div></div>`).join('')}</div>
    <div class="cta"><small>${esc(d.ctaKicker)}</small><h2>${esc(d.ctaTitle)}</h2><p>${esc(d.ctaText).replace(/\n/g, '<br>')}</p>
      <a href="${esc(d.bookUrl)}">${esc(d.ctaButton)} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      <img src="${a.mascot}" alt=""></div>${foot}</section>
  </body></html>`;
}

// Long subjects or messages: shrink type until page 1 fits above the footer.
export async function fit(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const p = document.querySelector('.p1'), msg = document.getElementById('msg'), h = document.getElementById('subj'), foot = p.querySelector('.foot');
    const over = () => msg.getBoundingClientRect().bottom > foot.getBoundingClientRect().top - 24;
    let hs = 38, ms = 15.4;
    while (h.getBoundingClientRect().height > 140 && hs > 26) { hs -= 2; h.style.fontSize = hs + 'px'; }
    while (over() && ms > 11) { ms -= 0.4; msg.style.fontSize = ms + 'px'; }
    if (over()) { msg.style.lineHeight = '1.45'; }
  });
}

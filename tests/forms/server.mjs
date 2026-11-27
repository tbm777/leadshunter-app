// Fixture server: serves the test forms and validates every submission like a strict backend.
import http from 'node:http';
import { FIXTURES, byId, isEmail } from './fixtures.mjs';

function add(obj, k, v) { if (k in obj) obj[k] = [].concat(obj[k], v); else obj[k] = v; }
function parseMultipart(buf, boundary) {
  const fields = {}, files = {};
  const b = Buffer.from('--' + boundary);
  let pos = buf.indexOf(b);
  while (pos !== -1) {
    pos += b.length;
    if (buf.slice(pos, pos + 2).toString() === '--') break;
    pos += 2;
    const headEnd = buf.indexOf('\r\n\r\n', pos);
    if (headEnd === -1) break;
    const head = buf.slice(pos, headEnd).toString();
    const next = buf.indexOf(b, headEnd);
    const body = buf.slice(headEnd + 4, next - 2);
    const name = /name="([^"]*)"/.exec(head)?.[1];
    const fn = /filename="([^"]*)"/.exec(head)?.[1];
    if (fn !== undefined) { if (fn) files[name] = { filename: fn, data: body, type: /content-type:\s*(.*)/i.exec(head)?.[1]?.trim() }; }
    else add(fields, name, body.toString());
    pos = next;
  }
  return { fields, files };
}
async function readBody(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks), ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) return parseMultipart(buf, /boundary=(.+)$/.exec(ct)[1]);
  if (ct.includes('json')) return { fields: JSON.parse(buf.toString() || '{}'), files: {} };
  const fields = {}; for (const [k, v] of new URLSearchParams(buf.toString())) add(fields, k, v);
  return { fields, files: {} };
}

const isPdf = d => d.slice(0, 4).toString() === '%PDF';
const isPng = d => d.slice(1, 4).toString() === 'PNG';
const isJpg = d => d[0] === 0xff && d[1] === 0xd8;

function validate(fx, b, files) {
  const errs = [];
  for (const k of fx.req || []) { const v = b[k]; if (v === undefined || (Array.isArray(v) ? !v.length : String(v).trim() === '')) errs.push({ field: k, message: `This field is required: ${k}` }); }
  for (const k of fx.traps || []) if (b[k]) errs.push({ field: k, message: 'Spam trap filled', trap: true });
  for (const [k, v] of Object.entries(b)) if (/mail/.test(k) && v && !isEmail(v)) errs.push({ field: k, message: `Please enter a valid email address.` });
  for (const k of fx.files || []) {
    const f = files[k];
    if (!f || f.data.length < 300) errs.push({ field: k, message: 'Please attach a file.' });
    else if (fx.imageOnly ? !(isPng(f.data) || isJpg(f.data)) : !(isPdf(f.data) || isPng(f.data) || isJpg(f.data))) errs.push({ field: k, message: 'File type not allowed.' });
  }
  if (!errs.length && fx.check) { const m = fx.check(b); if (m) errs.push({ field: '', message: m }); }
  return errs;
}

export function startServer(port = 8899) {
  const results = {};
  const rec = (id) => (results[id] ||= { posts: 0, valid: 0, errors: [], trap: false, wrongForm: 0, data: null, files: [] });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/html') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    const parts = u.pathname.split('/').filter(Boolean);
    try {
      if (u.pathname === '/') return send(200, `<ul>${FIXTURES.map(f => `<li><a href="/f/${f.id}">${f.id}</a> — ${f.note}</li>`).join('')}</ul>`);
      if (u.pathname === '/__results') return send(200, JSON.stringify(results), 'application/json');
      if (u.pathname === '/__reset') { for (const k of Object.keys(results)) delete results[k]; return send(200, 'ok'); }
      if (parts[0] === 'f' && byId[parts[1]]) return send(200, byId[parts[1]].html().replace('<!--ERR-->', ''));
      if (parts[0] === 'embed' && byId[parts[1]]) return send(200, byId[parts[1]].inner().replace('<!--ERR-->', ''));
      if (parts[0] === 'thanks') return send(200, '<!doctype html><h1>Thank you!</h1><p>We received your request and will contact you within one business day.</p>');
      if (u.pathname === '/newsletter' || u.pathname === '/search') { const ref = (req.headers.referer || '').split('/').pop(); rec(ref).wrongForm++; return send(200, '<p>Thanks for subscribing!</p>'); }
      if (parts[0] === 'submit' && byId[parts[1]] && req.method === 'POST') {
        const fx = byId[parts[1]], r = rec(fx.id);
        const { fields, files } = await readBody(req);
        r.posts++; r.data = fields; r.files = Object.values(files).map(f => `${f.filename} (${f.type}, ${f.data.length} B)`);
        const errs = validate(fx, fields, files);
        if (errs.some(e => e.trap)) r.trap = true;
        if (!errs.length) r.valid++; else r.errors.push(errs.map(e => e.message).join('; '));
        const msg = errs.map(e => e.message).join(' ');
        if (fx.mode === 'json') return send(200, JSON.stringify(errs.length ? { ok: false, error: msg } : { ok: true }), 'application/json');
        if (fx.mode === 'cf7') return send(200, JSON.stringify(errs.length
          ? { status: 'validation_failed', message: 'One or more fields have an error. Please check and try again.', invalid_fields: errs.map(e => ({ field: e.field, message: e.field.includes('accept') ? 'You must accept the terms and conditions before sending your message.' : 'Please fill out this field.' })) }
          : { status: 'mail_sent', message: 'Thank you for your message. It has been sent.' }), 'application/json');
        if (errs.length) {
          const page = (fx.embed ? fx.inner() : fx.html()).replace('<!--ERR-->', `<div class="error" role="alert">${msg}</div>`);
          return send(200, page);
        }
        if (fx.mode === 'redirect') { res.writeHead(303, { location: `/thanks/${fx.id}` }); return res.end(); }
        return send(200, '<!doctype html><h1>Message sent</h1><p>Thank you for contacting us! We will get back to you shortly.</p>');
      }
      send(404, 'not found');
    } catch (e) { send(500, String(e.stack)); }
  });
  return new Promise(ok => server.listen(port, () => ok({ server, results, close: () => server.close() })));
}

if (import.meta.url === `file://${process.argv[1]}`) startServer(+process.argv[2] || 8899).then(() => console.log('Fixtures on http://localhost:8899'));

// Upload from the iPhone Share menu (an Apple Shortcut called "My Cookbook" posts each photo here).
//   POST /api/upload?taken=<ISO date taken>&kind=clipping|screenshot&by=<name>   body = the photo itself
// The photo joins the same "waiting to be read" inbox as uploads from the app.
// Add &test=1 to see what would happen without saving anything.

const SB = 'https://bgrbnocjdndsrovckias.supabase.co';
const KEY = 'sb_publishable_5UJAoO1FFtZeTJ7NR7n5Qw_wqJWHsdC';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const BATCH_MAX = 30;
const MAX_BYTES = 4.4 * 1024 * 1024; // Vercel's limit for one request

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (buf.length) return buf;
  return Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
}

// What kind of file this is, and its size in pixels (JPEG/PNG), without any libraries.
function inspect(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off++; continue; }
      const marker = buf[off + 1], size = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'image/jpeg', ext: 'jpg', height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
      }
      off += 2 + size;
    }
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.slice(1, 4).toString() === 'PNG') return { type: 'image/png', ext: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.slice(4, 12).toString().startsWith('ftyphei') || buf.slice(4, 12).toString().startsWith('ftypmif')) return { type: 'image/heic', ext: 'heic' };
  if (buf.slice(0, 4).toString() === '%PDF') return { type: 'application/pdf', ext: 'pdf' };
  return null;
}

async function sb(path, opts = {}) {
  const r = await fetch(`${SB}${path}`, { ...opts, headers: { ...H, ...(opts.headers ?? {}) } });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  if (req.method !== 'POST') return res.status(405).send('Send the photo with POST.');
  const q = req.query;
  const buf = await readBody(req);
  if (!buf.length) return res.status(400).send('No photo was received.');
  if (buf.length > MAX_BYTES) return res.status(413).send('That photo is too big. In the shortcut, resize it (longest edge 2800) before uploading.');
  const info = inspect(buf);
  if (!info) return res.status(415).send('That file isn\'t a photo or PDF.');

  // Screenshots are tall (phone screen shape) or PNG; paper clippings are normal camera photos.
  const tall = info.width && info.height && Math.max(info.width, info.height) / Math.min(info.width, info.height) >= 2;
  const kind = q.kind === 'screenshot' || q.kind === 'clipping' ? q.kind : (info.type === 'image/png' || tall ? 'screenshot' : 'clipping');
  const takenRaw = String(q.taken ?? '').trim().replace(/ (\d\d:?\d\d)$/, '+$1'); // a '+' in a link can arrive as a space
  const taken = takenRaw && !Number.isNaN(Date.parse(takenRaw)) ? new Date(takenRaw).toISOString() : null;

  const rows = await sb('/rest/v1/uploads?select=batch,taken_at,processed_at');
  if (!rows.ok) return res.status(502).send('The cookbook\'s storage didn\'t answer. Try again in a minute.');
  if (taken && rows.json.some((u) => u.taken_at && new Date(u.taken_at).getTime() === new Date(taken).getTime())) {
    return res.status(200).send('Already uploaded before, skipped.');
  }

  // Join the newest batch that's still waiting and has room; otherwise start the next batch number.
  const counts = new Map();
  for (const u of rows.json) if (!u.processed_at) counts.set(u.batch, (counts.get(u.batch) ?? 0) + 1);
  const open = [...counts].filter(([, n]) => n < BATCH_MAX).map(([b]) => b).sort().pop();
  const used = (await sb('/rest/v1/batches?select=name')).json;
  const names = [...(Array.isArray(used) ? used : []).map((b) => b.name), ...rows.json.map((u) => u.batch)];
  const next = Math.max(0, ...names.map((n) => Number(String(n).match(/(\d+)/)?.[1] ?? 0))) + 1;
  const batch = open ?? `Batch ${String(next).padStart(2, '0')}`;
  const position = (counts.get(batch) ?? 0) + 1;
  const path = `inbox/${batch.toLowerCase().replace(/\s+/g, '-')}/${String(position).padStart(3, '0')}-${Date.now()}${kind === 'screenshot' ? '-shot' : ''}.${info.ext}`;

  if (q.test) return res.status(200).send(`Test only, nothing saved: would add a ${kind} (${info.type}, ${info.width ?? '?'}×${info.height ?? '?'}) to ${batch} as photo ${position}.`);

  const up = await sb(`/storage/v1/object/photos/${path}`, { method: 'POST', headers: { 'Content-Type': info.type }, body: buf });
  if (!up.ok) return res.status(502).send('Couldn\'t save the photo. Try again in a minute.');
  const row = await sb('/rest/v1/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch, path, file_name: `Shared from Photos (${kind})`, size_bytes: buf.length, taken_at: taken, position, uploaded_by: q.by || 'iPhone Share menu' }),
  });
  if (!row.ok) return res.status(502).send('Couldn\'t record the photo. Try again in a minute.');
  return res.status(200).send(`Added to ${batch} (${kind === 'screenshot' ? 'screenshot' : 'clipping'}).`);
}

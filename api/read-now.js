// "Read now" button: starts the Claude routine that reads uploaded clipping photos, if the 4-digit code is right.
// Secrets live in Vercel's environment variables (never in this repository):
//   READ_NOW_PIN          the owner's 4-digit code
//   CLAUDE_ROUTINE_URL    the routine's API trigger URL (…/routines/trig_…/fire)
//   CLAUDE_ROUTINE_TOKEN  the routine's API trigger token
import { timingSafeEqual } from 'node:crypto';

const SB = 'https://bgrbnocjdndsrovckias.supabase.co';
const KEY = 'sb_publishable_5UJAoO1FFtZeTJ7NR7n5Qw_wqJWHsdC';
const SB_HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const RUN_MARKERS = 'inbox/_runs';
const BUSY_MINUTES = 60;

function sameCode(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ status: 'post_only' });
  const { READ_NOW_PIN, CLAUDE_ROUTINE_URL, CLAUDE_ROUTINE_TOKEN } = process.env;
  if (!READ_NOW_PIN || !CLAUDE_ROUTINE_URL || !CLAUDE_ROUTINE_TOKEN) return res.status(503).json({ status: 'not_set_up' });

  await new Promise((r) => setTimeout(r, 1500)); // slows down anyone trying to guess the code
  if (!sameCode(req.body?.pin, READ_NOW_PIN)) return res.status(401).json({ status: 'wrong_code' });

  const waiting = await fetch(`${SB}/rest/v1/uploads?select=id&processed_at=is.null&limit=1`, { headers: SB_HEADERS }).then((r) => r.json());
  if (!Array.isArray(waiting) || !waiting.length) return res.status(200).json({ status: 'nothing_waiting' });

  // Don't start a second reader while one is already working (that could add recipes twice).
  const markers = await fetch(`${SB}/storage/v1/object/list/photos`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: RUN_MARKERS, limit: 100, sortBy: { column: 'name', order: 'desc' } }),
  }).then((r) => r.json());
  const newest = Math.max(0, ...(Array.isArray(markers) ? markers : []).map((m) => Number(String(m.name).split('-')[0]) || 0));
  if (Date.now() - newest < BUSY_MINUTES * 60 * 1000) return res.status(200).json({ status: 'already_running' });

  const marker = `${Date.now()}-app.txt`;
  await fetch(`${SB}/storage/v1/object/photos/${RUN_MARKERS}/${marker}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, 'Content-Type': 'text/plain' },
    body: 'started from the Read now button',
  });

  const fire = await fetch(CLAUDE_ROUTINE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CLAUDE_ROUTINE_TOKEN}`,
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: `Started from the app's Read now button. Run marker: ${marker}` }),
  });
  if (!fire.ok) {
    await fetch(`${SB}/storage/v1/object/photos`, { method: 'DELETE', headers: { ...SB_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [`${RUN_MARKERS}/${marker}`] }) });
    return res.status(502).json({ status: 'claude_refused', detail: (await fire.text()).slice(0, 300) });
  }
  return res.status(200).json({ status: 'started' });
}

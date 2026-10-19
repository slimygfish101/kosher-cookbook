// Runs once a day (see vercel.json) so the free Supabase project never sleeps from inactivity.
export default async function handler(req, res) {
  const r = await fetch('https://bgrbnocjdndsrovckias.supabase.co/rest/v1/labels?select=id&limit=1', {
    headers: { apikey: 'sb_publishable_5UJAoO1FFtZeTJ7NR7n5Qw_wqJWHsdC' },
  });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, at: new Date().toISOString() });
}

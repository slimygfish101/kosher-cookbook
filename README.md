# Family Kosher Cookbook

Live site: https://kosher-cookbook.vercel.app (short link: https://tinyurl.com/lipascookbook)

A plain HTML/JavaScript web app (no build step) hosted on Vercel's free plan.
Recipes, labels and notes live in a free Supabase database; shrunk photos live in Supabase storage;
full-size original photos stay in Google Drive.

- `index.html`, `src/` – the app (`app.js` views and actions, `scale.js` servings scaling, `config.js` sections and connection).
- `api/keepalive.js` + `vercel.json` – a daily visit so the free Supabase project never pauses.
- `supabase/` – database setup scripts (run once in Supabase's SQL Editor).
- `tools/`, `batches/`, `BATCHES.md` – how photo batches are read, and which batches are done.

Adding user accounts later: Supabase Auth is built in. Turn it on, then tighten the policies in
`supabase/schema.sql` (they are all named `family_*`) and fill the existing `created_by` / `updated_by` columns.

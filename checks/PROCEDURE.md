# Nightly accuracy check — procedure

Goal: re-check every recipe that was read from photos against its original photo — title, every ingredient,
every amount and unit, every step, servings, section and Meat/Dairy/Pareve — and fix confirmed misreads.

## Rules
- Only recipes with `source` = `'photo'` or `'screenshot'` and `deleted_at is null` that have NO progress marker yet.
  Progress markers live in Supabase storage, one small file per checked recipe: `photos/checks/<recipe id>.json`
  (`{checked_at, fixes, by}`). List them with `POST <URL>/storage/v1/object/list/photos` and body
  `{"prefix":"checks","limit":1000}`. Scheduled sessions cannot push to GitHub, so progress never depends on GitHub.
- Never change the `original` column, never delete anything, never touch labels, notes, or typed-in recipes.
- A fix is only applied when a second, independent look at the photo confirms it. Every update is
  automatically saved in `recipe_history`, so it can be undone.
- If something is truly unreadable, set `needs_help = true` with a plain-language `needs_help_reason`
  (it then shows on the app's "needs my help" list) instead of guessing.
- Family members may have used the app's Fix button. If a saved value differs from the photo but matches a
  deliberate family edit (see `recipe_history` — any change made after the batch was read), leave it alone.

## Steps
1. Supabase: URL and publishable key are in `src/config.js` (REST at `/rest/v1/`). List candidate recipes.
   If there are none, append "nothing new to check" to `checks/log.md`, commit, and stop.
2. For each candidate (screenshots too), download its original photo copies from Supabase storage: every path in `photo_images`
   (about 3000 px, best) or, if that list is empty, `page_image` (about 2400 px):
   `<SUPABASE_URL>/storage/v1/object/public/photos/<path>`.
   Cut it into 2–3 overlapping tiles of at most ~1568 px so small print is readable (Pillow in a scratchpad venv,
   never installed system-wide). If a line is still too small or blurry to be sure, do not guess — put it on the
   "needs my help" list. (Full-size originals are in Google Drive, `drive_page_ids`, if a session with the Drive
   connector is available.)
3. Run a multi-agent Workflow (keep it under ~10 agents per night):
   - Checker agents, about 4 recipes each: read the photo tiles from scratch, transcribe the recipe, then compare with the
     saved recipe JSON and return a list of differences (field, saved value, value on the photo, confidence).
   - For each difference, a verifier agent looks at the photo again and confirms or rejects it.
4. Apply confirmed fixes with PATCH requests (ingredients are `[{group, text}]`, steps are a list of strings).
5. After every group of recipes: upload a marker `photos/checks/<recipe id>.json` for each recipe checked (fixes listed
   in it). Saving progress often means that if usage runs out mid-run, the next run simply continues where this one
   stopped. Put the plain-language result in the run's final summary (e.g. "Checked 8 recipes, 130 ingredients: fixed
   ⅓→½ cup sugar in X; 1 needs help"). If the session can push to GitHub, also append it to `checks/log.md`; if the push
   is refused, skip that — never work around it.

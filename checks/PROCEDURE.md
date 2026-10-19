# Nightly accuracy check — procedure

Goal: re-check every recipe that was read from photos against its original photo — title, every ingredient,
every amount and unit, every step, servings, section and Meat/Dairy/Pareve — and fix confirmed misreads.

## Rules
- Only recipes with `source = 'photo'` and `deleted_at is null` that are NOT already listed in `checks/checked.json`.
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
2. For each candidate, download its photos (`drive_page_ids`) with the Google Drive connector
   (`download_file_content`; the result is saved to a file — decode the base64 `content`).
   Convert HEIC with pillow-heif (install it in a venv in the scratchpad, never system-wide); see `tools/convert.py`.
   Rotate upright and cut the recipe page into 2–3 overlapping tiles of at most ~1568 px so small print is readable.
3. Run a multi-agent Workflow (keep it under ~10 agents per night):
   - Checker agents, about 4 recipes each: read the photo tiles from scratch, transcribe the recipe, then compare with the
     saved recipe JSON and return a list of differences (field, saved value, value on the photo, confidence).
   - For each difference, a verifier agent looks at the photo again and confirms or rejects it.
4. Apply confirmed fixes with PATCH requests (ingredients are `[{group, text}]`, steps are a list of strings).
5. After every group of recipes: add their ids to `checks/checked.json` (`{id: {checked_at, fixes}}`), append a short
   entry to `checks/log.md` (e.g. "Checked 8 recipes, 130 ingredients: fixed ⅓→½ cup sugar in X; 1 needs help"),
   then commit and push to `main`. Saving progress often means that if usage runs out mid-run, the next night
   simply continues where this one stopped.

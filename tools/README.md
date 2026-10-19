# Batch tools

How a batch is read (run in the cloud workspace, never on the family computer).

Photos now arrive through the app's **Add clippings** page (Supabase `uploads` table + storage `photos/inbox/`).
A routine checks every night at about 2:20 AM (America/New_York); you can also do it any time the owner asks.

1. `python3 inbox.py list` – batches waiting. Oldest first. If nothing is waiting, stop.
   `python3 inbox.py fetch "Batch NN" <work dir>` – downloads the photos in the order they were taken as
   P001, P002… into `<work dir>/heic` and writes `ids.json`.
   (Batch 01 came from Google Drive instead: Drive connector `download_file_content`, ids.json = file name → Drive id.)
2. `convert.py <work dir>/heic <work dir>/view` (in a scratchpad venv with pillow + pillow-heif) – JPEGs in `full/` and
   smaller viewing copies in `view/`. Look at each photo; write `rotate.json` (stem → degrees counter-clockwise to make it
   upright), `spreads.json` (stems that are two-page magazine spreads) and, where the food picture isn't on the
   right-hand page of a spread, `crops.json` (stem → [left, top, right, bottom] fractions).
3. Read each recipe page; `add.py` appends the typed-out recipe to `recipes.json`. Anything unclear goes in `needs_help` or `help_items.json`.
4. `food.py` – crop the food picture; `web.py` – make shrunk page/food/thumb WebP copies.
5. `upload.py <batch dir> "Batch NN"` – upload pictures (page, food, thumb, and a ~3000 px copy of every original photo in
   `photo_images`), insert recipes and help items, record the batch. Safe to re-run: recipes already in that batch are skipped.
   Copy `recipes.json`, `help_items.json`, `ids.json` and the three settings files into `batches/batch-NN/` and update `BATCHES.md`.
   Then `python3 inbox.py finish "Batch NN" <work dir>` – checks every photo has its copy, marks the uploads as read and
   clears them out of the inbox. Never run `finish` before the recipes are safely saved.
6. After the batch is added, schedule a ONE-TIME accuracy check for 4:00 AM America/New_York that night
   (create_trigger with run_once_at, fresh session, model claude-sonnet-5-5 to save usage; prompt in `checks/CHECK_PROMPT.md`).
   The check follows `checks/PROCEDURE.md`. The owner wants it only after new recipes, not every night.

Sections (see `src/config.js`): Salads, Soups, Dairy Mains (fish too), Chicken Mains, Meat Mains, Sides, Desserts.
There is no Appetizers section: an appetizer goes in the section matching what it's made of (fish → Dairy Mains,
chicken → Chicken Mains, meat → Meat Mains, salad → Salads) and also gets the "Appetizers" label.
The database key for Salads is still `salads_appetizers` (only the name shown changed).

## "Read now" button
The app's Add clippings page has a code-protected **Read now** button. It calls `api/read-now.js` on Vercel, which checks
the 4-digit code and fires the "Read uploaded recipe photos" routine through its API trigger. The code and the routine's
URL/token live only in Vercel's environment variables (`READ_NOW_PIN`, `CLAUDE_ROUTINE_URL`, `CLAUDE_ROUTINE_TOKEN`).
Run markers in `photos/inbox/_runs/` (named `<ms timestamp>-app.txt` / `-night.txt`) stop two readers working at once.

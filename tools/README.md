# Batch tools

How a batch is read (run in the cloud workspace, never on the family computer).

Photos (and PDFs, links and pasted text) now arrive through the app's **Add clippings** page (Supabase `uploads` table + storage `photos/inbox/`).
A routine checks every night at about 2:20 AM (America/New_York); you can also do it any time the owner asks.

1. `python3 inbox.py list` – batches waiting. Oldest first. If nothing is waiting, stop.
   `python3 inbox.py fetch "Batch NN" <work dir>` – downloads the photos in the order they were taken as
   P001, P002… into `<work dir>/heic` and writes `ids.json`.
   (Batch 01 came from Google Drive instead: Drive connector `download_file_content`, ids.json = file name → Drive id.)
2. `convert.py <work dir>/heic <work dir>/view` (in a scratchpad venv with pillow + pillow-heif) – JPEGs in `full/` and
   smaller viewing copies in `view/`. Look at each photo; write `rotate.json` (stem → degrees counter-clockwise to make it
   upright), `spreads.json` (stems that are two-page magazine spreads) and, where the food picture isn't on the
   right-hand page of a spread, `crops.json` (stem → [left, top, right, bottom] fractions). In `recipes.json`,
   `food_photo` names the photo that shows the dish (null = no picture of the dish).
   `ids.json` gives each item a `kind`: `clipping`, `screenshot`, `pdf` or `item` (a link or pasted text).
   - **Screenshots** (`kind: screenshot`, uploaded with "-shot" in the name) are clear digital text: hand their reading
     to a **Sonnet subagent** (Agent tool, model "sonnet"), several screenshots of one recipe together (they are in the
     order taken/picked; consecutive screenshots of one recipe scrolled down belong together). If a screenshot shows the
     dish, crop it as the food picture (crops.json). Mark these recipes `"source_type": "screenshot"` (`source` stays the site/app name for the credit line).
     Paper clippings (`kind: clipping`) keep the careful reading by the main model.
   **Not every inbox item is a photo.** Items can also be:
   - **PDF** (`P00n.pdf`): run `pdftotext -layout`. If it has real text, use that text exactly (no reading errors) and
     render page 1 with `pdftoppm -r 150 -jpeg -singlefile` to `full/P00n.jpg` as the page copy. If it has no text
     (a scanned PDF), render every page to JPEGs and read them like photos.
   - **Link** (`P00n.json`, `{"kind":"link","url":…}`): a recipe page the app couldn't import by itself. Fetch it
     (WebFetch or curl), and save the recipe's main picture, if any, as `full/P00n.jpg` with crop `[0,0,1,1]`.
   - **Pasted text** (`P00n.json`, `{"kind":"text","text":…}`), sometimes followed by a photo item that is its picture.
   For link and pasted-text items, hand the formatting (text → title, ingredients, steps, servings, time) to a
   **Sonnet subagent** (Agent tool, model "sonnet") to save usage; review its result before adding it. Mark these
   recipes with `"source_type": "link"` or `"source_type": "text"` in `recipes.json`; `"photos"` lists only real photo stems.
3. Read each recipe page; `add.py` appends the typed-out recipe to `recipes.json`. Anything unclear goes in `needs_help` or `help_items.json`.
4. `food.py` – crop the food picture; `web.py` – make shrunk page/food/thumb WebP copies.
5. `upload.py <batch dir> "Batch NN"` – upload pictures (page, food, thumb, and a ~3000 px copy of every original photo in
   `photo_images`), insert recipes and help items, record the batch. Safe to re-run: recipes already in that batch are skipped.
   Copy `recipes.json`, `help_items.json`, `ids.json` and the three settings files into `batches/batch-NN/` and update `BATCHES.md`.
   Then `python3 inbox.py finish "Batch NN" <work dir>` – checks every photo has its copy, marks the uploads as read and
   clears them out of the inbox. Never run `finish` before the recipes are safely saved.
6. Accuracy check: the nightly "Read uploaded recipe photos" run checks every recipe that has no progress marker yet,
   following `checks/PROCEDURE.md`, with Sonnet subagents (Agent tool, model "sonnet") to save usage. Runs started by
   the Read now button only read; the check waits for the night. (Scheduled sessions can't push to GitHub: commit and
   push batch files when possible; if refused, skip — the Supabase `batches` table and recipes are the record.)

Sections (see `src/config.js`): Salads, Soups, Dairy Mains (fish too), Chicken Mains, Meat Mains, Sides, Desserts.
There is no Appetizers section: an appetizer goes in the section matching what it's made of (fish → Dairy Mains,
chicken → Chicken Mains, meat → Meat Mains, salad → Salads) and also gets the "Appetizers" label.
The database key for Salads is still `salads_appetizers` (only the name shown changed).

## "Read now" button
The app's Add clippings page has a code-protected **Read now** button. It calls `api/read-now.js` on Vercel, which checks
the 4-digit code and fires the "Read uploaded recipe photos" routine through its API trigger. The code and the routine's
URL/token live only in Vercel's environment variables (`READ_NOW_PIN`, `CLAUDE_ROUTINE_URL`, `CLAUDE_ROUTINE_TOKEN`).
Run markers in `photos/inbox/_runs/` (named `<ms timestamp>-app.txt` / `-night.txt`) stop two readers working at once.

## "Add from a link"
Recipe websites that publish schema.org Recipe data (kosher.com does) are imported by the app itself through
`api/import.js`, word for word, with no Claude involved. The owner checks section and Meat/Dairy/Pareve and saves.
Instagram/Facebook/TikTok can't be read automatically; the app asks for the caption text to be pasted instead.

## iPhone Share menu
An Apple Shortcut on the owner's phone ("My Cookbook", shown in the Share Sheet) posts each shared photo to
`api/upload.js` (`?taken=<ISO date>`), which puts it in the same inbox as app uploads (screenshots detected by
shape/PNG and marked "-shot"). `?test=1` = dry run.

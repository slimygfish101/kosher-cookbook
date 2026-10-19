# Batch tools

How a batch is read (run in the cloud workspace, never on the family computer):

1. Download each photo from Google Drive (Drive connector) and note its file ID in `ids.json`.
2. `convert.py` – turn iPhone HEIC photos into upright JPEGs.
3. Read each recipe page; `add.py` appends the typed-out recipe to `recipes.json`. Anything unclear goes in `needs_help` or `help_items.json`.
4. `food.py` – crop the food picture; `web.py` – make shrunk page/food/thumb WebP copies.
5. `upload.py <batch dir> "Batch NN"` – upload pictures to Supabase storage, insert recipes and help items, record the batch. Safe to re-run: recipes already in that batch are skipped.
6. After the batch is added, schedule a ONE-TIME accuracy check for 4:00 AM America/New_York that night
   (create_trigger with run_once_at, fresh session, model claude-sonnet-5-5 to save usage; copy the prompt of the "Recipe accuracy check (Batch 01)" routine).
   The check follows `checks/PROCEDURE.md`. The owner wants it only after new recipes, not every night.

Sections (see `src/config.js`): Salads, Soups, Dairy Mains (fish too), Chicken Mains, Meat Mains, Sides, Desserts.
There is no Appetizers section: an appetizer goes in the section matching what it's made of (fish → Dairy Mains,
chicken → Chicken Mains, meat → Meat Mains, salad → Salads) and also gets the "Appetizers" label.
The database key for Salads is still `salads_appetizers` (only the name shown changed).

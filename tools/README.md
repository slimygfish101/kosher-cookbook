# Batch tools

How a batch is read (run in the cloud workspace, never on the family computer):

1. Download each photo from Google Drive (Drive connector) and note its file ID in `ids.json`.
2. `convert.py` – turn iPhone HEIC photos into upright JPEGs.
3. Read each recipe page; `add.py` appends the typed-out recipe to `recipes.json`. Anything unclear goes in `needs_help` or `help_items.json`.
4. `food.py` – crop the food picture; `web.py` – make shrunk page/food/thumb WebP copies.
5. `upload.py <batch dir> "Batch NN"` – upload pictures to Supabase storage, insert recipes and help items, record the batch. Safe to re-run: recipes already in that batch are skipped.

import json, sys, os
from PIL import Image
b = sys.argv[1]; out = f'{b}/out'
recipes = json.load(open(f'{b}/recipes.json'))
# rotate.json (optional): photo stem -> degrees to turn counter-clockwise so the page is upright. Default 0.
rot = json.load(open(f'{b}/rotate.json')) if os.path.exists(f'{b}/rotate.json') else {}
# spreads.json (optional): photo stems that show a two-page magazine spread; only the left (recipe) page is kept as the page copy.
spreads = set(json.load(open(f'{b}/spreads.json'))) if os.path.exists(f'{b}/spreads.json') else set()
tot = 0
for r in recipes:
    if not r['photos']:
        continue  # typed out from a link or pasted text, no photo
    d = f'{out}/{r["id"]}'; os.makedirs(d, exist_ok=True)
    src = r['photos'][0]
    no_page = r.get('source_type') in ('link', 'text')  # a web recipe has no clipping page, just its picture
    im = Image.open(f'{b}/full/{src}.jpg').rotate(rot.get(src, 0), expand=True)
    W, H = im.size
    page = im.crop((0, 0, int(W * 0.53), H)) if src in spreads else im
    if not no_page:
        page.thumbnail((2400, 2400)); page.save(f'{d}/page.webp', 'WEBP', quality=72)
    if not os.path.exists(f'{b}/food/{r["id"]}.jpg'):
        continue  # no picture of the dish: page copy only
    food = Image.open(f'{b}/food/{r["id"]}.jpg')
    f2 = food.copy(); f2.thumbnail((1200, 1200)); f2.save(f'{d}/food.webp', 'WEBP', quality=78)
    f3 = food.copy(); f3.thumbnail((480, 480)); f3.save(f'{d}/thumb.webp', 'WEBP', quality=72)
    s = sum(os.path.getsize(f'{d}/{n}') for n in ('page.webp', 'food.webp', 'thumb.webp') if os.path.exists(f'{d}/{n}')); tot += s
print('total MB', round(tot / 1e6, 1), 'avg KB/recipe', round(tot / len(recipes) / 1e3))

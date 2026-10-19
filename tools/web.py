import json, sys, os
from PIL import Image
b = sys.argv[1]; out = f'{b}/out'
recipes = json.load(open(f'{b}/recipes.json'))
rot = {'IMG_0659': 270, 'IMG_0660': 270, 'IMG_0661': 270}
binder = {'IMG_0659', 'IMG_0660'}
tot = 0
for r in recipes:
    d = f'{out}/{r["id"]}'; os.makedirs(d, exist_ok=True)
    src = r['photos'][0]
    im = Image.open(f'{b}/full/{src}.jpg').rotate(rot.get(src, 90), expand=True)
    W, H = im.size
    page = im if src in binder else im.crop((0, 0, int(W * (0.62 if src == 'IMG_0670' else 0.53)), H))
    page.thumbnail((2400, 2400)); page.save(f'{d}/page.webp', 'WEBP', quality=72)
    food = Image.open(f'{b}/food/{r["id"]}.jpg')
    f2 = food.copy(); f2.thumbnail((1200, 1200)); f2.save(f'{d}/food.webp', 'WEBP', quality=78)
    f3 = food.copy(); f3.thumbnail((480, 480)); f3.save(f'{d}/thumb.webp', 'WEBP', quality=72)
    s = sum(os.path.getsize(f'{d}/{n}') for n in ('page.webp', 'food.webp', 'thumb.webp')); tot += s
print('total MB', round(tot / 1e6, 1), 'avg KB/recipe', round(tot / len(recipes) / 1e3))

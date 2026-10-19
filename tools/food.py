import json, sys, os
from PIL import Image
b = sys.argv[1]
recipes = json.load(open(f'{b}/recipes.json'))
# crop boxes as fractions of the upright image: (left, top, right, bottom)
spread = (0.505, 0.02, 0.985, 0.98)
special = {'IMG_0670': (0.6, 0.02, 0.985, 0.98), 'IMG_0659': (0.42, 0.0, 1.0, 0.45), 'IMG_0660': (0.47, 0.18, 0.97, 0.62)}
rot = {'IMG_0659': 270, 'IMG_0660': 270, 'IMG_0661': 270}
done = {}
for r in recipes:
    src = r['photos'][-1]
    im = Image.open(f'{b}/full/{src}.jpg')
    im = im.rotate(rot.get(src, 90), expand=True)
    W, H = im.size
    box = special.get(src, spread)
    food = im.crop((int(box[0]*W), int(box[1]*H), int(box[2]*W), int(box[3]*H)))
    food.thumbnail((1400, 1400)); food.save(f'{b}/food/{r["id"]}.jpg', quality=85)
    print(r['id'], src, food.size)

import json, sys, os
from PIL import Image
b = sys.argv[1]
recipes = json.load(open(f'{b}/recipes.json'))
# crop boxes as fractions of the upright image: (left, top, right, bottom)
# crops.json: photo stem -> [left, top, right, bottom] fractions of the upright photo showing the food picture.
# Photos not listed are treated as a two-page spread with the picture on the right-hand page.
spread = (0.505, 0.02, 0.985, 0.98)
special = json.load(open(f'{b}/crops.json')) if os.path.exists(f'{b}/crops.json') else {}
rot = json.load(open(f'{b}/rotate.json')) if os.path.exists(f'{b}/rotate.json') else {}
done = {}
for r in recipes:
    src = r['photos'][-1]
    im = Image.open(f'{b}/full/{src}.jpg')
    im = im.rotate(rot.get(src, 0), expand=True)
    W, H = im.size
    box = special.get(src, spread)
    food = im.crop((int(box[0]*W), int(box[1]*H), int(box[2]*W), int(box[3]*H)))
    food.thumbnail((1400, 1400)); food.save(f'{b}/food/{r["id"]}.jpg', quality=85)
    print(r['id'], src, food.size)

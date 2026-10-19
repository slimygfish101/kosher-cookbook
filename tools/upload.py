import json, sys, subprocess, os
b, batch = sys.argv[1], sys.argv[2]
U = 'https://bgrbnocjdndsrovckias.supabase.co'; K = 'sb_publishable_5UJAoO1FFtZeTJ7NR7n5Qw_wqJWHsdC'
H = ['-H', f'apikey: {K}', '-H', f'Authorization: Bearer {K}']
slug = batch.lower().replace(' ', '-')
from urllib.parse import quote
Q = quote(batch)
ids = json.load(open(f'{b}/ids.json'))
# Batch 01 came from Google Drive (ids.json maps "IMG_0001.HEIC" -> Drive file id);
# later batches come from the app's inbox (ids.json maps "P001" -> upload info).
def drive_id(stem):
    v = ids.get(f'{stem}.HEIC')
    return v if isinstance(v, str) else None
def curl(*a):
    r = subprocess.run(['curl', '-sS', '-w', '\n%{http_code}', *H, *a], capture_output=True, text=True)
    body, code = r.stdout.rsplit('\n', 1); return code, body
def dump(o):
    f = f'{b}/payload.json'; open(f, 'w').write(json.dumps(o, ensure_ascii=False)); return f
def up(local, path):
    code, body = curl('-X', 'POST', f'{U}/storage/v1/object/photos/{path}', '-H', 'Content-Type: image/webp', '-H', 'x-upsert: false', '--data-binary', f'@{local}')
    if code not in ('200', '201') and 'Duplicate' not in body and 'already exists' not in body: raise SystemExit(f'upload failed {path}: {code} {body}')
    return path
copied = {}
def photo_copy(stem):
    # High-res copy (about 3000 px) of an original photo, saved once even if several recipes share it.
    if stem not in copied:
        from PIL import Image
        im = Image.open(f'{b}/full/{stem}.jpg'); im.thumbnail((3000, 3000))
        loc = f'{b}/out/{stem}-hires.webp'; os.makedirs(f'{b}/out', exist_ok=True); im.save(loc, 'WEBP', quality=78)
        copied[stem] = up(loc, f'{slug}/photos/{stem}.webp')
    return copied[stem]
recipes = json.load(open(f'{b}/recipes.json'))
existing = json.loads(curl(f'{U}/rest/v1/recipes?select=title,batch&batch=eq.{Q}')[1])
have = {e['title'] for e in existing}
rows = []
for r in recipes:
    if r['title'] in have: print('skip (already added)', r['title']); continue
    p = f'{slug}/{r["id"]}'
    imgs = {n: up(f'{b}/out/{r["id"]}/{n}.webp', f'{p}/{n}.webp') for n in ('page', 'food', 'thumb') if os.path.exists(f'{b}/out/{r["id"]}/{n}.webp')}
    by = f'Recipe by {r["recipe_by"]}. ' if r.get('recipe_by') else ''
    pg = f', page {r["page"]}' if r.get('page') else ''
    rows.append({
        'title': r['title'] + (f' {r["subtitle"]}' if r.get('subtitle') else ''),
        'section': r['section'], 'kosher_type': r['kosher_type'], 'description': r['description'],
        'ingredients': r['ingredients'], 'steps': r['steps'],
        'servings': r['servings'], 'servings_text': r['yield_text'],
        'total_time': r.get('time_printed') or r.get('time_estimate'),
        'tips': r.get('clipping_notes', []), 'credit': f'{by}{r["source"]}{pg}',
        'page_image': imgs.get('page'), 'food_image': imgs.get('food'), 'thumb_image': imgs.get('thumb'),
        'drive_page_ids': [i for i in map(drive_id, r['photos']) if i], 'drive_food_id': drive_id(r['photos'][-1]),
        'photo_images': [photo_copy(x) for x in r['photos']],
        'batch': batch, 'source': r.get('source_type', 'photo'),
        'mixes_fish_and_meat': bool(r.get('contains_fish') and r['kosher_type'] == 'meat'),
        'needs_help': bool(r['needs_help']), 'needs_help_reason': r['needs_help'],
        'original': {**r, 'source_text': f'{by}{r["source"]}{pg}', 'time_is_estimate': not r['time_printed']},
    })
if rows:
    code, body = curl('-X', 'POST', f'{U}/rest/v1/recipes', '-H', 'Content-Type: application/json', '-H', 'Prefer: return=minimal', '--data-binary', '@'+dump(rows))
    print('insert recipes', code, body[:300])
help_items = json.load(open(f'{b}/help_items.json'))
code, body = curl(f'{U}/rest/v1/help_items?select=reason&batch=eq.{Q}')
if not json.loads(body):
    hrows = []
    for h in help_items:
        imgs = []
        for x in h['photos']:
            from PIL import Image
            rot = json.load(open(f'{b}/rotate.json')) if os.path.exists(f'{b}/rotate.json') else {}
            im = Image.open(f'{b}/full/{x}.jpg').rotate(rot.get(x, 0), expand=True); im.thumbnail((2000, 2000))
            loc = f'{b}/out/{x}.webp'; im.save(loc, 'WEBP', quality=72); imgs.append(up(loc, f'{slug}/help/{x}.webp'))
        hrows.append({'batch': batch, 'drive_file_ids': [i for i in map(drive_id, h['photos']) if i], 'images': imgs, 'reason': h['reason']})
    print('insert help', *curl('-X', 'POST', f'{U}/rest/v1/help_items', '-H', 'Content-Type: application/json', '--data-binary', '@'+dump(hrows)))
total = len(json.loads(curl(f'{U}/rest/v1/recipes?select=id&batch=eq.{Q}')[1]))
nh = len(json.loads(curl(f'{U}/rest/v1/recipes?select=id&batch=eq.{Q}&needs_help=eq.true')[1])) + len(help_items)
print('batch row', *curl('-X', 'POST', f'{U}/rest/v1/batches', '-H', 'Content-Type: application/json', '-H', 'Prefer: resolution=merge-duplicates',
      '-d', json.dumps({'name': batch, 'drive_folder_id': None, 'photo_count': len(ids), 'recipes_added': total, 'help_count': nh})))
print('recipes in batch:', total, 'help:', nh)

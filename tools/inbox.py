"""Photo inbox: photos uploaded from the app's "Add clippings" page.

  python3 inbox.py list                    -> batches waiting to be read (oldest first)
  python3 inbox.py fetch "Batch 02" DIR    -> download that batch's photos into DIR/heic (in order) and write DIR/ids.json
  python3 inbox.py finish "Batch 02" DIR   -> after the recipes are saved: check every photo has its high-res copy,
                                              mark the uploads as read, and clear them out of the inbox
"""
import json, os, subprocess, sys
from urllib.parse import quote

U = 'https://bgrbnocjdndsrovckias.supabase.co'
K = 'sb_publishable_5UJAoO1FFtZeTJ7NR7n5Qw_wqJWHsdC'
H = ['-H', f'apikey: {K}', '-H', f'Authorization: Bearer {K}']


def curl(*a):
    r = subprocess.run(['curl', '-sS', '-w', '\n%{http_code}', *H, *a], capture_output=True, text=True)
    body, code = r.stdout.rsplit('\n', 1)
    return code, body


def waiting(batch=None):
    q = f'{U}/rest/v1/uploads?select=*&processed_at=is.null&order=uploaded_at,position'
    if batch:
        q += f'&batch=eq.{quote(batch)}'
    code, body = curl(q)
    if code != '200':
        raise SystemExit(f'could not read uploads: {code} {body}')
    return json.loads(body)


def slug(batch):
    return batch.lower().replace(' ', '-')


def cmd_list():
    groups = {}
    for u in waiting():
        groups.setdefault(u['batch'], []).append(u)
    for b, us in groups.items():
        print(f'{b}: {len(us)} photos, uploaded {us[0]["uploaded_at"][:10]} by {us[0]["uploaded_by"] or "?"}')
    if not groups:
        print('nothing waiting')


def cmd_fetch(batch, d):
    os.makedirs(f'{d}/heic', exist_ok=True)
    ups = sorted(waiting(batch), key=lambda u: (u['taken_at'] or '', u['position'] or 0))
    ids = {}
    for n, u in enumerate(ups, 1):
        ext = os.path.splitext(u['path'])[1] or '.jpg'
        stem = f'P{n:03d}'
        out = f'{d}/heic/{stem}{ext}'
        r = subprocess.run(['curl', '-sS', '-f', '-o', out, f'{U}/storage/v1/object/public/photos/{quote(u["path"])}'])
        if r.returncode:
            raise SystemExit(f'download failed: {u["path"]}')
        kind = 'screenshot' if '-shot.' in u['path'] else 'pdf' if ext.lower() == '.pdf' else 'item' if ext.lower() == '.json' else 'clipping'
        ids[stem] = {'upload_id': u['id'], 'path': u['path'], 'file_name': u['file_name'], 'taken_at': u['taken_at'], 'kind': kind}
    json.dump(ids, open(f'{d}/ids.json', 'w'), indent=1)
    print(f'{len(ids)} photos saved to {d}/heic as P001..P{len(ids):03d} (in the order they were taken)')


def cmd_finish(batch, d):
    ids = json.load(open(f'{d}/ids.json'))
    missing = []
    for stem, info in ids.items():
        if info.get('kind') == 'item':
            continue  # a link or pasted text: nothing to keep, the recipe holds the words
        # each photo must be kept somewhere: as a recipe's photo copy, or on the "needs my help" list
        codes = [curl('-o', '/dev/null', '-I', f'{U}/storage/v1/object/public/photos/{slug(batch)}/{folder}/{stem}.webp')[0] for folder in ('photos', 'help')]
        if '200' not in codes:
            missing.append(stem)
    if missing:
        raise SystemExit(f'not finishing: no high-res copy saved yet for {missing}')
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    for stem, info in ids.items():
        code, body = curl('-X', 'PATCH', f'{U}/rest/v1/uploads?id=eq.{info["upload_id"]}', '-H', 'Content-Type: application/json', '-d', json.dumps({'processed_at': now}))
        if code not in ('200', '204'):
            raise SystemExit(f'could not mark {stem}: {code} {body}')
    paths = [i['path'] for i in ids.values()]
    code, body = curl('-X', 'DELETE', f'{U}/storage/v1/object/photos', '-H', 'Content-Type: application/json', '-d', json.dumps({'prefixes': paths}))
    print('marked', len(ids), 'uploads as read; inbox cleared:', code)


if __name__ == '__main__':
    {'list': lambda: cmd_list(), 'fetch': lambda: cmd_fetch(sys.argv[2], sys.argv[3]), 'finish': lambda: cmd_finish(sys.argv[2], sys.argv[3])}[sys.argv[1]]()

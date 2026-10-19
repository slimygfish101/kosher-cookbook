import json, sys, os
path = sys.argv[1]
data = json.load(open(path)) if os.path.exists(path) else []
new = json.load(sys.stdin)
for r in (new if isinstance(new, list) else [new]):
    data = [d for d in data if d['id'] != r['id']] + [r]
json.dump(data, open(path, 'w'), indent=1, ensure_ascii=False)
print(len(data), 'recipes:', ', '.join(d['id'] for d in data))

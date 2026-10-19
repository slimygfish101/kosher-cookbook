// "Add from a link": reads the recipe that most recipe websites publish for Google
// (schema.org Recipe data inside the page), word for word. No AI involved.
//   GET /api/import?url=<recipe page>   -> { found: true, recipe } or { found: false, reason }
//   GET /api/import?image=<image url>   -> the image itself (so the app can shrink and save it)

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function okUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/i.test(u.hostname)) return null;
    return u;
  } catch { return null; }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  const type = [].concat(node['@type'] ?? []).map(String);
  if (type.includes('Recipe')) return node;
  return findRecipe(node['@graph']) ?? findRecipe(node.mainEntity) ?? null;
}

// recipeInstructions can be a string, a list of strings, HowToSteps, or HowToSections of steps.
function steps(ins) {
  const out = [];
  const walk = (x, section) => {
    if (!x) return;
    if (typeof x === 'string') { clean(x).split(/\n+|(?<=\.)\s{2,}/).map((s) => s.trim()).filter(Boolean).forEach((s) => out.push({ section, text: s })); return; }
    if (Array.isArray(x)) { x.forEach((y) => walk(y, section)); return; }
    const t = [].concat(x['@type'] ?? []).map(String);
    if (t.includes('HowToSection')) { walk(x.itemListElement, clean(x.name) || section); return; }
    if (x.text || x.name) out.push({ section, text: clean(x.text ?? x.name) });
    else if (x.itemListElement) walk(x.itemListElement, section);
  };
  walk(ins, null);
  return out.filter((s) => s.text);
}

function duration(iso) {
  const m = String(iso ?? '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  const mins = (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
  if (!mins) return null;
  const h = Math.floor(mins / 60), mm = mins % 60;
  return `About ${h ? `${h} hour${h > 1 ? 's' : ''}` : ''}${h && mm ? ' ' : ''}${mm ? `${mm} minutes` : ''}`;
}

function image(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return image(img[img.length > 1 ? img.length - 1 : 0]) ?? image(img[0]);
  return img.url ?? img.contentUrl ?? null;
}

function names(x) {
  return [].concat(x ?? []).map((a) => clean(typeof a === 'string' ? a : a?.name)).filter(Boolean).join(', ');
}

export default async function handler(req, res) {
  if (req.query.image) {
    const u = okUrl(req.query.image);
    if (!u) return res.status(400).end();
    const r = await fetch(u, { headers: { 'User-Agent': UA } }).catch(() => null);
    const type = r?.headers.get('content-type') ?? '';
    if (!r?.ok || !type.startsWith('image/')) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) return res.status(413).end();
    res.setHeader('Content-Type', type);
    return res.status(200).send(buf);
  }

  const u = okUrl(req.query.url);
  if (!u) return res.status(400).json({ found: false, reason: 'bad_link' });
  if (/(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)tiktok\.com$/i.test(u.hostname)) {
    return res.status(200).json({ found: false, reason: 'social' });
  }
  const page = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' }).catch(() => null);
  if (!page?.ok) return res.status(200).json({ found: false, reason: 'unreachable' });
  const html = await page.text();

  let recipe = null;
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { recipe = findRecipe(JSON.parse(m[1].trim())); } catch { /* skip broken blocks */ }
    if (recipe) break;
  }
  if (!recipe) return res.status(200).json({ found: false, reason: 'no_recipe_data' });

  const yieldText = [].concat(recipe.recipeYield ?? []).map(clean).filter(Boolean);
  const servings = yieldText.map((y) => parseFloat(y)).find((n) => n > 0) ?? null;
  return res.status(200).json({
    found: true,
    recipe: {
      title: clean(recipe.name),
      description: clean(recipe.description) || null,
      ingredients: [].concat(recipe.recipeIngredient ?? recipe.ingredients ?? []).map(clean).filter(Boolean),
      steps: steps(recipe.recipeInstructions),
      yield_text: yieldText.length ? (/^\d+(\s*[-–]\s*\d+)?$/.test(yieldText[0]) ? `Serves ${yieldText[0]}` : yieldText[0]) : null,
      servings,
      total_time: duration(recipe.totalTime) ?? duration(recipe.cookTime) ?? null,
      image: image(recipe.image),
      author: names(recipe.author) || null,
      category: [].concat(recipe.recipeCategory ?? [], recipe.recipeCuisine ?? []).map(clean).join(', ') || null,
      keywords: clean([].concat(recipe.keywords ?? []).join(', ')) || null,
      site: u.hostname.replace(/^www\./, ''),
      url: page.url || u.href,
    },
  });
}

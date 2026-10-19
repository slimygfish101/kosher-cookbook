import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PHOTO_BUCKET, SECTIONS, KOSHER_TYPES } from './config.js';
import { scaleIngredient } from './scale.js';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById('app');

// Columns needed for lists, search and the duplicate catcher (the full recipe is fetched when opened).
const LIST_COLUMNS = 'id,title,section,kosher_type,thumb_image,ingredients,needs_help,mixes_fish_and_meat,created_at';

const state = {
  recipes: [],
  labels: [],
  recipeLabels: new Map(), // recipe id -> Set of label ids
  helpItems: [],
};

// ---------- Small helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const photoUrl = (path) => (path ? `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}` : '');
const driveUrl = (id) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
const sectionName = (key) => SECTIONS.find((s) => s.key === key)?.name ?? 'No section yet';
const kosherName = (key) => KOSHER_TYPES.find((k) => k.key === key)?.name ?? '';
const favorites = () => state.labels.find((l) => l.built_in && l.name === 'Favorites');
const labelsOf = (id) => state.recipeLabels.get(id) ?? new Set();

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch { /* private mode etc. — not important */ }
  return null;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function fail(error, what) {
  console.error(error);
  toast(`Couldn't ${what}. Please check your internet and try again.`);
}

function kosherBadge(type) {
  return type ? `<span class="badge ${esc(type)}">${esc(kosherName(type))}</span>` : '';
}

// ---------- Loading data ----------

async function loadAll() {
  const [recipes, labels, links, help] = await Promise.all([
    db.from('recipes').select(LIST_COLUMNS).is('deleted_at', null).order('title'),
    db.from('labels').select('*').order('name'),
    db.from('recipe_labels').select('recipe_id,label_id'),
    db.from('help_items').select('*').is('resolved_at', null).order('created_at'),
  ]);
  for (const r of [recipes, labels, links, help]) if (r.error) throw r.error;
  state.recipes = recipes.data;
  state.labels = labels.data.sort((a, b) => (b.built_in - a.built_in) || a.name.localeCompare(b.name));
  state.recipeLabels = new Map();
  for (const { recipe_id, label_id } of links.data) {
    if (!state.recipeLabels.has(recipe_id)) state.recipeLabels.set(recipe_id, new Set());
    state.recipeLabels.get(recipe_id).add(label_id);
  }
  state.helpItems = help.data;
}

// ---------- Kosher checks & duplicates ----------

const FISH = /\b(salmon|tuna|fish|branzino|tilapia|cod|anchov\w*|sardine\w*|halibut|trout|flounder|sole|gefilte|lox|herring|sea bass|mackerel|snapper)\b/i;
const MEAT = /\b(beef|chicken|flanken|steaks?|brisket|lamb|veal|turkey|pastrami|salami|meat|marrow|duck|shank|roast|ribs?|pargiyot|schnitzel|hot dogs?|sausages?|consomm[eé])\b/i;

function mixesFishAndMeat(ingredients) {
  const text = (ingredients ?? []).map((i) => i.text).join(' \n ');
  return FISH.test(text) && MEAT.test(text);
}

const STOP = new Set('a an and or of to the for with plus divided cup cups tablespoon tablespoons tbsp teaspoon teaspoons tsp lb lbs pound pounds oz ounce ounces g kg ml can cans package packages box chopped diced minced sliced thinly finely roughly fresh large small medium whole peeled cut into pieces taste optional about approx more needed for serving'.split(' '));

function ingredientKeys(ingredients) {
  const keys = new Set();
  for (const i of ingredients ?? []) {
    const words = i.text.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    if (words.length) keys.add(words.slice(0, 2).join(' '));
  }
  return keys;
}

function titleWords(title) {
  return new Set(title.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}

function findDuplicates(recipe, pool = state.recipes) {
  const tw = titleWords(recipe.title);
  const ik = ingredientKeys(recipe.ingredients);
  return pool.filter((other) => {
    if (other.id === recipe.id) return false;
    const otw = titleWords(other.title);
    const titleScore = overlap(tw, otw) * (Math.min(tw.size, otw.size) / Math.max(tw.size, otw.size, 1));
    const oik = ingredientKeys(other.ingredients);
    const ingScore = Math.min(ik.size, oik.size) >= 4 ? overlap(ik, oik) : 0;
    return titleScore >= 0.75 || ingScore >= 0.8 || (titleScore >= 0.5 && ingScore >= 0.6);
  });
}

// ---------- Cards and tiles ----------

function recipeCard(r) {
  const fav = favorites() && labelsOf(r.id).has(favorites().id);
  return `<a class="rcard" href="#/recipe/${r.id}">
    <div class="thumb">${r.thumb_image ? `<img loading="lazy" src="${photoUrl(r.thumb_image)}" alt="">` : ''}${fav ? '<span class="fav">❤️</span>' : ''}</div>
    <div class="body">
      <div class="title">${esc(r.title)}</div>
      <div class="row">${kosherBadge(r.kosher_type)}${r.needs_help ? '<span class="badge" style="background:var(--warn-bg);color:var(--warn)">Needs help</span>' : ''}</div>
      ${r.mixes_fish_and_meat ? '<div class="flag">⚠ Mixes fish and meat</div>' : ''}
    </div>
  </a>`;
}

function grid(recipes, emptyText = 'No recipes here yet.') {
  return recipes.length ? `<div class="grid">${recipes.map(recipeCard).join('')}</div>` : `<p class="empty">${esc(emptyText)}</p>`;
}

function tile(href, name, list, cls = '') {
  const cover = list.find((r) => r.thumb_image);
  return `<a class="tile ${cls} ${cover ? '' : 'noimg'}" href="${href}">
    ${cover ? `<img loading="lazy" src="${photoUrl(cover.thumb_image)}" alt="">` : ''}
    <div class="tile-text"><div class="tile-name">${esc(name)}</div><div class="tile-count">${list.length} recipe${list.length === 1 ? '' : 's'}</div></div>
  </a>`;
}

function helpCount() {
  return state.recipes.filter((r) => r.needs_help).length + state.helpItems.length;
}

// ---------- Views ----------

function viewHome() {
  const n = helpCount();
  const labelTiles = state.labels.map((l) => tile(`#/label/${l.id}`, l.name, state.recipes.filter((r) => labelsOf(r.id).has(l.id)), 'label')).join('');
  return `
    ${n ? `<div class="banner warn">There ${n === 1 ? 'is 1 item' : `are ${n} items`} on the <a href="#/help">"needs my help" list</a>.</div>` : ''}
    <label class="btn primary big add-photos">📷 Add recipe photos<input type="file" class="photo-picker" accept="image/*,application/pdf" multiple hidden></label>
    <h1>Our recipes</h1>
    <div class="tiles">${SECTIONS.map((s) => tile(`#/section/${s.key}`, s.name, state.recipes.filter((r) => r.section === s.key))).join('')}</div>
    <div class="spread section-head"><h2 style="margin:0">My labels</h2><button class="btn small" data-add-label>+ Add label</button></div>
    <div class="tiles">${labelTiles}</div>
    ${state.recipes.some((r) => !r.section) ? `<h2 class="section-head">Not sorted yet</h2>${grid(state.recipes.filter((r) => !r.section))}` : ''}
  `;
}

function viewSection(key, params) {
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) return notFound();
  let list = state.recipes.filter((r) => r.section === key);
  const kosher = params.get('k');
  if (kosher) list = list.filter((r) => r.kosher_type === kosher);
  const filters = section.kosherLabel
    ? `<div class="chips filters">${[['', 'All'], ...KOSHER_TYPES.map((k) => [k.key, k.name])].map(([k, name]) =>
        `<a class="chip ${(kosher ?? '') === k ? 'on' : ''}" href="#/section/${key}${k ? `?k=${k}` : ''}">${name}</a>`).join('')}</div>`
    : '';
  return `<h1>${esc(section.name)}</h1>${section.note ? `<p class="muted">${esc(section.note)}</p>` : ''}${filters}${grid(list)}`;
}

function viewLabel(id) {
  const label = state.labels.find((l) => l.id === id);
  if (!label) return notFound();
  const list = state.recipes.filter((r) => labelsOf(r.id).has(id));
  return `<div class="spread"><h1>${label.name === 'Favorites' ? '❤️ ' : '🏷️ '}${esc(label.name)}</h1>${label.built_in ? '' : `<div class="row"><button class="btn small" data-rename="${label.id}">Rename</button><button class="btn small danger" data-delete-label="${label.id}">Delete</button></div>`}</div>
    ${grid(list, 'No recipes have this label yet. Open any recipe and tap the label to add it.')}`;
}

function viewLabels() {
  return `<h1>Labels</h1>
    <p class="muted">Labels are your own sections, like Pesach, Shabbos or "Kids love it". A recipe can have several labels and still stay in its main section. To label a recipe, open it and tap the label.</p>
    <form class="row card pad" id="new-label" style="margin:16px 0">
      <input class="searchbox" style="flex:1;min-width:200px" name="name" placeholder="New label name, e.g. Pesach" maxlength="40" required>
      <button class="btn primary">Create label</button>
    </form>
    <div class="list">${state.labels.map((l) => {
      const count = state.recipes.filter((r) => labelsOf(r.id).has(l.id)).length;
      return `<div class="item"><div class="grow"><a href="#/label/${l.id}"><b>${esc(l.name)}</b></a> <span class="muted small">${count} recipe${count === 1 ? '' : 's'}${l.built_in ? ' · built in' : ''}</span></div>
        ${l.built_in ? '' : `<button class="btn small" data-rename="${l.id}">Rename</button><button class="btn small danger" data-delete-label="${l.id}">Delete</button>`}</div>`;
    }).join('')}</div>`;
}

function viewSearch(params) {
  const q = params.get('q') ?? '';
  return `<h1>Search</h1>
    <input class="searchbox" id="search" type="search" placeholder="Search anything, e.g. salmon" value="${esc(q)}" autocomplete="off">
    <div id="results"></div>`;
}

// One box: recipes whose name matches come first, then recipes that use it as an ingredient.
function searchResults(q) {
  const words = q.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const ingText = (r) => (r.ingredients ?? []).map((i) => i.text.toLowerCase()).join(' | ');
  const inName = state.recipes.filter((r) => words.every((w) => r.title.toLowerCase().includes(w)));
  const inIngredients = state.recipes.filter((r) => !inName.includes(r) && words.every((w) => r.title.toLowerCase().includes(w) || ingText(r).includes(w)));
  if (!inName.length && !inIngredients.length) return '<p class="empty">Nothing found. Try a shorter word.</p>';
  return `${inName.length ? `<h2 class="section-head">In the recipe name</h2>${grid(inName)}` : ''}
    ${inIngredients.length ? `<h2 class="section-head">In the ingredients</h2>${grid(inIngredients)}` : ''}`;
}

function ingredientList(ingredients, factor = 1) {
  let lastGroup = null;
  return `<ul class="ingredients">${(ingredients ?? []).map((i) => {
    let head = '';
    if (i.group && i.group !== lastGroup) head = `<li class="group">${esc(i.group)}</li>`;
    lastGroup = i.group;
    return `${head}<li>${esc(scaleIngredient(i.text, factor))}</li>`;
  }).join('')}</ul>`;
}

let current = null; // the recipe open on screen, with its notes

async function viewRecipe(id, params) {
  const [{ data: r, error }, { data: notes }] = await Promise.all([
    db.from('recipes').select('*').eq('id', id).maybeSingle(),
    db.from('notes').select('*').eq('recipe_id', id).is('deleted_at', null).order('created_at'),
  ]);
  if (error) throw error;
  if (!r) return notFound();
  current = { recipe: r, notes: notes ?? [], factor: 1, pic: r.food_image ? 'food' : 'page' };
  const dups = r.deleted_at ? [] : findDuplicates(r);
  const o = r.original ?? {};
  return `
    ${r.deleted_at ? `<div class="banner danger">This recipe is in the Trash. <button class="btn small" data-restore="${r.id}">Restore it</button></div>` : ''}
    ${r.mixes_fish_and_meat ? '<div class="banner danger">⚠ This recipe mixes fish and meat. Please check before making it.</div>' : ''}
    ${r.needs_help ? `<div class="banner warn"><b>Needs your help:</b> ${esc(r.needs_help_reason)} <div class="row" style="margin-top:8px"><a class="btn small" href="#/edit/${r.id}">Fix it</a><button class="btn small" data-resolve="${r.id}">It's fine as is</button></div></div>` : ''}
    ${dups.length ? `<div class="banner info">This might be a duplicate of: ${dups.map((d) => `<a href="#/recipe/${d.id}">${esc(d.title)}</a>`).join(', ')}.</div>` : ''}
    <div class="recipe">
      <div class="pics" id="pics">${picsHtml(r)}</div>
      <div>
        <h1>${esc(r.title)}</h1>
        <div class="row">${r.section ? `<a class="chip" href="#/section/${r.section}">${esc(sectionName(r.section))}</a>` : ''}${kosherBadge(r.kosher_type)}</div>
        ${r.credit ? `<p class="muted small" style="margin:8px 0 0">${esc(r.credit)}</p>` : ''}
        <div class="meta">
          ${r.servings_text ? `<span><b>Makes:</b> ${esc(r.servings_text)}</span>` : ''}
          ${r.total_time ? `<span><b>Time:</b> ${esc(r.total_time)}${o.time_is_estimate ? ' <span class="small">(estimated, not printed on the clipping)</span>' : ''}</span>` : ''}
        </div>
        <div class="panel"><h3 style="margin-bottom:8px">Labels <span class="muted small" style="font-weight:400">(tap to add or remove)</span></h3><div class="chips" id="label-chips">${labelChips(r.id)}</div></div>
        <div class="actions row">
          <button class="btn primary" data-cook>👩‍🍳 Cook mode</button>
          <a class="btn" href="#/edit/${r.id}">✏️ Fix</a>
          <button class="btn" data-share>📤 Share</button>
          <button class="btn" data-print>🖨️ Print</button>
        </div>
        ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
        <div class="panel">
          <div class="spread"><h2 style="margin:0">Ingredients</h2>
            ${sizeSelect('size')}
          </div>
          <p class="muted small" id="scale-note" style="margin:6px 0 0">${servingsNote(r, 1)}</p>
          <div id="ingredients">${ingredientList(r.ingredients)}</div>
        </div>
        <div class="panel"><h2>Steps</h2><ol class="steps">${(r.steps ?? []).map((s) => `<li>${withTimers(s)}</li>`).join('')}</ol></div>
        ${(r.tips ?? []).length ? `<div class="panel tips stack"><h2>Tips</h2>${r.tips.map((t) => `<div class="tip">${t.label ? `<b>${esc(t.label)}</b>` : ''}${esc(t.text)}</div>`).join('')}</div>` : ''}
        <div class="panel notes stack" id="notes">${notesHtml()}</div>
        ${r.deleted_at ? '' : `<div class="actions"><button class="btn small danger" data-trash="${r.id}">Move to Trash</button></div>`}
      </div>
    </div>`;
}

const SIZES = [[0.5, 'Half'], [1, 'As written'], [2, 'Double'], [3, 'Triple']];

function sizeSelect(id) {
  return `<label class="size"><span>Recipe size</span><select id="${id}" data-size>${SIZES.map(([f, l]) => `<option value="${f}" ${f === current.factor ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}

function servingsNote(r, factor) {
  if (factor === 1) return '';
  const base = r.servings ? ` — about ${Math.round(r.servings * factor * 10) / 10} servings` : '';
  return `Showing ${factor}× the recipe${base}. Check pan sizes and cooking times yourself.`;
}

function picsHtml(r) {
  const pic = current.pic;
  const src = photoUrl(pic === 'food' ? r.food_image : r.page_image);
  const drive = r.drive_page_ids ?? [];
  return `
    <div class="main-pic">${src ? `<img src="${src}" alt="${pic === 'food' ? 'Food picture' : 'Recipe page'}" data-zoom>` : '<div class="pad muted">No picture yet. Tap Fix to add one.</div>'}</div>
    <div class="chips tabs">
      ${r.food_image ? `<button class="chip ${pic === 'food' ? 'on' : ''}" data-pic="food">Food picture</button>` : ''}
      ${r.page_image ? `<button class="chip ${pic === 'page' ? 'on' : ''}" data-pic="page">Original clipping</button>` : ''}
    </div>
    ${(r.photo_images ?? []).length ? `<p class="small muted">Original photo${r.photo_images.length > 1 ? 's' : ''}: ${r.photo_images.map((p, i) => `<a href="${photoUrl(p)}" target="_blank" rel="noopener">photo ${i + 1}</a>`).join(' · ')}</p>` : ''}
    ${drive.length ? `<p class="small muted">Full-size in Google Drive: ${drive.map((d, i) => `<a href="${driveUrl(d)}" target="_blank" rel="noopener">photo ${i + 1}</a>`).join(' · ')}</p>` : ''}`;
}

function labelChips(recipeId) {
  const on = labelsOf(recipeId);
  return state.labels.map((l) => `<button class="chip ${on.has(l.id) ? 'on' : ''}" data-label="${l.id}">${l.name === 'Favorites' ? (on.has(l.id) ? '❤️' : '🤍') + ' ' : ''}${esc(l.name)}</button>`).join('')
    + '<button class="chip add" data-new-label>+ New label</button>';
}

function notesHtml() {
  const notes = current.notes;
  return `<h2>Our notes</h2>
    <p class="muted small" style="margin-top:-6px">Your own notes. They're kept separate from the original recipe.</p>
    ${notes.map((n) => `<div class="note"><div>${esc(n.body).replace(/\n/g, '<br>')}</div><div class="who">${esc(n.author_name || 'Someone')} · ${new Date(n.created_at).toLocaleDateString()} · <a href="#" data-del-note="${n.id}">remove</a></div></div>`).join('') || '<p class="muted">No notes yet.</p>'}
    <form id="note-form" class="stack form" style="max-width:none">
      <textarea name="body" rows="3" placeholder="Add a note, e.g. 'Used half the sugar, perfect'" required></textarea>
      <div class="row"><input type="text" name="author" placeholder="Your name" value="${esc(store('cookbook-name') ?? '')}" style="max-width:220px"><button class="btn primary">Save note</button></div>
    </form>`;
}

// ---------- Edit / add ----------

function ingredientsToText(ingredients) {
  let last = null;
  const lines = [];
  for (const i of ingredients ?? []) {
    if (i.group !== last && i.group) lines.push(`# ${i.group}`);
    else if (i.group !== last && !i.group && lines.length) lines.push('#');
    last = i.group;
    lines.push(i.text);
  }
  return lines.join('\n');
}

function textToIngredients(text) {
  let group = null;
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { group = line.replace(/^#+/, '').trim() || null; continue; }
    out.push({ group, text: line });
  }
  return out;
}

const tipsToText = (tips) => (tips ?? []).map((t) => (t.label ? `${t.label}: ${t.text}` : t.text)).join('\n');
const textToTips = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = l.match(/^([^:]{2,30}):\s*(.+)$/);
  return m ? { label: m[1].trim(), text: m[2].trim() } : { label: null, text: l };
});

// ---------- Add from a link ----------

let imported = null; // a recipe read from a website, waiting to be checked and saved

const DAIRY = /\b(milk|butter|cheese|cream|yogh?urt|parmesan|mozzarella|ricotta|feta|cheddar|labaneh|ghee)\b/i;
const NOT_DAIRY = /\b(non-?dairy|dairy-?free|pareve|parve|coconut (milk|cream)|almond milk|oat milk|soy milk|margarine|peanut butter|cocoa butter)\b/gi;

function guessKosher(ingredients) {
  const text = ingredients.join(' \n ');
  if (MEAT.test(text)) return 'meat';
  if (DAIRY.test(text.replace(NOT_DAIRY, ''))) return 'dairy';
  return 'pareve';
}

function guessSection(r) {
  const t = `${r.title} ${r.category ?? ''} ${r.keywords ?? ''}`.toLowerCase();
  const ing = r.ingredients.join(' ').toLowerCase();
  if (/dessert|cake|cookie|brownie|pie\b|muffin|tart|pudding|ice cream|sweet/.test(t)) return 'desserts';
  if (/soup/.test(t)) return 'soups';
  if (/salad|slaw/.test(t)) return 'salads_appetizers';
  if (/side|kugel|rice|potato|vegetable|roasted veg/.test(t) && !/main/.test(t)) return 'sides';
  if (/chicken|turkey|pargiyot|duck/.test(t) || /chicken|turkey/.test(ing)) return 'chicken_mains';
  if (MEAT.test(t) || MEAT.test(ing)) return 'meat_mains';
  if (FISH.test(t) || FISH.test(ing) || DAIRY.test(ing)) return 'dairy_mains';
  return '';
}

async function importLink(url) {
  const msg = document.getElementById('link-msg');
  msg.innerHTML = '<p class="muted">Reading the recipe from that page…</p>';
  let data;
  try {
    data = await fetch(`/api/import?url=${encodeURIComponent(url)}`).then((r) => r.json());
  } catch {
    msg.innerHTML = '<div class="banner danger">Couldn\'t reach that page. Check the link and your internet.</div>';
    return;
  }
  if (data.found) {
    const r = data.recipe;
    imported = {
      title: r.title,
      section: guessSection(r),
      kosher_type: guessKosher(r.ingredients),
      servings: r.servings,
      servings_text: r.yield_text ?? '',
      total_time: r.total_time ?? '',
      description: r.description ?? '',
      ingredients: r.ingredients.map((text) => ({ group: null, text })),
      steps: r.steps.map((st) => (st.section ? `${st.section}: ${st.text}` : st.text)),
      tips: [],
      credit: `${r.author ? `Recipe by ${r.author}. ` : ''}From ${r.site} — ${r.url}`,
      image_url: r.image,
    };
    location.hash = '#/new';
    return;
  }
  const why = {
    social: 'Instagram, Facebook and TikTok don\'t let apps read their posts.',
    unreachable: 'That website doesn\'t let apps read its pages directly.',
    no_recipe_data: 'That page doesn\'t include a ready-made recipe.',
    bad_link: 'That doesn\'t look like a web link.',
  }[data.reason] ?? 'That page couldn\'t be read.';
  msg.innerHTML = data.reason === 'social'
    ? `<div class="banner warn">${why} Instead, open the post, copy the recipe text from the caption, and paste it in the box below. You can add the post's picture too (take a screenshot or save it to your photos).</div>`
    : `<div class="banner warn">${why} Claude can read it for you instead (it's added to the "waiting to be read" list).</div>
       <button class="btn primary" data-send-link="${esc(url)}">Send this link to Claude</button>`;
}

// Links and pasted text that need Claude go into the same inbox as photos, as a small text file.
async function addToInbox(item, photo) {
  const { data } = await db.from('uploads').select('batch').is('processed_at', null);
  const counts = new Map();
  for (const u of data ?? []) counts.set(u.batch, (counts.get(u.batch) ?? 0) + 1);
  const open = [...counts].filter(([, n]) => n < BATCH_MAX).map(([b]) => b).sort().pop();
  const batch = open ?? `Batch ${String(await nextBatchNumber()).padStart(2, '0')}`;
  let position = (counts.get(batch) ?? 0) + 1;
  const slug = batch.toLowerCase().replace(/\s+/g, '-');
  const by = store('cookbook-name') || null;
  const path = `inbox/${slug}/${String(position).padStart(3, '0')}-${Date.now()}.json`;
  const body = new Blob([JSON.stringify(item)], { type: 'application/json' });
  await db.storage.from(PHOTO_BUCKET).upload(path, body, { contentType: 'application/json' }).then((r) => { if (r.error) throw r.error; });
  const label = item.kind === 'link' ? `Link: ${item.url}` : `Pasted recipe: ${item.text.slice(0, 60)}`;
  await db.from('uploads').insert({ batch, path, file_name: label.slice(0, 200), size_bytes: body.size, position, uploaded_by: by }).throwOnError();
  if (photo && photo.size) {
    position++;
    const blob = await shrinkForReading(photo);
    const ppath = `inbox/${slug}/${String(position).padStart(3, '0')}-${Date.now()}.jpg`;
    await db.storage.from(PHOTO_BUCKET).upload(ppath, blob, { contentType: blob.type || 'image/jpeg' }).then((r) => { if (r.error) throw r.error; });
    await db.from('uploads').insert({ batch, path: ppath, file_name: `Picture for the pasted recipe above (${photo.name})`.slice(0, 200), size_bytes: photo.size, position, uploaded_by: by }).throwOnError();
  }
  return batch;
}

async function viewEdit(id) {
  let r = { title: '', section: '', kosher_type: '', servings: null, servings_text: '', total_time: '', description: '', ingredients: [], steps: [], tips: [], credit: '' };
  const fromLink = !id && imported;
  if (fromLink) r = imported;
  if (id) {
    const { data, error } = await db.from('recipes').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return notFound();
    r = data;
  }
  current = { recipe: r };
  const opt = (list, val) => list.map((x) => `<option value="${x.key}" ${x.key === val ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  return `<form class="form" id="edit-form">
    <h1>${id ? 'Fix recipe' : 'Add a recipe'}</h1>
    ${id ? '<p class="muted">Change anything that was misread. The original reading is kept, so you can always undo.</p>'
      : fromLink ? '<div class="banner info">Copied word for word from the website. Please check the <b>section</b> and <b>Meat / Dairy / Pareve</b> (they\'re only suggestions), then tap Add recipe.</div>'
      : '<p class="muted">Type a recipe in yourself. For clippings, use <a href="#/add">Add clippings</a> instead.</p>'}
    ${fromLink && r.image_url ? `<img src="/api/import?image=${encodeURIComponent(r.image_url)}" alt="" style="max-height:220px;border-radius:12px;margin:8px 0"><input type="hidden" name="image_url" value="${esc(r.image_url)}">` : ''}
    <label>Recipe name</label><input type="text" name="title" value="${esc(r.title)}" required>
    <div class="two">
      <div><label>Section</label><select name="section" required><option value="">Choose…</option>${opt(SECTIONS, r.section)}</select></div>
      <div><label>Meat, Dairy or Pareve</label><select name="kosher_type"><option value="">Not set</option>${opt(KOSHER_TYPES, r.kosher_type)}</select></div>
    </div>
    <div class="two">
      <div><label>Makes <span class="hint">e.g. Serves 6–8</span></label><input type="text" name="servings_text" value="${esc(r.servings_text)}"></div>
      <div><label>Number of servings <span class="hint">used when doubling</span></label><input type="number" name="servings" min="0" step="0.5" value="${esc(r.servings ?? '')}"></div>
    </div>
    <label>Time <span class="hint">e.g. About 1 hour</span></label><input type="text" name="total_time" value="${esc(r.total_time)}">
    <label>Ingredients <span class="hint">one per line. Start a line with # for a heading, e.g. "# Dressing"</span></label>
    <textarea class="tall" name="ingredients" required>${esc(ingredientsToText(r.ingredients))}</textarea>
    <label>Steps <span class="hint">one step per line</span></label>
    <textarea class="tall" name="steps" required>${esc((r.steps ?? []).join('\n'))}</textarea>
    <label>Tips <span class="hint">optional, one per line, e.g. "Freezer Friendly: freezes up to 3 months"</span></label>
    <textarea name="tips">${esc(tipsToText(r.tips))}</textarea>
    <label>About this recipe <span class="hint">optional</span></label>
    <textarea name="description" rows="3">${esc(r.description)}</textarea>
    <label>Where it's from <span class="hint">optional, e.g. "Aunt Rivky" or a magazine name</span></label>
    <input type="text" name="credit" value="${esc(r.credit)}">
    <div class="two">
      <div><label>${r.food_image ? 'Replace food picture' : 'Food picture'} <span class="hint">optional</span></label><input type="file" name="food" accept="image/*"></div>
      <div><label>${r.page_image ? 'Replace recipe page photo' : 'Photo of the recipe page'} <span class="hint">optional</span></label><input type="file" name="page" accept="image/*"></div>
    </div>
    <div class="actions row">
      <button class="btn primary" type="submit">${id ? 'Save changes' : 'Add recipe'}</button>
      <a class="btn" href="${id ? `#/recipe/${id}` : '#/'}">Cancel</a>
      ${id && r.original ? '<button class="btn" type="button" data-reset-original>Undo all fixes (back to the clipping)</button>' : ''}
    </div>
  </form>`;
}

async function shrinkPhoto(file, maxSide) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.75));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
  return blob;
}

async function uploadPhoto(file, folder, name, maxSide) {
  const blob = await shrinkPhoto(file, maxSide);
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${folder}/${name}-${Date.now()}.${ext}`;
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type });
  if (error) throw error;
  return path;
}

async function saveEdit(form) {
  const f = new FormData(form);
  const id = current.recipe.id;
  const row = {
    title: f.get('title').trim(),
    section: f.get('section') || null,
    kosher_type: f.get('kosher_type') || null,
    servings_text: f.get('servings_text').trim() || null,
    servings: f.get('servings') ? Number(f.get('servings')) : null,
    total_time: f.get('total_time').trim() || null,
    ingredients: textToIngredients(f.get('ingredients')),
    steps: f.get('steps').split('\n').map((s) => s.trim()).filter(Boolean),
    tips: textToTips(f.get('tips')),
    description: f.get('description').trim() || null,
    credit: f.get('credit').trim() || null,
  };
  row.mixes_fish_and_meat = mixesFishAndMeat(row.ingredients);

  if (!id) {
    const dups = findDuplicates(row);
    if (dups.length && !confirm(`This looks like a recipe you already have:\n\n${dups.map((d) => `• ${d.title}`).join('\n')}\n\nAdd it anyway?`)) return;
  }
  if (row.mixes_fish_and_meat && !confirm('Heads up: this recipe seems to mix fish and meat. It will be flagged. Save anyway?')) return;

  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const folder = `typed/${id ?? crypto.randomUUID()}`;
    let food = f.get('food');
    const imageUrl = f.get('image_url');
    if ((!food || !food.size) && imageUrl) {
      const img = await fetch(`/api/import?image=${encodeURIComponent(imageUrl)}`);
      if (img.ok) food = await img.blob();
    }
    if (food && food.size) {
      row.food_image = await uploadPhoto(food, folder, 'food', 1200);
      row.thumb_image = await uploadPhoto(food, folder, 'thumb', 480);
    }
    const page = f.get('page');
    if (page && page.size) row.page_image = await uploadPhoto(page, folder, 'page', 2400);

    let saved;
    if (id) {
      ({ data: saved } = await db.from('recipes').update(row).eq('id', id).select('id').single().throwOnError());
    } else {
      row.source = imported ? 'link' : 'typed';
      if (imported) {
        row.original = { title: imported.title, section: row.section, kosher_type: row.kosher_type, description: imported.description, ingredients: imported.ingredients, steps: imported.steps, clipping_notes: [], servings: imported.servings, yield_text: imported.servings_text, source_text: imported.credit, image_url: imported.image_url };
      }
      ({ data: saved } = await db.from('recipes').insert(row).select('id').single().throwOnError());
    }
    imported = null;
    await loadAll();
    toast(id ? 'Saved' : 'Recipe added');
    location.hash = `#/recipe/${saved.id}`;
  } catch (e) {
    fail(e, 'save the recipe');
    button.disabled = false;
    button.textContent = id ? 'Save changes' : 'Add recipe';
  }
}

async function resetToOriginal() {
  const r = current.recipe;
  const o = r.original;
  if (!o || !confirm('Put this recipe back exactly as it was read from the clipping? Your fixes will be undone (labels and notes stay).')) return;
  const row = {
    title: o.title + (o.subtitle ? ` ${o.subtitle}` : ''),
    section: o.section, kosher_type: o.kosher_type, description: o.description,
    ingredients: o.ingredients, steps: o.steps, tips: o.clipping_notes ?? [],
    servings: o.servings, servings_text: o.yield_text, credit: o.source_text ?? null,
  };
  try {
    await db.from('recipes').update(row).eq('id', r.id).throwOnError();
    await loadAll();
    toast('Back to the original');
    location.hash = `#/recipe/${r.id}`;
  } catch (e) { fail(e, 'undo the fixes'); }
}

// ---------- More, help, trash, backup ----------

function viewMore() {
  return `<h1>More</h1>
    <div class="list">
      <a class="item" href="#/help"><div class="grow"><b>"Needs my help" list</b><div class="muted small">Recipes I wasn't sure about</div></div><span class="badge" style="background:var(--warn-bg);color:var(--warn)">${helpCount()}</span></a>
      <a class="item" href="#/trash"><div class="grow"><b>Trash</b><div class="muted small">Deleted recipes. You can bring them back.</div></div></a>
      <button class="item" style="text-align:left;cursor:pointer;font:inherit" data-backup><div class="grow"><b>💾 Back up everything</b><div class="muted small">Saves a copy of all recipes, labels and notes to this device</div></div></button>
      <a class="item" href="#/add"><div class="grow"><b>📷 Add clippings</b><div class="muted small">Upload photos of clippings from your phone</div></div></a>
      <a class="item" href="#/new"><div class="grow"><b>➕ Type in a recipe</b><div class="muted small">Add a recipe yourself</div></div></a>
    </div>
    <div class="card pad" style="margin-top:20px">
      <h3>Adding clippings from photos</h3>
      <p class="muted" style="margin:0">Photograph the clippings, put them in a new Google Drive folder (like "Batch 02"), and tell Claude the batch is ready. The recipes appear here, and anything unclear goes on the "needs my help" list.</p>
    </div>`;
}

async function viewHelp() {
  const recipes = state.recipes.filter((r) => r.needs_help);
  const { data: full } = recipes.length
    ? await db.from('recipes').select('id,title,thumb_image,needs_help_reason').in('id', recipes.map((r) => r.id))
    : { data: [] };
  const items = state.helpItems;
  return `<h1>Needs my help</h1>
    ${!full.length && !items.length ? '<p class="empty">Nothing here. Everything is sorted. 🎉</p>' : ''}
    <div class="list">
      ${full.map((r) => `<div class="item">${r.thumb_image ? `<img src="${photoUrl(r.thumb_image)}" alt="">` : ''}<div class="grow"><a href="#/recipe/${r.id}"><b>${esc(r.title)}</b></a><div class="small">${esc(r.needs_help_reason)}</div></div></div>`).join('')}
      ${items.map((h) => `<div class="item">${(h.images ?? [])[0] ? `<img src="${photoUrl(h.images[0])}" alt="">` : ''}<div class="grow"><div class="small">${esc(h.reason)}</div>
        <div class="row" style="margin-top:6px">${(h.images ?? []).map((p, i) => `<a class="small" href="${photoUrl(p)}" target="_blank" rel="noopener">photo ${i + 1}</a>`).join(' ')}<button class="btn small" data-dismiss="${h.id}">Done, remove from list</button></div></div></div>`).join('')}
    </div>`;
}

async function viewTrash() {
  const { data, error } = await db.from('recipes').select('id,title,thumb_image,deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
  if (error) throw error;
  return `<h1>Trash</h1>
    <p class="muted">Recipes here are hidden from the cookbook. Nothing is deleted forever.</p>
    ${data.length ? `<div class="list">${data.map((r) => `<div class="item">${r.thumb_image ? `<img src="${photoUrl(r.thumb_image)}" alt="">` : ''}<div class="grow"><a href="#/recipe/${r.id}"><b>${esc(r.title)}</b></a><div class="muted small">Moved to Trash ${new Date(r.deleted_at).toLocaleDateString()}</div></div><button class="btn small" data-restore="${r.id}">Restore</button></div>`).join('')}</div>` : '<p class="empty">The Trash is empty.</p>'}`;
}

async function backup() {
  toast('Preparing backup…');
  try {
    const tables = ['recipes', 'labels', 'recipe_labels', 'notes', 'help_items', 'batches', 'recipe_history'];
    const results = await Promise.all(tables.map((t) => db.from(t).select('*').throwOnError()));
    const data = { saved_at: new Date().toISOString(), photo_base_url: `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/` };
    tables.forEach((t, i) => { data[t] = results[i].data; });
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cookbook-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Backup saved: ${data.recipes.length} recipes`);
  } catch (e) { fail(e, 'make the backup'); }
}

function notFound() {
  return '<h1>Not found</h1><p class="muted">That page or recipe isn\'t here. <a href="#/">Go home</a></p>';
}

// ---------- Cook mode ----------

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      return true;
    }
  } catch { /* not allowed right now */ }
  return false;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.querySelector('.cook')) keepAwake();
});

async function openCook() {
  const r = current.recipe;
  const el = document.createElement('div');
  el.className = 'cook';
  document.body.appendChild(el);
  document.body.classList.add('cooking');
  const awake = await keepAwake();
  const render = () => {
    el.innerHTML = `
      <div class="cook-top">
        <div class="cook-title">${esc(r.title)}</div>
        <button class="btn" data-exit>Close</button>
      </div>
      <div class="row cook-bar">${sizeSelect('cook-size')}<span class="awake">${awake ? '☀️ Screen stays on' : 'Your screen may dim on this device'}</span></div>
      <div class="cook-body">
        <section><h2>Ingredients</h2>${ingredientList(r.ingredients, current.factor)}</section>
        <section><h2>Steps</h2><p class="muted small">Tap a step when it's done. Tap a time to start a timer.</p>
          <ol class="cook-steps">${(r.steps ?? []).map((step, i) => `<li data-step="${i}">${withTimers(step)}</li>`).join('') || '<li>No steps written yet.</li>'}</ol>
        </section>
      </div>`;
  };
  const close = () => {
    el.remove();
    document.body.classList.remove('cooking');
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-exit]')) return close();
    if (e.target.closest('[data-timer]')) return; // handled by the page-wide click handler
    const step = e.target.closest('[data-step]');
    if (step) step.classList.toggle('done');
  });
  el.addEventListener('change', (e) => {
    if (!e.target.matches('[data-size]')) return;
    current.factor = Number(e.target.value);
    const done = [...el.querySelectorAll('.cook-steps li.done')].map((li) => li.dataset.step);
    render();
    done.forEach((i) => el.querySelector(`[data-step="${i}"]`)?.classList.add('done'));
    refreshIngredients();
  });
  render();
}

// ---------- Timers ----------

const NUMBER = String.raw`\d+(?:\s*[½¼¾])?|[½¼¾]`;
const TIME_RE = new RegExp(String.raw`((?:${NUMBER})(?:\s*[–-]\s*(?:${NUMBER}))?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b(?:\s*(?:and\s+)?(\d+)\s*(minutes?|mins?))?`, 'gi');
const UNIT_SECONDS = { h: 3600, m: 60, s: 1 };

function toNumber(t) {
  const m = t.trim().match(/^(\d*)\s*([½¼¾]?)$/);
  return (m[1] ? Number(m[1]) : 0) + ({ '½': 0.5, '¼': 0.25, '¾': 0.75 }[m[2]] ?? 0);
}

// Turns "bake 25–30 minutes" into a tappable timer button (the longer time of a range).
function withTimers(text) {
  return esc(text).replace(TIME_RE, (match, amount, unit, extra) => {
    const upper = amount.split(/[–-]/).pop();
    let secs = toNumber(upper) * UNIT_SECONDS[unit[0].toLowerCase()];
    if (extra) secs += Number(extra) * 60;
    if (!secs) return match;
    return `<button class="timer-link" data-timer="${Math.round(secs)}" data-tlabel="${match}"><span class="ti">⏱ </span>${match}</button>`;
  });
}

const timers = [];
let timerTick = null;
let audio = null;

function fmt(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function beep() {
  try {
    const ctx = audio;
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.5);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.5 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.5);
      o.stop(ctx.currentTime + i * 0.5 + 0.4);
    }
  } catch { /* sound not available */ }
  navigator.vibrate?.([400, 200, 400, 200, 400]);
}

function renderTimers() {
  let bar = document.getElementById('timers');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'timers';
    document.body.appendChild(bar);
  }
  // Only the numbers change each second, so the ✕ buttons stay put and are easy to tap.
  for (const el of [...bar.children]) if (!timers.some((t) => t.id === el.dataset.id)) el.remove();
  for (const t of timers) {
    let el = bar.querySelector(`[data-id="${t.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'timer';
      el.dataset.id = t.id;
      el.innerHTML = `<span class="tl">${esc(t.recipe)} · ${esc(t.label)}</span><b></b><button data-stop-timer="${t.id}" aria-label="Stop timer">✕</button>`;
      bar.appendChild(el);
    }
    el.querySelector('b').textContent = t.left > 0 ? fmt(t.left) : 'Done!';
    el.classList.toggle('ring', t.left <= 0);
  }
  bar.style.display = timers.length ? '' : 'none';
}

function startTimer(secs, label) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch { /* no sound */ }
  timers.push({ id: crypto.randomUUID(), label, recipe: current?.recipe?.title ?? '', ends: Date.now() + secs * 1000, left: secs, rang: false });
  keepAwake();
  timerTick ??= setInterval(() => {
    for (const t of timers) {
      t.left = Math.max(0, Math.round((t.ends - Date.now()) / 1000));
      if (t.left === 0 && !t.rang) { t.rang = true; beep(); toast(`⏱ Time's up: ${t.label}`); }
    }
    renderTimers();
  }, 1000);
  renderTimers();
  toast(`Timer started: ${label}`);
}

function stopTimer(id) {
  const i = timers.findIndex((t) => t.id === id);
  if (i >= 0) timers.splice(i, 1);
  if (!timers.length) { clearInterval(timerTick); timerTick = null; }
  renderTimers();
}

// ---------- Share & print ----------

async function shareRecipe() {
  const r = current.recipe;
  const url = `${location.origin}/#/recipe/${r.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: r.title, text: r.title, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const box = document.createElement('div');
  box.className = 'zoom';
  box.innerHTML = `<div class="card pad share-box"><h3>Share "${esc(r.title)}"</h3>
    <div class="stack"><a class="btn primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${r.title} ${url}`)}">Send on WhatsApp</a>
    <button class="btn" data-copy="${esc(url)}">Copy link</button><button class="btn" data-close-box>Close</button></div></div>`;
  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-copy]')) {
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); }
      box.remove();
    } else if (e.target === box || e.target.closest('[data-close-box]')) box.remove();
  });
  document.body.appendChild(box);
}

// ---------- Add clippings (photo upload) ----------

// Reads "date taken" from a JPEG's EXIF data. Returns a Date or null.
async function photoTakenAt(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off), size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        const tiff = off + 10, little = v.getUint16(tiff) === 0x4949;
        const u16 = (o) => v.getUint16(o, little), u32 = (o) => v.getUint32(o, little);
        const readTag = (ifd, tag) => {
          const n = u16(ifd);
          for (let i = 0; i < n; i++) {
            const e = ifd + 2 + i * 12;
            if (u16(e) === tag) return e;
          }
          return null;
        };
        const ifd0 = tiff + u32(tiff + 4);
        const str = (e) => { const at = tiff + u32(e + 8); let s = ''; for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(at + i)); return s; };
        let e = null;
        const exifPtr = readTag(ifd0, 0x8769);
        if (exifPtr) e = readTag(tiff + u32(exifPtr + 8), 0x9003); // DateTimeOriginal
        e ??= readTag(ifd0, 0x0132); // DateTime
        if (!e) return null;
        const m = str(e).match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
        return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
      }
      off += 2 + size;
    }
  } catch { /* not a readable JPEG */ }
  return null;
}

const BATCH_MAX = 30;
const SAME_RECIPE_SECONDS = 30;
const INBOX_LIMIT_BYTES = 600 * 1024 * 1024; // keeps well inside the free 1 GB of storage
const EST_UPLOAD_BYTES = 800 * 1024;          // a typical photo after shrinking to reading size

// Photos are shrunk to about 2800 px before uploading: still sharp enough to read small print,
// but about a quarter of the size, so a whole album fits in the free storage.
let lastShape = null; // width/height of the last photo shrunk, used to spot screenshots

async function shrinkForReading(file) {
  lastShape = null;
  try {
    const bitmap = await createImageBitmap(file);
    lastShape = { width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, 2800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (blob) return blob;
  } catch { /* fall back to the original file */ }
  return file;
}

// A photo counts as already uploaded if one with the same "date taken" (to the second) was uploaded before.
async function alreadyUploaded() {
  const { data } = await db.from('uploads').select('taken_at,file_name,size_bytes');
  const keys = new Set();
  for (const u of data ?? []) {
    if (u.taken_at) keys.add(new Date(u.taken_at).getTime());
    keys.add(`${u.file_name}|${u.size_bytes}`);
  }
  return keys;
}

async function inboxBytesWaiting() {
  const { data } = await db.from('uploads').select('size_bytes').is('processed_at', null);
  return (data ?? []).length * EST_UPLOAD_BYTES;
}

// Splits photos (already in order) into batches of up to 30, never separating photos taken seconds apart.
function splitIntoBatches(photos) {
  const batches = [];
  let i = 0;
  while (i < photos.length) {
    let end = Math.min(i + BATCH_MAX, photos.length);
    if (end < photos.length) {
      let cut = end;
      while (cut > i + 1 && photos[cut].taken && photos[cut - 1].taken && (photos[cut].taken - photos[cut - 1].taken) / 1000 <= SAME_RECIPE_SECONDS) cut--;
      if (cut > i + 1) end = cut;
    }
    batches.push(photos.slice(i, end));
    i = end;
  }
  return batches;
}

async function nextBatchNumber() {
  const [b, u] = await Promise.all([db.from('batches').select('name'), db.from('uploads').select('batch')]);
  const names = [...(b.data ?? []).map((x) => x.name), ...(u.data ?? []).map((x) => x.batch)];
  return Math.max(0, ...names.map((n) => Number(n.match(/(\d+)/)?.[1] ?? 0))) + 1;
}

async function waitingList() {
  const { data } = await db.from('uploads').select('batch,uploaded_at,uploaded_by').is('processed_at', null).order('uploaded_at');
  const groups = new Map();
  for (const u of data ?? []) {
    const g = groups.get(u.batch) ?? { count: 0, at: u.uploaded_at, by: u.uploaded_by };
    g.count++;
    groups.set(u.batch, g);
  }
  return groups;
}

async function viewUpload() {
  const waiting = await waitingList();
  return `<h1>Add clippings</h1>
    <p class="muted">Tap the button and pick the recipe photos or screenshots. That's it: they're sent by themselves and show up in the cookbook by the next morning. Up to about 100 photos at a time works best.</p>
    <div class="card pad stack" id="upload-box">
      <label class="btn primary big" style="width:100%">📷 Choose photos<input type="file" id="photo-picker" class="photo-picker" accept="image/*,application/pdf" multiple hidden></label>
      <div id="upload-plan"></div>
    </div>
    <h2 class="section-head">Waiting to be read</h2>
    ${waiting.size ? `<form class="card pad stack" id="read-now-form" style="margin-bottom:14px">
      <div><b>Read them now</b> <span class="muted small">— instead of waiting for tonight. Only for the person with the 4-digit code; it uses Claude usage.</span></div>
      <div class="row">
        <input type="password" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" placeholder="Code" required style="width:110px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:1.1rem;letter-spacing:.3em" value="${esc(store('cookbook-read-code') ?? '')}">
        <button class="btn primary">⚡ Read now</button>
        <label class="small muted"><input type="checkbox" name="remember" ${store('cookbook-read-code') ? 'checked' : ''}> Remember on this device</label>
      </div>
      <div id="read-now-msg" class="small"></div>
    </form>` : ''}
    ${waiting.size ? `<div class="list">${[...waiting].map(([batch, g]) => `<div class="item"><div class="grow"><b>${esc(batch)}</b><div class="muted small">${g.count} photo${g.count === 1 ? '' : 's'} · uploaded ${new Date(g.at).toLocaleDateString()}${g.by ? ` by ${esc(g.by)}` : ''}</div></div><span class="badge" style="background:var(--warn-bg);color:var(--warn)">Waiting</span></div>`).join('')}</div>` : '<p class="empty">Nothing waiting. Everything uploaded so far has been read.</p>'}
    <h2 class="section-head">🔗 Add from a link</h2>
    <form class="card pad stack" id="link-form">
      <p class="muted small" style="margin:0">Paste a link to a recipe page (for example kosher.com). Most recipe websites come in word for word, instantly, and it's free.</p>
      <div class="row"><input type="url" name="url" placeholder="https://www.kosher.com/recipe/…" required style="flex:1;min-width:220px;padding:10px 12px;border:1px solid var(--line);border-radius:10px"><button class="btn primary">Get recipe</button></div>
      <div id="link-msg"></div>
    </form>
    <h2 class="section-head">📝 Paste recipe text</h2>
    <form class="card pad stack" id="paste-form">
      <p class="muted small" style="margin:0">For Instagram posts or messages: copy the recipe text and paste it here. Claude will sort it into ingredients and steps (added to the "waiting to be read" list).</p>
      <textarea name="text" rows="6" required placeholder="Paste the recipe here…" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px"></textarea>
      <label class="small">Picture (optional) <input type="file" name="photo" accept="image/*"></label>
      <div class="row"><button class="btn primary">Send to Claude</button></div>
    </form>
    <p class="muted small" style="margin-top:20px">Prefer typing a recipe in yourself? <a href="#/new">Type in a recipe</a>.</p>`;
}

let pendingPlan = null;
let uploadNote = '';
let pickedFromHome = null; // photos picked with the home page button, uploaded as soon as the Add page opens

// While the phone prepares the chosen photos (many photos can take minutes), show that it's working.
function showBusy(on) {
  let el = document.getElementById('busy');
  if (!el) {
    el = document.createElement('div');
    el.id = 'busy';
    el.innerHTML = '<div class="busy-card"><div class="spinner"></div><b>Getting your photos from the phone…</b><p>With a lot of photos this can take a few minutes. Please keep this screen open.</p></div>';
    document.body.appendChild(el);
  }
  el.style.display = on ? 'flex' : 'none';
}
document.addEventListener('click', (e) => { if (e.target.matches?.('input.photo-picker')) showBusy(true); });
document.addEventListener('cancel', (e) => { if (e.target.matches?.('input.photo-picker')) showBusy(false); }, true);

async function planUpload(files) {
  showBusy(false);
  const planEl = document.getElementById('upload-plan');
  planEl.innerHTML = '<p class="muted">Reading the photos…</p>';
  const photos = [];
  for (const [index, file] of [...files].entries()) {
    if (index % 25 === 0) planEl.innerHTML = `<p class="muted">Reading the photos… ${index} of ${files.length}</p>`;
    photos.push({ file, index, taken: await photoTakenAt(file) });
  }
  const known = await alreadyUploaded();
  const fresh = photos.filter((p) => !(p.taken && known.has(p.taken.getTime())) && !known.has(`${p.file.name}|${p.file.size}`));
  const skipped = photos.length - fresh.length;
  const allDated = fresh.every((p) => p.taken);
  fresh.sort((a, b) => (allDated ? a.taken - b.taken : 0) || a.index - b.index);
  const room = Math.max(0, Math.floor((INBOX_LIMIT_BYTES - await inboxBytesWaiting()) / EST_UPLOAD_BYTES));
  const later = Math.max(0, fresh.length - room);
  photos.length = 0;
  photos.push(...fresh.slice(0, room));
  if (!photos.length) {
    pendingPlan = null;
    planEl.innerHTML = skipped && !later
      ? `<p><b>All ${skipped} photos were already uploaded before.</b> Nothing new to add.</p>`
      : `<div class="banner warn">The inbox is full right now. Once the waiting photos have been read, choose the rest again (photos already uploaded are skipped automatically).</div>`;
    return;
  }
  const first = await nextBatchNumber();
  const batches = splitIntoBatches(photos).map((list, i) => ({ name: `Batch ${String(first + i).padStart(2, '0')}`, photos: list }));
  pendingPlan = batches;
  uploadNote = [skipped ? `${skipped} photo${skipped === 1 ? ' was' : 's were'} already in the cookbook and skipped.` : '', later ? `${later} more didn't fit yet; choose the same photos again in a few days and only the new ones go up.` : ''].filter(Boolean).join(' ');
  planEl.innerHTML = '';
  return runUpload();
}

async function runUpload() {
  const planEl = document.getElementById('upload-plan');
  const name = store('cookbook-name') || null;
  const all = pendingPlan.flatMap((b) => b.photos.map((p, i) => ({ ...p, batch: b.name, position: i + 1 })));
  const failed = [];
  await keepAwake();
  for (const [n, p] of all.entries()) {
    planEl.innerHTML = `<p class="big-status">Sending ${n + 1} of ${all.length}…<br><span class="muted small">Please keep this page open.</span></p><progress max="${all.length}" value="${n}" style="width:100%"></progress>`;
    const slug = p.batch.toLowerCase().replace(/\s+/g, '-');
    const blob = await shrinkForReading(p.file);
    const ext = blob === p.file ? (p.file.name.match(/\.(\w+)$/)?.[1] ?? 'jpg').toLowerCase() : 'jpg';
    // Screenshots (PNG, or phone-screen shaped) get "-shot" in the name so the cheaper model reads them.
    const tall = lastShape && Math.max(lastShape.width, lastShape.height) / Math.min(lastShape.width, lastShape.height) >= 2;
    const isShot = p.file.type === 'image/png' || (tall && !p.taken);
    const path = `inbox/${slug}/${String(p.position).padStart(3, '0')}-${Date.now()}${isShot ? '-shot' : ''}.${ext}`;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const up = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
      if (up.error && !/exists/i.test(up.error.message)) continue;
      const row = await db.from('uploads').insert({ batch: p.batch, path, file_name: p.file.name, size_bytes: p.file.size, taken_at: p.taken?.toISOString() ?? null, position: p.position, uploaded_by: name });
      ok = !row.error;
    }
    if (!ok) failed.push(p);
  }
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  pendingPlan = failed.length ? [{ name: failed[0].batch, photos: failed }] : null;
  if (failed.length) {
    planEl.innerHTML = `<div class="banner danger">${failed.length} photo${failed.length === 1 ? '' : 's'} didn't upload (the internet may have dropped).</div><button class="btn primary big" data-start-upload>Try again</button>`;
  } else {
    planEl.innerHTML = `<div class="done-box">✅ <b>Done! ${all.length} photo${all.length === 1 ? '' : 's'} sent.</b><br>The recipes will be in the cookbook by tomorrow morning.${uploadNote ? `<br><span class="muted small">${esc(uploadNote)}</span>` : ''}</div>`;
  }
}

// ---------- Router ----------

async function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query ?? '');
  const navKey = { search: 'search', labels: 'labels', label: 'labels', new: 'add', add: 'add', upload: 'add', more: 'more', help: 'more', trash: 'more' }[parts[0]] ?? 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  if (parts[0] !== 'new') imported = null;
  try {
    let html;
    switch (parts[0]) {
      case undefined: html = viewHome(); break;
      case 'section': html = viewSection(parts[1], params); break;
      case 'label': html = viewLabel(parts[1]); break;
      case 'labels': html = viewLabels(); break;
      case 'search': html = viewSearch(params); break;
      case 'recipe': app.innerHTML = '<p class="loading">Opening recipe…</p>'; html = await viewRecipe(parts[1], params); break;
      case 'edit': html = await viewEdit(parts[1]); break;
      case 'new': html = await viewEdit(null); break;
      case 'add': case 'upload': html = await viewUpload(); break;
      case 'more': html = viewMore(); break;
      case 'help': html = await viewHelp(); break;
      case 'trash': html = await viewTrash(); break;
      default: html = notFound();
    }
    app.innerHTML = html;
    if (pickedFromHome && document.getElementById('upload-plan')) { const files = pickedFromHome; pickedFromHome = null; planUpload(files); }
    if (parts[0] === 'search') {
      const input = document.getElementById('search');
      document.getElementById('results').innerHTML = searchResults(input.value);
      if (!input.value) input.focus();
    }
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    app.innerHTML = '<h1>Something went wrong</h1><p class="muted">Please check your internet connection and reload the page.</p>';
  }
}

// ---------- Actions (one click handler for the whole page) ----------

async function toggleLabel(recipeId, labelId) {
  const on = labelsOf(recipeId).has(labelId);
  const set = new Set(labelsOf(recipeId));
  on ? set.delete(labelId) : set.add(labelId);
  state.recipeLabels.set(recipeId, set);
  document.getElementById('label-chips').innerHTML = labelChips(recipeId);
  const q = on
    ? db.from('recipe_labels').delete().match({ recipe_id: recipeId, label_id: labelId })
    : db.from('recipe_labels').insert({ recipe_id: recipeId, label_id: labelId });
  const { error } = await q;
  if (error) {
    on ? set.add(labelId) : set.delete(labelId);
    document.getElementById('label-chips').innerHTML = labelChips(recipeId);
    return fail(error, 'change the label');
  }
  const name = state.labels.find((l) => l.id === labelId)?.name;
  toast(on ? `Removed from ${name}` : `Added to ${name}`);
}

async function createLabel(name) {
  name = name.trim();
  if (!name) return null;
  if (state.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) { toast('That label already exists'); return null; }
  const { data, error } = await db.from('labels').insert({ name }).select().single();
  if (error) { fail(error, 'create the label'); return null; }
  state.labels.push(data);
  state.labels.sort((a, b) => (b.built_in - a.built_in) || a.name.localeCompare(b.name));
  return data;
}

async function setRecipe(id, patch, message) {
  const { error } = await db.from('recipes').update(patch).eq('id', id);
  if (error) return fail(error, 'save that');
  await loadAll();
  toast(message);
  route();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a[data-del-note]');
  if (!t) {
    const img = e.target.closest('[data-zoom]');
    if (img) {
      const z = document.createElement('div');
      z.className = 'zoom';
      z.innerHTML = `<button class="btn close">Close</button><img src="${img.src}" alt="">`;
      z.addEventListener('click', () => z.remove());
      document.body.appendChild(z);
    }
    return;
  }
  const d = t.dataset;
  if (d.label) return toggleLabel(current.recipe.id, d.label);
  if ('newLabel' in d) {
    const label = await createLabel(prompt('Name of the new label (for example Pesach, Shabbos, Kids love it):') ?? '');
    if (label) await toggleLabel(current.recipe.id, label.id);
    return;
  }
  if (d.timer) return startTimer(Number(d.timer), d.tlabel);
  if (d.stopTimer) return stopTimer(d.stopTimer);
  if ('share' in d) return shareRecipe();
  if ('print' in d) return window.print();
  if ('addLabel' in d) {
    if (await createLabel(prompt('Name of the new label (for example Pesach, Shabbos, Kids love it):') ?? '')) { toast('Label created'); route(); }
    return;
  }
  if ('startUpload' in d) return runUpload();
  if (d.sendLink) {
    try {
      const batch = await addToInbox({ kind: 'link', url: d.sendLink });
      toast(`Sent to Claude (${batch})`);
      route();
    } catch (err) { fail(err, 'send the link'); }
    return;
  }
  if ('cancelUpload' in d) { pendingPlan = null; return route(); }
  if (d.pic) { current.pic = d.pic; document.getElementById('pics').innerHTML = picsHtml(current.recipe); return; }
  if ('cook' in d) return openCook();
  if (d.trash) {
    if (confirm('Move this recipe to the Trash? You can restore it later from More → Trash.')) await setRecipe(d.trash, { deleted_at: new Date().toISOString() }, 'Moved to Trash');
    return;
  }
  if (d.restore) return setRecipe(d.restore, { deleted_at: null }, 'Restored');
  if (d.resolve) return setRecipe(d.resolve, { needs_help: false, needs_help_reason: null }, 'Removed from the help list');
  if (d.dismiss) {
    const { error } = await db.from('help_items').update({ resolved_at: new Date().toISOString() }).eq('id', d.dismiss);
    if (error) return fail(error, 'update the list');
    await loadAll();
    return route();
  }
  if (d.delNote) {
    e.preventDefault();
    if (!confirm('Remove this note?')) return;
    const { error } = await db.from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', d.delNote);
    if (error) return fail(error, 'remove the note');
    current.notes = current.notes.filter((n) => n.id !== d.delNote);
    document.getElementById('notes').innerHTML = notesHtml();
    return;
  }
  if (d.rename) {
    const label = state.labels.find((l) => l.id === d.rename);
    const name = prompt('New name for this label:', label.name)?.trim();
    if (!name || name === label.name) return;
    const { error } = await db.from('labels').update({ name }).eq('id', label.id);
    if (error) return fail(error, 'rename the label');
    await loadAll();
    toast('Label renamed');
    return route();
  }
  if (d.deleteLabel) {
    const label = state.labels.find((l) => l.id === d.deleteLabel);
    if (!confirm(`Delete the label "${label.name}"? The recipes stay in the cookbook; only the label is removed.`)) return;
    const { error } = await db.from('labels').delete().eq('id', label.id);
    if (error) return fail(error, 'delete the label');
    await loadAll();
    toast('Label deleted');
    if (location.hash.startsWith('#/label/')) { location.hash = '#/'; return; }
    return route();
  }
  if ('backup' in d) return backup();
  if ('resetOriginal' in d) return resetToOriginal();
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'edit-form') return saveEdit(form);
  if (form.id === 'new-label') {
    if (await createLabel(form.name.value)) { toast('Label created'); route(); }
    return;
  }
  if (form.id === 'link-form') return importLink(form.url.value.trim());
  if (form.id === 'paste-form') {
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const batch = await addToInbox({ kind: 'text', text: form.text.value.trim() }, form.photo.files[0]);
      toast(`Sent to Claude (${batch})`);
      route();
    } catch (err) { fail(err, 'send the recipe'); button.disabled = false; }
    return;
  }
  if (form.id === 'read-now-form') {
    const pin = form.pin.value.trim();
    const msg = document.getElementById('read-now-msg');
    const button = form.querySelector('button');
    store('cookbook-read-code', form.remember.checked ? pin : '');
    button.disabled = true;
    msg.textContent = 'Checking…';
    try {
      const r = await fetch('/api/read-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const { status } = await r.json().catch(() => ({}));
      msg.innerHTML = {
        started: '✅ Claude started reading. New recipes usually show up within about an hour, and anything unclear goes on the "needs my help" list.',
        wrong_code: '❌ That code isn\'t right.',
        nothing_waiting: 'Nothing is waiting to be read.',
        already_running: '⏳ Claude is already reading photos right now. They\'ll show up soon.',
        not_set_up: 'The Read now button isn\'t set up yet (the code and Claude key still need to be added in Vercel).',
      }[status] ?? 'Something went wrong. Please try again in a few minutes.';
    } catch {
      msg.textContent = 'Couldn\'t reach the server. Check your internet and try again.';
    }
    button.disabled = false;
    return;
  }
  if (form.id === 'note-form') {
    const body = form.body.value.trim();
    const author = form.author.value.trim();
    if (!body) return;
    if (author) store('cookbook-name', author);
    const { data, error } = await db.from('notes').insert({ recipe_id: current.recipe.id, body, author_name: author || null }).select().single();
    if (error) return fail(error, 'save the note');
    current.notes.push(data);
    document.getElementById('notes').innerHTML = notesHtml();
    toast('Note saved');
  }
});

function refreshIngredients() {
  const box = document.getElementById('ingredients');
  if (box) box.innerHTML = ingredientList(current.recipe.ingredients, current.factor);
  const note = document.getElementById('scale-note');
  if (note) note.textContent = servingsNote(current.recipe, current.factor);
  const size = document.getElementById('size');
  if (size) size.value = String(current.factor);
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'size') { current.factor = Number(e.target.value); refreshIngredients(); }
  if (e.target.classList.contains('photo-picker') && e.target.files.length) {
    const files = [...e.target.files];
    if (!document.getElementById('upload-plan')) { pickedFromHome = files; location.hash = '#/add'; return; }
    planUpload(files);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  history.replaceState(null, '', `#/search${e.target.value ? `?q=${encodeURIComponent(e.target.value)}` : ''}`);
  document.getElementById('results').innerHTML = searchResults(e.target.value);
});

window.addEventListener('hashchange', route);

try {
  await loadAll();
  route();
} catch (e) {
  console.error(e);
  app.innerHTML = '<h1>Couldn\'t load the cookbook</h1><p class="muted">Please check your internet connection and reload the page.</p>';
}

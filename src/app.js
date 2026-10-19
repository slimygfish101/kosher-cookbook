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
    <h1>Our recipes</h1>
    <div class="tiles">${SECTIONS.map((s) => tile(`#/section/${s.key}`, s.name, state.recipes.filter((r) => r.section === s.key))).join('')}</div>
    <div class="spread section-head"><h2 style="margin:0">My labels</h2><a class="btn small" href="#/labels">Manage labels</a></div>
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
  return `<div class="spread"><h1>${label.name === 'Favorites' ? '❤️ ' : '🏷️ '}${esc(label.name)}</h1><a class="btn small" href="#/labels">Manage labels</a></div>
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
  const mode = params.get('in') ?? 'both';
  return `<h1>Search</h1>
    <input class="searchbox" id="search" type="search" placeholder="Recipe name or ingredients, e.g. salmon, or: chicken, lemon" value="${esc(q)}" autocomplete="off">
    <div class="chips filters" style="margin-top:10px">${[['both', 'Name & ingredients'], ['name', 'Name only'], ['ing', 'Ingredients only']].map(([k, name]) =>
      `<button class="chip ${mode === k ? 'on' : ''}" data-mode="${k}">${name}</button>`).join('')}</div>
    <p class="muted small">Tip: separate ingredients with commas to find recipes that use all of them.</p>
    <div id="results"></div>`;
}

function searchResults(q, mode) {
  const terms = q.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  if (!terms.length) return '';
  const list = state.recipes.filter((r) => {
    const name = r.title.toLowerCase();
    const ing = (r.ingredients ?? []).map((i) => i.text.toLowerCase()).join(' | ');
    return terms.every((t) => (mode !== 'ing' && name.includes(t)) || (mode !== 'name' && ing.includes(t)));
  });
  return `<p class="muted">${list.length} found</p>${grid(list, 'Nothing found. Try a shorter word.')}`;
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
        </div>
        ${r.description ? `<p class="desc">${esc(r.description)}</p>` : ''}
        <div class="panel">
          <div class="spread"><h2 style="margin:0">Ingredients</h2>
            <div class="scaler">${[[0.5, '½×'], [1, '1×'], [1.5, '1½×'], [2, '2×'], [3, '3×']].map(([f, l]) => `<button class="chip ${f === 1 ? 'on' : ''}" data-factor="${f}">${l}</button>`).join('')}</div>
          </div>
          <p class="muted small" id="scale-note" style="margin:6px 0 0">${servingsNote(r, 1)}</p>
          <div id="ingredients">${ingredientList(r.ingredients)}</div>
        </div>
        <div class="panel"><h2>Steps</h2><ol class="steps">${(r.steps ?? []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
        ${(r.tips ?? []).length ? `<div class="panel tips stack"><h2>Tips</h2>${r.tips.map((t) => `<div class="tip">${t.label ? `<b>${esc(t.label)}</b>` : ''}${esc(t.text)}</div>`).join('')}</div>` : ''}
        <div class="panel notes stack" id="notes">${notesHtml()}</div>
        ${r.deleted_at ? '' : `<div class="actions"><button class="btn small danger" data-trash="${r.id}">Move to Trash</button></div>`}
      </div>
    </div>`;
}

function servingsNote(r, factor) {
  if (factor === 1) return 'Tap 2× to double, ½× to halve. All amounts update.';
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
    ${drive.length ? `<p class="small muted">Full-size original${drive.length > 1 ? 's' : ''} in Google Drive: ${drive.map((d, i) => `<a href="${driveUrl(d)}" target="_blank" rel="noopener">photo ${i + 1}</a>`).join(' · ')}</p>` : ''}`;
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

async function viewEdit(id) {
  let r = { title: '', section: '', kosher_type: '', servings: null, servings_text: '', total_time: '', description: '', ingredients: [], steps: [], tips: [], credit: '' };
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
    ${id ? '<p class="muted">Change anything that was misread. The original reading is kept, so you can always undo.</p>' : '<p class="muted">Type a recipe in yourself. To add clippings from photos instead, put them in a new Drive batch folder and ask Claude to read it.</p>'}
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
    const food = f.get('food');
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
      row.source = 'typed';
      ({ data: saved } = await db.from('recipes').insert(row).select('id').single().throwOnError());
    }
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
  const steps = r.steps ?? [];
  let i = 0;
  let showIng = false;
  const el = document.createElement('div');
  el.className = 'cook';
  document.body.appendChild(el);
  const awake = await keepAwake();
  const render = () => {
    el.innerHTML = `
      <div class="cook-top"><div class="cook-title">${esc(r.title)}</div><button class="btn small" data-exit>Close</button></div>
      <div class="row" style="margin-top:10px"><button class="btn small" data-ing>${showIng ? 'Hide' : 'Show'} ingredients</button><span class="awake">${awake ? 'Screen will stay on' : 'Tip: your screen may dim on this device'}</span></div>
      ${showIng ? `<div class="ing-panel">${ingredientList(r.ingredients, current.factor)}</div>` : ''}
      <div class="step-no">Step ${i + 1} of ${steps.length}</div>
      <div class="step-text">${esc(steps[i] ?? 'No steps written yet.')}</div>
      <div class="cook-nav"><button class="prev" data-prev ${i === 0 ? 'disabled' : ''}>← Back</button><button class="next" data-next>${i >= steps.length - 1 ? 'Done ✓' : 'Next →'}</button></div>`;
  };
  const close = () => { el.remove(); wakeLock?.release().catch(() => {}); wakeLock = null; };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-exit]')) return close();
    if (e.target.closest('[data-ing]')) showIng = !showIng;
    if (e.target.closest('[data-prev]')) i = Math.max(0, i - 1);
    if (e.target.closest('[data-next]')) { if (i >= steps.length - 1) return close(); i++; }
    render();
  });
  render();
}

// ---------- Router ----------

async function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query ?? '');
  const navKey = { search: 'search', labels: 'labels', label: 'labels', new: 'new', more: 'more', help: 'more', trash: 'more' }[parts[0]] ?? 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
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
      case 'more': html = viewMore(); break;
      case 'help': html = await viewHelp(); break;
      case 'trash': html = await viewTrash(); break;
      default: html = notFound();
    }
    app.innerHTML = html;
    if (parts[0] === 'search') {
      const input = document.getElementById('search');
      document.getElementById('results').innerHTML = searchResults(input.value, params.get('in') ?? 'both');
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
  if (d.factor) {
    current.factor = Number(d.factor);
    document.querySelectorAll('[data-factor]').forEach((b) => b.classList.toggle('on', b === t));
    document.getElementById('ingredients').innerHTML = ingredientList(current.recipe.ingredients, current.factor);
    document.getElementById('scale-note').textContent = servingsNote(current.recipe, current.factor);
    return;
  }
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
    return route();
  }
  if ('backup' in d) return backup();
  if ('resetOriginal' in d) return resetToOriginal();
  if (d.mode) {
    const q = document.getElementById('search').value;
    history.replaceState(null, '', `#/search?in=${d.mode}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b === t));
    document.getElementById('results').innerHTML = searchResults(q, d.mode);
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'edit-form') return saveEdit(form);
  if (form.id === 'new-label') {
    if (await createLabel(form.name.value)) { toast('Label created'); route(); }
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

document.addEventListener('input', (e) => {
  if (e.target.id !== 'search') return;
  const mode = new URLSearchParams(location.hash.split('?')[1] ?? '').get('in') ?? 'both';
  history.replaceState(null, '', `#/search?in=${mode}${e.target.value ? `&q=${encodeURIComponent(e.target.value)}` : ''}`);
  document.getElementById('results').innerHTML = searchResults(e.target.value, mode);
});

window.addEventListener('hashchange', route);

try {
  await loadAll();
  route();
} catch (e) {
  console.error(e);
  app.innerHTML = '<h1>Couldn\'t load the cookbook</h1><p class="muted">Please check your internet connection and reload the page.</p>';
}

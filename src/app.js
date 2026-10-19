// Temporary page while the full app is being built: lists the saved recipes.
import { SUPABASE_URL, SUPABASE_KEY, SECTIONS } from './config.js';
const app = document.getElementById('app');
const res = await fetch(`${SUPABASE_URL}/rest/v1/recipes?select=title,section&deleted_at=is.null&order=title`, { headers: { apikey: SUPABASE_KEY } });
const recipes = await res.json();
app.innerHTML = `<h1>Family Cookbook</h1><p>The full app is on its way. ${recipes.length} recipes are saved so far:</p>` +
  SECTIONS.map((s) => {
    const list = recipes.filter((r) => r.section === s.key);
    return list.length ? `<h2>${s.name}</h2><ul>${list.map((r) => `<li>${r.title.replace(/</g, '&lt;')}</li>`).join('')}</ul>` : '';
  }).join('');

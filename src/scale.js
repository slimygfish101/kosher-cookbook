// Scaling ingredient amounts ("2½ cups", "1–2 tablespoons", "¼ cup + 2 tablespoons").

const FRACTION_CHARS = { '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\.\d+)?)`;
const RANGE = new RegExp(String.raw`${NUM}(?:\s*[–-]\s*${NUM})?`);
// Where an amount may appear: at the start, after "+ ", or in "Juice of 1 lemon" / "Zest from 1 lemon".
const LEADING = new RegExp(String.raw`^(\s*(?:(?:juice|zest)\s+(?:of|from)\s+)?)(${RANGE.source})`, 'i');
const AFTER_PLUS = new RegExp(String.raw`(\+\s*)(${RANGE.source})`, 'g');

export function parseNumber(s) {
  s = s.trim();
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  if ((m = s.match(/^(\d*)([½⅓⅔¼¾⅛⅜⅝⅞])$/))) return (m[1] ? +m[1] : 0) + FRACTION_CHARS[m[2]];
  return parseFloat(s);
}

const NICE = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];

export function formatNumber(x) {
  if (x >= 20) return String(Math.round(x));
  let whole = Math.floor(x);
  const frac = x - whole;
  let best = NICE[0];
  for (const n of NICE) if (Math.abs(n[0] - frac) < Math.abs(best[0] - frac)) best = n;
  if (best[0] === 1) { whole += 1; best = NICE[0]; }
  if (whole === 0 && !best[1]) return '⅛';
  return `${whole || ''}${best[1]}`;
}

function scaleRange(text, factor) {
  return text.replace(new RegExp(NUM, 'g'), (n) => formatNumber(parseNumber(n) * factor));
}

export function scaleIngredient(text, factor) {
  if (factor === 1) return text;
  let out = text.replace(LEADING, (_, pre, amt) => pre + scaleRange(amt, factor));
  out = out.replace(AFTER_PLUS, (_, pre, amt) => pre + scaleRange(amt, factor));
  return out;
}

// No imports, by design: everything here is a plain helper that works on its
// arguments. If something needs `state`, it belongs in state.js instead.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const key = (r, f) => r + '|' + f;
export const byNatural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

export function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), isErr ? 6000 : 2500);
}
export const friendly = e => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, '');

// A delimited line, respecting quotes, because a Revit schedule happily
// contains commas inside names. "" inside a quoted field is a literal quote.
export function splitDelimited(line, delim) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') { cur += c; continue; }
      if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Headers are matched loosely: case, spaces and punctuation don't have to
// agree with the column's label for a Revit export to line up.
export const normHeader = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export async function fetchAll(build) {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) return out;
  }
}

export function displayValue(f, v) {
  if (f?.type === 'checkbox') return v === 'true' ? '✓' : '';
  return v ?? '';
}
export function stamp(v) {
  if (!v?.updated_by) return '';
  return `Last changed by ${v.updated_by}, ${new Date(v.updated_at).toLocaleString()}`;
}

// Whether a stored value would still be accepted by a column of this shape.
export function valueFits(type, options, v) {
  if (type === 'number') return /^-?\d+(\.\d+)?$/.test(v);
  if (type === 'select') return options.includes(v);
  if (type === 'checkbox') return v === 'true' || v === 'false';
  return true;
}
export const typeNames = { text: 'Text', number: 'Number', select: 'Choose from a list', checkbox: 'Tick box' };

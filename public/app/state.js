// The single mutable `state` object, plus every read-only question you can ask
// about it. Nothing here touches the network or renders anything.
import { key, byNatural } from './util.js';

export const PALETTE = ['#2F6FB0', '#C46A1A', '#2E8B57', '#B03A48', '#7A55B5', '#1F8C8C', '#9C7A12', '#5A6B7B'];
export const app = document.getElementById('app');

export const state = {
  session: null, lastUserId: undefined,
  projectId: null, project: null, me: null,
  members: [], rooms: [], fields: [], values: new Map(),
  types: [], typeValues: new Map(), subject: 'rooms',
  sort: null, filters: new Map(), widths: {}, sheetAt: 0,
  disc: [], view: 'all', search: '', drawer: null, editField: null, editMember: null, selected: new Set(), cellA: null, cellB: null, channel: null,
  // Who else has this project open. Lives only as long as the tab does -- it
  // comes from the Realtime channel, never from the database.
  peers: new Map(),
};

export const myEmail = () => (state.session?.user?.email || '').toLowerCase();
export const isAdmin = () => state.me?.role === 'admin';
export const ALL_DISC = '*';
export const hasAllDisc = m => (m?.disciplines || []).includes(ALL_DISC);
// Mirrors can_edit_value() in SQL. The database is the authority; this only
// decides what to grey out, so the two must say the same thing.
export const canEdit = f => isAdmin()
  || (state.me?.role === 'consultant'
      && (hasAllDisc(state.me) || (state.me.disciplines || []).includes(f.discipline)));
// How a member's disciplines read in the UI, where "*" is a word, not a name.
export const discLabel = m => hasAllDisc(m)
  ? 'All disciplines'
  : (m?.disciplines || []).join(', ') || 'no disciplines';
export const currentProjectId = () => (location.hash.match(/^#p=([0-9a-f-]{36})$/) || [])[1] || null;

export const dColor = d => PALETTE[Math.max(0, state.disc.indexOf(d)) % PALETTE.length];

export function visibleFields() {
  const shown = state.fields.filter(f => !f.hidden);
  if (state.view === 'all') return shown;
  if (state.view === 'mine') return shown.filter(canEdit);
  return shown.filter(f => f.discipline === state.view);
}
// Built once per search, then asked about each room: scanning every value for
// every row would be O(rooms x values) on each keystroke.
export function searchMatch() {
  const q = state.search.trim().toLowerCase();
  if (!q) return () => true;
  if (state.subject === 'types') {
    const hit = new Set(state.types.filter(t => t.name.toLowerCase().includes(q)).map(t => t.id));
    state.typeValues.forEach(v => { if (String(v.value ?? '').toLowerCase().includes(q)) hit.add(v.type_id); });
    return id => hit.has(id);
  }
  const hit = new Set();
  state.values.forEach(v => { if (String(v.value ?? '').toLowerCase().includes(q)) hit.add(v.room_id); });
  state.typeValues.forEach(v => {
    if (!String(v.value ?? '').toLowerCase().includes(q)) return;
    state.rooms.forEach(r => { if (r.type_id === v.type_id) hit.add(r.id); });
  });
  return id => hit.has(id) || id.startsWith(q);
}
export function visibleRooms() {
  const ok = searchMatch();
  return state.rooms.filter(r => ok(r.id));
}
// Rooms are identified by their primary key. People see the first 8 characters of it.
export const shortId = r => r.id.slice(0, 8);
export const looksLikeRoomRef = s => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{8}$/i.test(String(s ?? '').trim());
export function roomByRef(ref) {
  const s = String(ref ?? '').trim().toLowerCase();
  if (!looksLikeRoomRef(s)) return null;
  const hits = state.rooms.filter(r => r.id === s || r.id.startsWith(s));
  return hits.length === 1 ? hits[0] : null;
}
// What to call a room in a message: the first frozen column's value, else its id.
export function roomLabel(r) {
  const first = frozenFields()[0];
  return (first && state.values.get(key(r.id, first.id))?.value) || shortId(r);
}
// Columns frozen beside the room id, left to right. `pin_order` is their own
// order, independent of where they would otherwise sit in the sheet.
// The column a pasted file is matched on, so a re-import updates rather than
// duplicates. Holds whatever the source system calls an id -- a Revit element
// id, say. The room's own primary key is still rooms.id.
export const keyField = () => state.fields.find(f => f.is_key) || null;

export const frozenFields = () => state.fields.filter(f => f.pin_order != null && !f.hidden)
  .slice().sort((a, b) => a.pin_order - b.pin_order);
// Every column in sheet order, frozen ones first. The Rooms drawer pastes against this.
// A room shows its own value if it has one, and its type's otherwise. An
// override is just an own value that differs from the type's -- nothing to keep
// in step, so the highlight can never disagree with the data.
// A type and its ancestors, nearest first. Guards against a loop even though
// the database has a trigger against one, because this runs on every cell.
export function typeChain(typeId) {
  const out = [], seen = new Set();
  let id = typeId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const t = state.types.find(x => x.id === id);
    if (!t) break;
    out.push(t);
    id = t.parent_id;
  }
  return out;
}

// The nearest ancestor that has something to say about this column.
export function inherited(typeId, f) {
  for (const t of typeChain(typeId)) {
    const v = state.typeValues.get(key(t.id, f.id));
    if (v?.value != null) return { value: v.value, src: v, from: t };
  }
  return null;
}

export const hasChildren = t => state.types.some(x => x.parent_id === t.id);
// Setting a value on a type with children sets it for everything beneath, so
// it takes more than ordinary rights. Mirrors can_edit_type_value() in SQL.
export const canEditType = (t, f) =>
  canEdit(f) && (isAdmin() || !hasChildren(t) || !!state.me?.edits_parent_types);

export function effectiveValue(r, f) {
  const own = state.values.get(key(r.id, f.id));
  const def = r.type_id ? inherited(r.type_id, f) : null;
  const ownVal = own?.value ?? null, defVal = def?.value ?? null;
  if (ownVal != null) return { value: ownVal, src: own, def: defVal, from: def?.from, overridden: defVal != null && defVal !== ownVal };
  return { value: defVal ?? '', src: def?.src, def: defVal, from: def?.from, inherited: defVal != null, overridden: false };
}

// A type's own cell inherits from its parent exactly as a room does from its type.
export function typeCell(t, f) {
  const own = state.typeValues.get(key(t.id, f.id));
  const def = t.parent_id ? inherited(t.parent_id, f) : null;
  const ownVal = own?.value ?? null, defVal = def?.value ?? null;
  if (ownVal != null) return { value: ownVal, src: own, def: defVal, from: def?.from, overridden: defVal != null && defVal !== ownVal };
  return { value: defVal ?? '', src: def?.src, def: defVal, from: def?.from, inherited: defVal != null, overridden: false };
}

// Depth-first, so the Types sheet reads as the tree it is. `depth` drives the
// indent; any type whose parent has vanished is shown at the top rather than lost.
export function typeTree(cmp) {
  const kids = new Map();
  state.types.forEach(t => {
    const k = t.parent_id && state.types.some(x => x.id === t.parent_id) ? t.parent_id : '';
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(t);
  });
  if (cmp) kids.forEach(list => list.sort(cmp));
  const out = [];
  const walk = (parent, depth) => (kids.get(parent) || []).forEach(t => {
    out.push({ ...t, depth });
    walk(t.id, depth + 1);
  });
  walk('', 0);
  return out;
}

// Types that may become `t`'s parent: anything that isn't itself or below it.
export function parentChoices(t) {
  const below = new Set([t.id]);
  let grew = true;
  while (grew) {
    grew = false;
    state.types.forEach(x => {
      if (!below.has(x.id) && below.has(x.parent_id)) { below.add(x.id); grew = true; }
    });
  }
  return typeTree().filter(x => !below.has(x.id));
}

// The grid draws either rooms or room types. Everything that differs between
// the two lives here, so there is one grid rather than two of them.
export function sheet() {
  const types = state.subject === 'types';
  return types ? {
    types: true, lead: 2, table: 'type_values', idCol: 'type_id', cache: state.typeValues,
    rows: () => typeTree(),
    label: t => t.name,
    cellOf: typeCell,
    mayEdit: canEditType,
  } : {
    types: false, lead: 2, table: 'room_values', idCol: 'room_id', cache: state.values,
    rows: () => state.rooms,
    label: r => roomLabel(r),
    cellOf: effectiveValue,
    mayEdit: (_r, f) => canEdit(f),
  };
}
export const rowById = id => sheet().rows().find(x => x.id === id);
export const typeName = id => state.types.find(t => t.id === id)?.name || '';

// What a cell actually reads as, inheritance included. Sorting and filtering
// both work off this, so a value inherited from a type sorts where it looks
// like it should rather than as a blank.
export const cellText = (row, f) => sheet().cellOf(row, f).value ?? '';

// Columns are addressed by field id, with two reserved keys for the fixed
// columns that aren't fields: the room's type, and a type's own name.
export function sortKey(row, k) {
  if (k === '__name') return row.name ?? '';
  if (k === '__type') return typeName(row.type_id);
  const f = state.fields.find(x => x.id === k);
  return f ? cellText(row, f) : '';
}

// Every active column filter has to pass. An empty set means "not filtered".
export function rowPasses(row) {
  for (const [k, allowed] of state.filters) {
    if (!allowed || !allowed.size) continue;
    if (!allowed.has(sortKey(row, k))) return false;
  }
  return true;
}

// Every row of the current sheet in display order. Filtering is applied by a
// class on the row rather than here, so that a filter stays a cheap repaint.
export function orderedRows() {
  const s = sheet();
  if (!state.sort) return s.rows();
  const { k, dir } = state.sort;
  const cmp = (a, b) => dir * byNatural(sortKey(a, k), sortKey(b, k));
  // Types are a tree, so sorting orders siblings among themselves rather than
  // flattening it: a child never leaves its parent, and the indent keeps
  // meaning what it says.
  return s.types ? typeTree(cmp) : s.rows().slice().sort(cmp);
}

// Which rows are on screen. On the Types sheet a row also stays if something
// beneath it matches, so a match is never left indented under a parent that
// the filter has hidden.
export function visibleIds() {
  const ok = searchMatch();
  const s = sheet();
  const rows = s.rows();
  const hit = new Set(rows.filter(r => ok(r.id) && rowPasses(r)).map(r => r.id));
  if (!s.types) return hit;
  const keep = new Set(hit);
  rows.forEach(r => {
    if (!hit.has(r.id)) return;
    typeChain(r.parent_id).forEach(t => keep.add(t.id));
  });
  return keep;
}

export function visibleRows() {
  const keep = visibleIds();
  return orderedRows().filter(r => keep.has(r.id));
}

// The distinct values in a column, for the filter list. Blank is a real
// choice: "everything with no department yet" is a question people ask.
export function columnValues(k) {
  const seen = new Set();
  sheet().rows().forEach(r => seen.add(sortKey(r, k)));
  return [...seen].sort(byNatural);
}

// How the sheet is set up for whoever is looking at it: which tab, which
// columns, how wide, sorted and filtered how. Per project and per browser --
// it is a view preference, not project data, so it does not belong in the
// database where it would be imposed on everyone else.
const uiKey = () => `roomdata:ui:${state.projectId}`;

function readUI() {
  try { return JSON.parse(localStorage.getItem(uiKey())) || {}; } catch { return {}; }
}

export function saveUI() {
  if (!state.projectId) return;
  const all = readUI();
  all.subject = state.subject;
  all[state.subject] = {
    view: state.view,
    sort: state.sort,
    filters: [...state.filters].map(([k, v]) => [k, [...v]]),
    widths: state.widths,
  };
  try { localStorage.setItem(uiKey(), JSON.stringify(all)); } catch { /* private window, full disk */ }
}

// Anything stored that no longer makes sense -- a discipline tab for a column
// set that has changed, a filter on a deleted column -- is left for the guards
// in loadProject to fix rather than trusted blindly.
export function applyUI(keepSubject) {
  const all = readUI();
  // On a deliberate tab switch the subject is already decided; only the
  // per-sheet preferences are wanted. On load, the stored tab is restored too.
  if (!keepSubject && ['types', 'rooms', 'sheet'].includes(all.subject)) state.subject = all.subject;
  const mine = all[state.subject] || {};
  state.view = mine.view || 'all';
  state.sort = mine.sort && mine.sort.k ? mine.sort : null;
  state.filters = new Map((mine.filters || []).map(([k, v]) => [k, new Set(v)]));
  state.widths = mine.widths && typeof mine.widths === 'object' ? mine.widths : {};
}

export const sortDir = k => (state.sort && state.sort.k === k ? state.sort.dir : 0);
export const isFiltered = k => !!state.filters.get(k)?.size;
export const anyFilters = () => [...state.filters.values()].some(s => s && s.size);

// Clicking a header cycles ascending, descending, back to the sheet's own order.
export function cycleSort(k) {
  const d = sortDir(k);
  state.sort = d === 0 ? { k, dir: 1 } : d === 1 ? { k, dir: -1 } : null;
  saveUI();
}

// Every column including hidden ones: hiding is about drawing, not about
// whether a paste can land in it. The Rooms drawer lists these.
export function sheetFields() {
  const froz = state.fields.filter(f => f.pin_order != null)
    .slice().sort((a, b) => a.pin_order - b.pin_order);
  return [...froz, ...state.fields.filter(f => f.pin_order == null)];
}

// Columns left to right exactly as the grid draws them: frozen ones, then the
// rest of whatever the current view shows.
export function gridColumns() {
  return [...frozenFields(), ...visibleFields().filter(f => f.pin_order == null)];
}

export const matchDisc = name => {
  if (name.trim() === ALL_DISC) return ALL_DISC;
  const n = name.trim();
  return state.disc.find(d => d.toLowerCase() === n.toLowerCase()) || n;
};

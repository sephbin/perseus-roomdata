// Drawing the sheet and everything that happens inside it: cells, the freeze
// zone, row selection and cell ranges. Owns its own drag state, which is why
// the drag listeners are wired here rather than in view.js.
import {
  state, isAdmin, canEdit, dColor, sheet, visibleFields, visibleRows,
  frozenFields, gridColumns, shortId, typeName, parentChoices,
  orderedRows, visibleIds, sortDir, isFiltered, cycleSort, columnValues, keyField, rowById,
  saveUI,
} from './state.js';
import { key, esc, displayValue, stamp } from './util.js';

// The first column shows whatever identifies a room to the people using it:
// the import key if one is set -- a Revit UniqueId, say -- and the first 8
// characters of the row's own primary key otherwise. The real id is always on
// hover and always leads the CSV export.
function handleText(r) {
  const kf = keyField();
  const v = kf ? state.values.get(key(r.id, kf.id))?.value : null;
  return (v != null && v !== '') ? v : shortId(r);
}
function handleTitle(r) {
  const kf = keyField();
  const v = kf ? state.values.get(key(r.id, kf.id))?.value : null;
  return (v != null && v !== '') ? `${kf.label}: ${v}  ·  Room id: ${r.id}` : r.id;
}

export function gridHTML() {
  const s = sheet();
  const froz = frozenFields();
  const fs = visibleFields().filter(f => f.pin_order == null), rs = orderedRows();
  const keep = visibleIds();
  if (!rs.length) {
    return s.types
      ? `<div class="empty"><h2>No room types yet</h2><p class="muted">${isAdmin()
          ? 'Add a type, fill in its values once, and every room you give that type picks them up.'
          : 'The project admin hasn’t added any room types yet.'}</p></div>`
      : `<div class="empty"><h2>No rooms yet</h2><p class="muted">${isAdmin()
          ? 'Open Rooms and paste your room list straight from Excel or Revit.'
          : 'The project admin hasn’t added any rooms yet.'}</p></div>`;
  }
  if (!fs.length && state.view === 'mine') {
    return `<div class="empty"><h2>No columns for you yet</h2><p class="muted">The project admin hasn’t added columns for ${esc((state.me?.disciplines || []).join(', '))}. Switch to All columns to see the rest of the sheet.</p></div>`;
  }

  // group header cells for consecutive fields of one discipline
  const groups = [];
  fs.forEach(f => {
    const last = groups[groups.length - 1];
    if (last && last.d === f.discipline) last.n++;
    else groups.push({ d: f.discipline, n: 1 });
  });
  const admin = isAdmin();

  // Clicking the label sorts; the caret opens the value list. Reserved keys
  // '__name' and '__type' address the two fixed columns that aren't fields.
  // The two fixed columns at the left aren't fields, so they get reserved keys
  // -- the same ones sorting uses.
  const leadKeys = s.types ? ['__name', '__parent'] : ['__code', '__type'];
  const colKeys = [...leadKeys, ...froz.map(f => f.id), ...fs.map(f => f.id)];
  const cols = `<colgroup>${colKeys.map(k =>
    `<col data-colkey="${k}" ${state.widths[k] ? `style="width:${state.widths[k]}px"` : ''}>`).join('')}${
    admin ? '<col>' : ''}</colgroup>`;

  const grip = k => `<span class="rsz" data-rsz="${k}" title="Drag to resize"></span>`;

  const headLabel = (k, label, extra = '') => {
    const d = sortDir(k);
    return `<button class="hsort" data-sort="${k}" title="Sort by ${esc(label)}">${esc(label)}${
      d ? `<span class="mark">${d > 0 ? '\u25b2' : '\u25bc'}</span>` : ''}</button>` +
      `<button class="hfilt ${isFiltered(k) ? 'on' : ''}" data-filter="${k}" aria-label="Filter ${esc(label)}">\u25be</button>${extra}${grip(k)}`;
  };

  const head = `
  <thead>
    <tr class="groups">
      ${s.types ? '<th class="stick c-type"></th>' : '<th class="stick c-code"></th>'}<th class="stick c-type"></th>
      ${froz.map((f, i) => `<th class="stick froz ${i === froz.length - 1 ? 'froz-last' : ''}" style="--dc:${dColor(f.discipline)}">${
        i && froz[i - 1].discipline === f.discipline ? '' : esc(f.discipline)}</th>`).join('')}
      ${groups.map((g, i) => `<th colspan="${g.n}" style="--dc:${dColor(g.d)}">${
        i === 0 && froz.length && froz[froz.length - 1].discipline === g.d ? '' : esc(g.d)}</th>`).join('')}
      ${admin ? '<th></th>' : ''}
    </tr>
    <tr class="labels">
      ${s.types
        ? `<th class="stick c-type">${headLabel('__name', 'Type')}</th><th class="stick c-type">Inherits from${grip('__parent')}</th>`
        : `<th class="stick c-code">Room${grip('__code')}</th><th class="stick c-type">${headLabel('__type', 'Room type')}</th>`}
      ${froz.map((f, i) => `<th class="stick froz ${i === froz.length - 1 ? 'froz-last' : ''} ${canEdit(f) ? '' : 'locked'}">${headLabel(f.id, f.label)}</th>`).join('')}
      ${fs.map(f => `<th class="${canEdit(f) ? '' : 'locked'}">${headLabel(f.id, f.label, f.type === 'select' ? '<small>Choose from list</small>' : '')}</th>`).join('')}
      ${admin ? '<th></th>' : ''}
    </tr>
  </thead>`;

  const leadCells = r => s.types
    ? `<td class="stick c-type ed"><input class="cell tname" data-type="${r.id}" value="${esc(r.name)}" aria-label="Type name" style="padding-left:${10 + (r.depth || 0) * 18}px" ${admin ? '' : 'readonly'}></td>`
      + `<td class="stick c-type ${admin ? 'ed' : 'ro'}">${admin
        ? `<select class="cell tparent" data-type="${r.id}" aria-label="Inherits from"><option value="">—</option>${parentChoices(r).map(x =>
            `<option value="${x.id}" ${x.id === r.parent_id ? 'selected' : ''}>${'\u00a0\u00a0'.repeat(x.depth)}${esc(x.name)}</option>`).join('')}</select>`
        : esc(typeName(r.parent_id))}</td>`
    : `<td class="stick c-code"><span class="tag" title="${esc(handleTitle(r))}">${esc(handleText(r))}</span></td>`
      + `<td class="stick c-type ${admin ? 'ed' : 'ro'}">${admin
        ? `<select class="cell rtype" data-room="${r.id}" aria-label="Room type"><option value=""></option>${state.types.map(t =>
            `<option value="${t.id}" ${t.id === r.type_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`
        : esc(typeName(r.type_id))}</td>`;

  const body = rs.map(r => `
    <tr data-room="${r.id}" class="${state.selected.has(r.id) ? 'sel' : ''} ${keep.has(r.id) ? '' : 'off'}">
      ${leadCells(r)}
      ${froz.map((f, i) => valueCell(r, f, 'stick froz ' + (i === froz.length - 1 ? 'froz-last' : ''))).join('')}
      ${fs.map(f => valueCell(r, f)).join('')}
      ${admin ? `<td class="act"><button data-del-${s.types ? 'type' : 'room'}="${r.id}" title="Delete ${esc(s.label(r))}" aria-label="Delete ${esc(s.label(r))}">✕</button></td>` : ''}
    </tr>`).join('');

  return `<table class="grid ${admin ? 'can-select' : ''}">${cols}${head}<tbody>${body}</tbody></table>
    <div class="empty" id="no-match" hidden><p class="muted">Nothing matches “<b></b>”.</p></div>`;
}

export function valueCell(r, f, cls = '') {
  const s = sheet();
  const eff = s.cellOf(r, f);
  const val = eff.value ?? '';
  const notes = [stamp(eff.src)];
  if (eff.overridden) notes.push(`Overrides ${eff.from ? eff.from.name : 'the type'}, which says “${eff.def}”`);
  else if (eff.inherited) notes.push(`From ${eff.from ? eff.from.name : 'the type'}`);
  const attrs = `data-r="${r.id}" data-f="${f.id}" title="${esc(notes.filter(Boolean).join(' · '))}"`;
  const label = `aria-label="${esc(s.label(r) + ' ' + f.label)}"`;
  cls += eff.overridden ? ' ovr' : '';
  if (!s.mayEdit(r, f)) {
    return `<td class="ro ${f.type === 'number' ? 'num' : ''} ${cls}" ${attrs}>${esc(displayValue(f, val))}</td>`;
  }
  switch (f.type) {
    case 'number':
      return `<td class="ed num ${cls}" ${attrs}><input class="cell" inputmode="decimal" value="${esc(val)}" ${label}></td>`;
    case 'select': {
      const opts = [...f.options];
      if (val && !opts.includes(val)) opts.unshift(val);
      return `<td class="ed ${cls}" ${attrs}><select class="cell" ${label}><option value=""></option>${opts.map(o =>
        `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>`;
    }
    case 'checkbox':
      return `<td class="ed chk ${cls}" ${attrs}><input type="checkbox" class="cell" ${val === 'true' ? 'checked' : ''} ${label}></td>`;
    default:
      return `<td class="ed ${cls}" ${attrs}><input class="cell" value="${esc(val)}" ${label}></td>`;
  }
}

// Sticky columns need an explicit left offset. Widths aren't known until the
// table is laid out, so measure the header and push the offsets onto every row.
export function layoutFrozen() {
  const table = document.querySelector('.grid');
  if (!table) return;
  const heads = [...table.querySelectorAll('thead tr.labels th.stick')];
  let x = 0;
  const lefts = heads.map(th => { const at = x; x += th.getBoundingClientRect().width; return at; });
  table.querySelectorAll('tr').forEach(tr => {
    [...tr.children].filter(c => c.classList.contains('stick'))
      .forEach((c, i) => { if (lefts[i] != null) c.style.left = lefts[i] + 'px'; });
  });

  // The labels row sticks directly below the discipline band row, whose height
  // depends on what is in it. Measured rather than assumed, for the same reason
  // the left offsets are.
  const band = table.querySelector('thead tr.groups');
  if (band) {
    const h = Math.round(band.getBoundingClientRect().height);
    table.querySelectorAll('thead tr.labels th').forEach(th => { th.style.top = h + 'px'; });
  }
}
export function paintGrid() {
  document.getElementById('grid-wrap').innerHTML = gridHTML();
  applyWidths();                       // also runs layoutFrozen
  paintSearch();
}

// Searching is a filter, not a different sheet, so it toggles one class per row
// instead of rebuilding 12,000 cells on every keystroke. Rooms that drop out of
// the search also drop out of the selection, so Delete can never reach a room
// that isn't on screen.
export function paintSearch() {
  const keep = visibleIds();
  let shown = 0;
  document.querySelectorAll('.grid tbody tr').forEach(tr => {
    const on = keep.has(tr.dataset.room);
    tr.classList.toggle('off', !on);
    if (on) shown++; else state.selected.delete(tr.dataset.room);
  });
  const none = document.getElementById('no-match');
  if (none) {
    none.hidden = !(state.rooms.length && !shown);
    none.querySelector('b').textContent = state.search;
  }
  paintSelection();
  paintRange();
}

// Selection changes during a drag, so it repaints the rows in place rather than
// rebuilding the grid -- rebuilding would lose the drag and the scroll position.
export function paintSelection() {
  document.querySelectorAll('.grid tbody tr').forEach(tr =>
    tr.classList.toggle('sel', state.selected.has(tr.dataset.room)));
  const bar = document.getElementById('selbar');
  if (!bar) return;
  const n = state.selected.size;
  bar.hidden = !n;
  document.getElementById('sel-count').textContent = `${n} room${n === 1 ? '' : 's'} selected`;
}

let dragFrom = null, dragging = false, dragKeep = null;
export const roomsBetween = (a, b) => {
  const order = visibleRows().map(r => r.id);
  const i = order.indexOf(a), j = order.indexOf(b);
  if (i < 0 || j < 0) return [];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
};
export const dragTo = id => {
  state.selected = new Set([...dragKeep, ...roomsBetween(dragFrom, id)]);
  paintSelection();
};
let cellDown = null, cellDragging = false;
addEventListener('mouseup', () => { dragging = false; cellDown = null; cellDragging = false; });
addEventListener('selectstart', e => { if (cellDragging) e.preventDefault(); });
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (state.selected.size) { state.selected = new Set(); paintSelection(); }
  if (state.cellA) clearRange();
});
addEventListener('resize', () => layoutFrozen());

// The selected rectangle, as rows of {room, field}. Anchor and focus are stored
// as ids rather than indices so a reload or a filter can't silently move them.
export function rangeCells() {
  if (!state.cellA || !state.cellB) return [];
  const rooms = visibleRows().map(r => r.id);
  const cols = gridColumns().map(f => f.id);
  const r1 = rooms.indexOf(state.cellA.room), r2 = rooms.indexOf(state.cellB.room);
  const c1 = cols.indexOf(state.cellA.field), c2 = cols.indexOf(state.cellB.field);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return [];
  const out = [];
  for (let i = Math.min(r1, r2); i <= Math.max(r1, r2); i++) {
    const row = [];
    for (let j = Math.min(c1, c2); j <= Math.max(c1, c2); j++) row.push({ room: rooms[i], field: cols[j] });
    out.push(row);
  }
  return out;
}

let rangePainted = [], rangeRowsPainted = [];
export function paintRange() {
  rangePainted.forEach(td => td.classList.remove('rng', 'rng-anchor'));
  rangeRowsPainted.forEach(tr => tr.classList.remove('rng-row'));
  rangePainted = [];
  rangeRowsPainted = [];
  const cells = rangeCells();
  if (!cells.length) return;
  const cols = gridColumns().map(f => f.id);
  const rows = new Map([...document.querySelectorAll('.grid tbody tr')].map(tr => [tr.dataset.room, tr]));
  for (const row of cells) {
    const tr = rows.get(row[0].room);
    if (!tr) continue;
    tr.classList.add('rng-row');              // band the whole row, faintly
    rangeRowsPainted.push(tr);
    for (const c of row) {
      const td = tr.children[cols.indexOf(c.field) + sheet().lead];
      if (!td) continue;
      td.classList.add('rng');
      if (c.room === state.cellA.room && c.field === state.cellA.field) td.classList.add('rng-anchor');
      rangePainted.push(td);
    }
  }
}
export const clearRange = () => { state.cellA = state.cellB = null; paintRange(); };

// Update one cell's override tint and tooltip, without touching its input --
// so this can run while the cell is being typed in.
export function markCell(rowId, fieldId) {
  const td = document.querySelector(`td[data-r="${rowId}"][data-f="${fieldId}"]`);
  const row = rowById(rowId), f = state.fields.find(x => x.id === fieldId);
  if (!td || !row || !f) return;
  const eff = sheet().cellOf(row, f);
  td.classList.toggle('ovr', !!eff.overridden);
  const notes = [stamp(eff.src)];
  if (eff.overridden) notes.push(`Overrides ${eff.from ? eff.from.name : 'the type'}, which says “${eff.def}”`);
  else if (eff.inherited) notes.push(`From ${eff.from ? eff.from.name : 'the type'}`);
  td.title = notes.filter(Boolean).join(' · ');
}

// One whole column, for when a type default moves what every row below it
// shows. Touching a few hundred cells beats rebuilding twenty thousand, and
// the cell someone is typing in is left alone.
// A specific list of cells, for when exactly which ones changed is known.
// Cheaper than a column, and far cheaper than a rebuild.
export function refreshCells(pairs) {
  const s = sheet();
  for (const { room, field } of pairs) {
    const td = document.querySelector(`td[data-r="${room}"][data-f="${field}"]`);
    const row = rowById(room), f = state.fields.find(x => x.id === field);
    if (!td || !row || !f) continue;
    const el = td.querySelector('.cell');
    const eff = s.cellOf(row, f);
    if (!el) td.textContent = displayValue(f, eff.value);
    else if (el !== document.activeElement) {
      if (el.type === 'checkbox') el.checked = eff.value === 'true';
      else el.value = eff.value ?? '';
    }
    markCell(room, field);
  }
}

export function refreshColumn(fieldId) {
  const f = state.fields.find(x => x.id === fieldId);
  if (!f) return;
  const s = sheet();
  document.querySelectorAll(`td[data-f="${fieldId}"]`).forEach(td => {
    const row = rowById(td.dataset.r);
    if (!row) return;
    const el = td.querySelector('.cell');
    if (el && el === document.activeElement) return;
    const eff = s.cellOf(row, f);
    if (el) {
      if (el.type === 'checkbox') el.checked = eff.value === 'true';
      else el.value = eff.value ?? '';
    } else {
      td.textContent = displayValue(f, eff.value);
    }
    markCell(td.dataset.r, fieldId);
  });
}

export function flash(td, cls) {
  td.classList.remove('saved', 'remote');
  void td.offsetWidth;
  td.classList.add(cls);
}

// Excel's column filter: the distinct values in that column, ticked or not.
// Rendered against <body> so it can't be clipped by the grid's own scrolling.
let filterKey = null;
export function closeFilter() {
  document.getElementById('filterpop')?.remove();
  filterKey = null;
}

export function openFilter(k, anchor) {
  closeFilter();
  filterKey = k;
  const chosen = state.filters.get(k) || new Set();
  const values = columnValues(k);
  const pop = document.createElement('div');
  pop.className = 'filterpop';
  pop.id = 'filterpop';
  pop.innerHTML = `
    <input type="search" class="fsearch" placeholder="Find a value" aria-label="Find a value">
    <label class="check all"><input type="checkbox" class="fall" ${chosen.size ? '' : 'checked'}> All</label>
    <ul class="flist">${values.map((v, i) => `
      <li><label class="check"><input type="checkbox" class="fval" data-i="${i}" ${
        !chosen.size || chosen.has(v) ? 'checked' : ''}> ${v === '' ? '<i>(blank)</i>' : esc(v)}</label></li>`).join('')}
    </ul>
    <div class="frow"><button class="fclear">Clear filter</button><button class="fdone primary">Done</button></div>`;
  document.body.appendChild(pop);

  const box = anchor.getBoundingClientRect();
  pop.style.left = Math.min(box.left, innerWidth - pop.offsetWidth - 12) + 'px';
  pop.style.top = (box.bottom + 4) + 'px';

  const boxes = () => [...pop.querySelectorAll('.fval')];
  const apply = () => {
    const ticked = boxes().filter(b => b.checked).map(b => values[+b.dataset.i]);
    if (ticked.length === values.length) state.filters.delete(k);
    else state.filters.set(k, new Set(ticked));
    pop.querySelector('.fall').checked = ticked.length === values.length;
    paintGrid();
  };
  pop.addEventListener('change', e => {
    if (e.target.classList.contains('fall')) {
      boxes().forEach(b => { if (!b.closest('li').hidden) b.checked = e.target.checked; });
    }
    apply();
  });
  pop.querySelector('.fsearch').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    boxes().forEach(b => {
      b.closest('li').hidden = !!q && !values[+b.dataset.i].toLowerCase().includes(q);
    });
  };
  pop.querySelector('.fclear').onclick = () => { state.filters.delete(k); paintGrid(); closeFilter(); };
  pop.querySelector('.fdone').onclick = () => closeFilter();
  pop.querySelector('.fsearch').focus();
}

addEventListener('mousedown', e => {
  if (!filterKey) return;
  if (e.target.closest('#filterpop') || e.target.closest('[data-filter]')) return;
  closeFilter();
});

// Dragging: down the room id column selects rows, across cells selects a range.
// Both mutate the module-level drag state above, so they live here.
// Column widths live on the <col> elements, so one write resizes the whole
// column without touching a cell. The frozen columns' left offsets are
// measured, so they have to be redone after every change.
export function applyWidths() {
  // A <col> width is only a hint in an auto-layout table -- the browser is free
  // to ignore it and size to content, which it does. Pinning min and max on the
  // header cell is what actually fixes the column.
  document.querySelectorAll('.grid thead tr.labels th').forEach(th => {
    const grip = th.querySelector('[data-rsz]');
    if (!grip) return;
    const w = state.widths[grip.dataset.rsz];
    th.style.width = th.style.minWidth = th.style.maxWidth = w ? w + 'px' : '';
  });
  layoutFrozen();
}

let resizing = null;
addEventListener('mousemove', e => {
  if (!resizing) return;
  state.widths[resizing.k] = Math.max(56, Math.round(resizing.w + (e.clientX - resizing.x)));
  applyWidths();
});
addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = null;
  document.body.classList.remove('resizing');
  saveUI();
});

export function wireGridDrag(g) {
  g.addEventListener('mousedown', e => {
    const grip = e.target.closest('[data-rsz]');
    if (!grip) return;
    e.preventDefault();
    e.stopPropagation();                 // not a cell drag, not a sort
    const th = grip.closest('th');
    resizing = { k: grip.dataset.rsz, x: e.clientX, w: th.getBoundingClientRect().width };
    document.body.classList.add('resizing');
  });

  g.addEventListener('click', e => {
    // Clicking the Room heading takes every row on screen, because dragging
    // through several hundred of them is not a reasonable thing to ask.
    const all = e.target.closest('th.c-code');
    if (all && isAdmin() && !sheet().types) {
      const ids = visibleRows().map(r => r.id);
      const already = ids.length && ids.every(id => state.selected.has(id));
      state.selected = already ? new Set() : new Set(ids);
      return paintSelection();
    }
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) { cycleSort(sortBtn.dataset.sort); return paintGrid(); }
    const filtBtn = e.target.closest('[data-filter]');
    if (filtBtn) {
      const k = filtBtn.dataset.filter;
      return filterKey === k ? closeFilter() : openFilter(k, filtBtn);
    }
  });

  // Drag down the room id column to select a run of rooms. Shift extends the
  // last run, ctrl (cmd) keeps what's already selected.
  g.addEventListener('mousedown', e => {
    const td = e.target.closest('td.c-code');
    if (!td || !isAdmin()) return;
    e.preventDefault();                       // no text selection while dragging
    const id = td.parentElement.dataset.room;
    dragKeep = (e.ctrlKey || e.metaKey) ? new Set(state.selected) : new Set();
    if (!(e.shiftKey && dragFrom)) dragFrom = id;
    dragging = true;
    dragTo(id);
  });
  g.addEventListener('mouseover', e => {
    if (!dragging) return;
    const td = e.target.closest('td.c-code');
    if (td) dragTo(td.parentElement.dataset.room);
  });

  // A drag that stays inside one cell is an ordinary text selection. Only once
  // the pointer crosses into a different cell does this take over and start
  // selecting a range -- so clicking into a cell and typing still works.
  g.addEventListener('mousedown', e => {
    const td = e.target.closest('td[data-f]');
    if (!td) return;
    const at = { room: td.dataset.r, field: td.dataset.f };
    if (e.shiftKey && state.cellA) {
      state.cellB = at;
      document.activeElement?.blur?.();   // the range, not a caret, is now the subject
    }
    else { state.cellA = at; state.cellB = at; }
    cellDown = at;
    paintRange();
  });
  g.addEventListener('mouseover', e => {
    if (!cellDown || !e.buttons) return;
    const td = e.target.closest('td[data-f]');
    if (!td || (td.dataset.r === cellDown.room && td.dataset.f === cellDown.field)) return;
    if (!cellDragging) {
      cellDragging = true;
      document.activeElement?.blur?.();
      getSelection()?.removeAllRanges?.();
    }
    state.cellB = { room: td.dataset.r, field: td.dataset.f };
    paintRange();
  });
}

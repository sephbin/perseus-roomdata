// Writes. Every one of these ends in a Supabase call: editing a cell, filling
// down, pasting a block, exporting. Validation lives here too, so a bad value
// is caught before the database has to reject it.
import { sb } from './client.js';
import {
  state, sheet, rowById, canEdit, typeName, visibleRows, visibleFields,
  frozenFields, gridColumns, myEmail,
} from './state.js';

import { key, toast, friendly, stamp, valueFits, normHeader } from './util.js';
import { flash, rangeCells, markCell, refreshColumn, refreshCells } from './grid.js';
import { loadProject } from './data.js';

// Using the copy/paste events rather than navigator.clipboard means no
// permission prompt, and a paste straight out of Excel arrives as plain TSV.
export const inFocusedCell = () => document.activeElement?.classList?.contains('cell');

addEventListener('copy', e => {
  const cells = rangeCells();
  if (!cells.length) return;
  // Text highlighted inside a cell is the user's own selection; leave it be.
  const el = document.activeElement;
  if (inFocusedCell() && el.selectionStart !== el.selectionEnd) return;
  const s = sheet();
  e.clipboardData.setData('text/plain', cells.map(row => row.map(c => {
    const f = state.fields.find(x => x.id === c.field);
    return (s.types ? s.cellOf({ id: c.room }, f) : s.cellOf(rowById(c.room) || { id: c.room }, f)).value ?? '';
  }).join('\t')).join('\n'));
  e.preventDefault();
  toast(`Copied ${cells.length} x ${cells[0].length} cell${cells.length * cells[0].length === 1 ? '' : 's'}`);
});

addEventListener('paste', e => {
  if (!state.cellA) return;
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  // A single value pasted into a cell you're editing is just an ordinary paste.
  if (!/[\t\r\n]/.test(text.trim()) && inFocusedCell()) return;
  e.preventDefault();
  pasteInto(text);
});

// Excel's Delete on a selection. Clearing here means the value row goes, the
// same as emptying one cell by hand -- so a room with a type goes back to
// following it rather than being left blank.
addEventListener('keydown', e => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const cells = rangeCells();
  if (!cells.length) return;
  // A single cell you're typing in is ordinary text editing, not a range.
  if (cells.length * cells[0].length < 2 && inFocusedCell()) return;
  e.preventDefault();
  clearCells();
});

export async function clearCells() {
  const s = sheet();
  const cells = rangeCells();
  if (!cells.length) return;
  const rowIds = cells.map(r => r[0].room);
  const colIds = cells[0].map(c => c.field);

  // Grouped by column, because on the Types sheet whether a cell may be edited
  // depends on the row as well as the column.
  const byField = new Map();
  let locked = 0, present = 0;
  for (const fid of colIds) {
    const f = state.fields.find(x => x.id === fid);
    if (!f) continue;
    const allowed = [];
    for (const rid of rowIds) {
      if (!s.mayEdit(rowById(rid) || { id: rid }, f)) { locked++; continue; }
      if ((s.cache.get(key(rid, fid))?.value ?? null) !== null) present++;
      allowed.push(rid);
    }
    if (allowed.length) byField.set(fid, allowed);
  }

  if (!present) return toast(locked
    ? `Nothing to clear: ${locked} cell${locked === 1 ? '' : 's'} you can’t edit`
    : 'Those cells are already empty', true);
  if (!confirm(`Clear ${present} cell${present === 1 ? '' : 's'}?`)) return;

  // Empty them on screen first. Reloading the project afterwards was what made
  // a delete sit there for a couple of seconds before anything looked cleared.
  const gone = [];
  for (const [fid, rows] of byField) {
    for (const rid of rows) {
      const k = key(rid, fid);
      if ((s.cache.get(k)?.value ?? null) === null) continue;
      s.cache.delete(k);
      gone.push({ room: rid, field: fid });
    }
  }
  // Clearing a type default moves everything beneath it, so those need the
  // whole column; a room's own cell can only have changed itself.
  if (s.types) [...byField.keys()].forEach(refreshColumn);
  else refreshCells(gone);
  toast(`Cleared ${present} cell${present === 1 ? '' : 's'}`
    + (locked ? `, left ${locked} alone` : ''));

  const results = await Promise.all([...byField].map(([fid, rows]) =>
    sb.from(s.table).delete().eq('field_id', fid).in(s.idCol, rows)));
  const bad = results.find(r => r.error);
  if (bad) {
    toast(friendly(bad.error), true);
    loadProject(state.projectId, true);   // resync rather than guess what stuck
  }
}

// Lays the clipboard out from the anchor cell, down and to the right.
export async function pasteInto(text) {
  const grid = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
  const s = sheet();
  const rooms = visibleRows().map(r => r.id);
  const cols = gridColumns();
  const top = rooms.indexOf(state.cellA.room), left = cols.findIndex(f => f.id === state.cellA.field);
  if (top < 0 || left < 0) return;

  const values = [];
  let locked = 0, unfit = 0, over = 0, past = 0;
  grid.forEach((line, i) => line.forEach((raw, j) => {
    const room = rooms[top + i], f = cols[left + j];
    if (!room || !f) { past++; return; }
    if (!s.mayEdit(rowById(room) || { id: room }, f)) { locked++; return; }
    let value = raw.trim() === '' ? null : raw.trim();
    if (value !== null && !valueFits(f.type, f.options, value)) { unfit++; return; }
    const already = s.cache.get(key(room, f.id))?.value;
    if (already != null && already !== '' && already !== value) over++;
    values.push({ [s.idCol]: room, field_id: f.id, value });
  }));

  if (!values.length) return toast(locked || unfit
    ? `Nothing pasted: ${locked ? `${locked} cell${locked === 1 ? '' : 's'} you can’t edit` : ''}${locked && unfit ? ', ' : ''}${unfit ? `${unfit} value${unfit === 1 ? ' doesn’t' : 's don’t'} suit their column` : ''}`
    : 'Nothing to paste', true);
  if (over && !confirm(`Paste over ${over} cell${over === 1 ? '' : 's'} that already ${over === 1 ? 'has' : 'have'} something in ${over === 1 ? 'it' : 'them'}?`)) return;

  const { error } = await sb.from(s.table).upsert(values, { onConflict: `${s.idCol},field_id` });
  if (error) return toast(friendly(error), true);
  const notes = [locked && `${locked} locked`, unfit && `${unfit} didn’t fit`, past && `${past} past the edge`].filter(Boolean);
  toast(`Pasted ${values.length} cell${values.length === 1 ? '' : 's'}${notes.length ? `, ${notes.join(', ')}` : ''}`);
  loadProject(state.projectId, true);
}

// Excel's Ctrl+D: push the value of the cell you're in down the same column,
// into every selected room. Refuses to fill with nothing, so a stray keystroke
// on an empty cell can't quietly wipe a column.
export async function fillDown(td) {
  const s = sheet();
  const f = state.fields.find(x => x.id === td.dataset.f);
  if (!f) return;
  if (s.types) return toast('Fill down works on the Instance tab', true);
  if (!canEdit(f)) return toast(`You can’t edit ${f.label}`, true);
  if (!state.selected.size) return toast('Select the rooms to fill first, by dragging down the room id column', true);
  const value = s.cellOf(rowById(td.dataset.r) || { id: td.dataset.r }, f).value || null;
  if (value == null || value === '') return toast('That cell is empty, so there’s nothing to fill down', true);

  const targets = state.rooms.filter(r => state.selected.has(r.id) && r.id !== td.dataset.r);
  if (!targets.length) return toast('Nothing to fill: that room is the only one selected', true);
  if (!confirm(`Put “${value}” into ${f.label} for ${targets.length} room${targets.length === 1 ? '' : 's'}?`)) return;

  const { error } = await sb.from('room_values')
    .upsert(targets.map(r => ({ room_id: r.id, field_id: f.id, value })), { onConflict: 'room_id,field_id' });
  if (error) return toast(friendly(error), true);
  targets.forEach(r => s.cache.set(key(r.id, f.id), {
    [s.idCol]: r.id, field_id: f.id, value,
    updated_by: myEmail(), updated_at: new Date().toISOString(),
  }));
  refreshColumn(f.id);
  toast(`Filled ${targets.length} cell${targets.length === 1 ? '' : 's'}`);
}

export function saveValue(td, el) {
  const s = sheet();
  const f = state.fields.find(x => x.id === td.dataset.f);
  const row = rowById(td.dataset.r);
  const k = key(td.dataset.r, f.id);
  const before = s.cache.get(k) || null;
  const prev = before?.value ?? null;
  let value = el.type === 'checkbox' ? String(el.checked) : el.value.trim();
  if (value === '') value = null;
  if (value === prev) {
    // Nothing of its own to change: put the inherited value back on screen.
    if (value === null && row) {
      const eff = s.cellOf(row, f);
      if (eff.value) el.value = eff.value;
    }
    return;
  }

  td.classList.remove('err');
  if (f.type === 'number' && value !== null && !/^-?\d+(\.\d+)?$/.test(value)) {
    td.classList.add('err');
    return toast(`${f.label} needs a number`, true);
  }

  // Emptying a cell drops the row rather than storing a blank, so a room goes
  // back to following its type. For a type, it simply stops having a default.
  if (value === null) {
    s.cache.delete(k);
    const back = row && !s.types ? s.cellOf(row, f) : null;
    if (back && back.inherited && el.type !== 'checkbox') el.value = back.value;
    refreshAfter(s, f, row);
    flash(td, 'saved');
    sb.from(s.table).delete().eq(s.idCol, td.dataset.r).eq('field_id', f.id)
      .then(({ error }) => {
        if (error) return undoCell(s, k, before, td, el, prev, f, row), toast(friendly(error), true);
      });
    return toast(back && back.inherited
      ? `Cleared, so it follows the ${typeName(row.type_id)} type again`
      : 'Cleared');
  }

  // Show it at once and let the request catch up. Waiting on a round trip
  // before the cell would even acknowledge the keystroke is what made editing
  // feel heavy, and a full repaint on top of that stole focus and scroll.
  s.cache.set(k, {
    [s.idCol]: td.dataset.r, field_id: f.id, value,
    updated_by: myEmail(), updated_at: new Date().toISOString(),
  });
  refreshAfter(s, f, row);
  flash(td, 'saved');

  sb.from(s.table)
    .upsert({ [s.idCol]: td.dataset.r, field_id: f.id, value }, { onConflict: `${s.idCol},field_id` })
    .select(`${s.idCol},field_id,value,updated_by,updated_at`).single()
    .then(({ data, error }) => {
      if (error) return undoCell(s, k, before, td, el, prev, f, row), toast(friendly(error), true);
      s.cache.set(k, data);
      markCell(td.dataset.r, f.id);
    });
}

// Editing a type default moves every row that follows it, so that column is
// refreshed; an ordinary cell can only have changed itself.
function refreshAfter(s, f, row) {
  if (s.types) refreshColumn(f.id);
  else markCell(row ? row.id : '', f.id);
}

function undoCell(s, k, before, td, el, prev, f, row) {
  if (before) s.cache.set(k, before); else s.cache.delete(k);
  if (el.type === 'checkbox') el.checked = prev === 'true'; else el.value = prev ?? '';
  td.classList.add('err');
  refreshAfter(s, f, row);
}

export function exportCSV() {
  const s = sheet();
  const rs = visibleRows();
  const fs = [...frozenFields(), ...visibleFields().filter(f => f.pin_order == null)];
  // If a column is itself called "Room id", the internal one is renamed so the
  // file can still be pasted back without the two headings meaning each other.
  const clash = state.fields.some(f => normHeader(f.label) === 'roomid');
  const head = s.types
    ? ['Type', ...fs.map(f => `${f.label} (${f.discipline})`)]
    : [clash ? 'Room id (internal)' : 'Room id', 'Room type', ...fs.map(f => `${f.label} (${f.discipline})`)];
  const rows = rs.map(r => (s.types ? [r.name] : [r.id, typeName(r.type_id)])
    .concat(fs.map(f => s.cellOf(r, f).value ?? '')));
  const cell = c => { const s = String(c ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [head, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${state.project.name.replace(/[^\w-]+/g, '_')}_${state.view.replace(/[^\w-]+/g, '_')}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

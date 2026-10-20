// The admin drawers: rooms, columns, people. Each one renders its markup and
// then wires it, so the two halves stay next to each other.
import { sb } from './client.js';
import {
  state, isAdmin, canEdit, myEmail, dColor, frozenFields, sheetFields, matchDisc, roomByRef,
  keyField, discLabel, hasAllDisc, ALL_DISC, saveUI,
} from './state.js';
import { key, esc, byNatural, toast, friendly, typeNames, valueFits, splitDelimited, normHeader } from './util.js';
import { loadProject } from './data.js';
import { paintGrid } from './grid.js';

export function renderDrawer(kind) {
  state.drawer = kind;
  const d = document.getElementById('drawer');
  const discList = `<datalist id="disc-list">${state.disc.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  let html = '';

  if (kind === 'rooms') {
    const byHeaderNames = new Set(state.fields.map(f => normHeader(f.label)));
    const pin = frozenFields()[0];
    const typed = pin && pin.type !== 'checkbox' && pin.type !== 'select';
    const cols = sheetFields();
    html = `
      <h3>Add one room</h3>
      <form id="f-room">
        ${typed ? `<input name="pinned" placeholder="${esc(pin.label)}, e.g. L2-014">` : ''}
        <button class="primary">Add room</button>
      </form>
      <h3>Paste many rooms</h3>
      <form id="f-paste">
        <p class="hint">Paste from Excel or a Revit schedule, <b>including the header row</b> — columns are matched by their headings, in any order, and headings that don't match a column are skipped. Tab or comma separated, quotes respected.<br>
        ${keyField()
          ? `Rows are matched on <b>${esc(keyField().label)}</b>: a row whose value is already here updates that room, anything else is added. `
          : `Every row is added as a new room. To update rooms instead, mark a column as the import key in <b>Columns</b> — a Revit element id, say. `}
        A <b>Room id</b> heading also works, matching on the room's own id as the CSV export writes it.</p>
        <p class="hint">A <b>Room type</b> column assigns each room to a type by name — the type has to exist already, so paste the types first if they don't. Anything else in the row stays as an override of what the type says.</p>
        <label for="paste-dest">Load into</label>
        <select id="paste-dest" name="dest">
          <option value="rooms">Instance — one row per room</option>
          <option value="types">Types — one row per room type</option>
        </select>
        <p class="hint">Into <b>Types</b>, a type is identified by its name, so give that column the heading <b>Type</b>: a name already here updates that type, a new one is created. An <b>Inherits from</b> column may name another type as its parent. ${
          byHeaderNames.has('type') ? '<b>Note:</b> this project has a column called “Type”, and a column you made always wins — rename it, or that heading will not set the type name. ' : ''}Values land on the type, so every room of that type picks them up.</p>
        <textarea name="text" placeholder="${['Room id', ...cols.map(f => f.label)].slice(0, 4).map(f => esc(f)).join('\t')}&#10;..."></textarea>
        <button class="primary">Add</button>
      </form>
      <p class="hint" style="margin-top:16px">${state.rooms.length} rooms on this project. A room is identified by its own id, so nothing you type here has to be unique. Edit the sheet directly, or change the columns in <b>Columns</b>.</p>`;
  }

  if (kind === 'columns') {
    const grouped = state.disc.map(dd => [dd, state.fields.filter(f => f.discipline === dd)]).filter(([, fs]) => fs.length);
    const froz = frozenFields();
    html = `
      <h3>Add a column</h3>
      <!-- novalidate so our own message is what people see: the browser's
           bubble is easy to miss in a scrolled drawer, and every other form
           here reports problems as a toast. required stays for the semantics. -->
      <form id="f-field" novalidate>
        <label for="fld-label">Column name</label>
        <input id="fld-label" name="label" placeholder="e.g. Lux level" required>
        <label for="fld-disc">Discipline</label>
        <input id="fld-disc" name="discipline" placeholder="e.g. Electrical" list="disc-list" required>
        <p class="hint">Every column belongs to a discipline, which is what decides who may edit it. Pick an existing one from the list or type a new one — a new one becomes its own band on the sheet.</p>
        <select name="type">
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="select">Choose from a list</option>
          <option value="checkbox">Tick box</option>
        </select>
        <input name="options" placeholder="List choices, separated by commas" hidden>
        <button class="primary">Add column</button>
      </form>
      ${discList}
      <p class="hint">Hiding a column keeps its values and still lets a paste land in it — handy for an id column you need but don’t want to read across. Every column lives here, the room’s own code and level included. Delete the ones this job doesn’t use — a schedule run by room type probably has no area per room. The order below is the order of the sheet in <b>All columns</b>.</p>
      ${froz.length ? `<h3>Frozen beside the room id</h3>
      <ul class="list">${froz.map((f, i) => `
        <li><span class="grow">${esc(f.label)}<small>${esc(f.discipline)}</small></span>
          <button class="move" data-pinup-field="${f.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(f.label)} left">↑</button>
          <button class="move" data-pindown-field="${f.id}" ${i === froz.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(f.label)} right">↓</button>
          <button data-unpin-field="${f.id}">Unfreeze</button></li>`).join('')}
      </ul>
      <p class="hint">These stay put in this order while the sheet scrolls sideways. Freeze another one from its <b>Edit</b> panel below.</p>` : ''}
      <h3>Columns</h3>
      <ul class="list">
        <li class="${state.hideRoomId ? 'ishidden' : ''}"><span class="grow">Room<small>The room’s own id · always present${state.hideRoomId ? ' · hidden' : ''}</small></span>
          <button data-toggle-roomid aria-label="${state.hideRoomId ? 'Show' : 'Hide'} the Room column">${state.hideRoomId ? 'Show' : 'Hide'}</button></li>${grouped.map(([dd, fs], gi) => `
        <li class="group" style="--dc:${dColor(dd)}"><span class="dot"></span><span class="grow">${esc(dd)}</span>
          <button class="move" data-disc-up="${esc(dd)}" ${gi === 0 ? 'disabled' : ''} aria-label="Move ${esc(dd)} left">↑</button>
          <button class="move" data-disc-down="${esc(dd)}" ${gi === grouped.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(dd)} right">↓</button></li>
        ${fs.map((f, i) => state.editField === f.id ? `
          <li class="editing"><form class="f-edit" data-id="${f.id}">
            <input name="label" value="${esc(f.label)}" aria-label="Column name" required>
            <input name="discipline" value="${esc(f.discipline)}" list="disc-list" aria-label="Discipline" required>
            <select name="type" aria-label="Type">${Object.entries(typeNames).map(([t, n]) =>
              `<option value="${t}" ${t === f.type ? 'selected' : ''}>${n}</option>`).join('')}</select>
            <input name="options" value="${esc(f.options.join(', '))}" placeholder="List choices, separated by commas" ${f.type === 'select' ? '' : 'hidden'}>
            <label class="check"><input type="checkbox" name="pinned" ${f.pin_order != null ? 'checked' : ''}> Freeze beside the room id</label>
            <label class="check"><input type="checkbox" name="is_key" ${f.is_key ? 'checked' : ''}> Use as the import key, matched when pasting</label>
            <div class="row"><button class="primary">Save</button><button type="button" data-cancel-edit>Cancel</button></div>
            <button type="button" class="danger" data-del-field="${f.id}">Delete this column</button>
          </form></li>` : `
          <li class="${f.hidden ? 'ishidden' : ''}"><span class="grow">${esc(f.label)}<small>${{ text: 'Text', number: 'Number', select: 'List: ' + esc(f.options.join(', ')), checkbox: 'Tick box' }[f.type]}${f.pin_order != null ? ' · frozen' : ''}${f.is_key ? ' · import key' : ''}${f.hidden ? ' · hidden' : ''}</small></span>
            <button class="move" data-up-field="${f.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(f.label)} left">↑</button>
            <button class="move" data-down-field="${f.id}" ${i === fs.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(f.label)} right">↓</button>
            <button data-hide-field="${f.id}" aria-label="${f.hidden ? 'Show' : 'Hide'} ${esc(f.label)}">${f.hidden ? 'Show' : 'Hide'}</button>
            <button data-edit-field="${f.id}">Edit</button></li>`).join('')}`).join('') || '<li class="muted">No columns yet.</li>'}
      </ul>`;
  }

  if (kind === 'people') {
    html = `
      ${discList}
      <h3>Add someone</h3>
      <form id="f-member">
        <input name="email" type="email" placeholder="Their email" required>
        <select name="role">
          <option value="consultant">Consultant: edits their discipline’s columns</option>
          <option value="viewer">Viewer: sees everything, edits nothing</option>
          <option value="admin">Admin: manages rooms, columns and people</option>
        </select>
        <input name="disciplines" placeholder="Disciplines, separated by commas" list="disc-list">
        <label class="check"><input type="checkbox" name="all_disc"> Every discipline</label>
        <p class="hint">Every discipline lets a consultant edit the whole sheet without the right to manage rooms, columns and people — for a project architect, say. It covers columns added later, too.</p>
        <label class="check"><input type="checkbox" name="edits_parent_types"> Can edit shared room types</label>
        <p class="hint">A room type with others beneath it sets values for all of them, so editing one needs this. Admins always can.</p>
        <p class="hint">${state.disc.length ? 'Existing disciplines: ' + esc(state.disc.join(', ')) + '. ' : ''}Adding someone here doesn’t create a sign-in or send them anything — it puts their address on this project. Send them the link yourself.</p>
        <button class="primary">Add person</button>
      </form>
      <h3>People on this project</h3>
      <ul class="list">${state.members.slice().sort((a, b) => byNatural(a.email, b.email)).map(m => state.editMember === m.email ? `
        <li class="editing"><form class="f-edit-member" data-email="${esc(m.email)}">
          <span class="grow">${esc(m.email)}</span>
          <select name="role" aria-label="Role">
            <option value="consultant" ${m.role === 'consultant' ? 'selected' : ''}>Consultant: edits their discipline’s columns</option>
            <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>Viewer: sees everything, edits nothing</option>
            <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin: manages rooms, columns and people</option>
          </select>
          <input name="disciplines" value="${esc(hasAllDisc(m) ? '' : m.disciplines.join(', '))}" list="disc-list" placeholder="Disciplines, separated by commas" aria-label="Disciplines">
          <label class="check"><input type="checkbox" name="all_disc" ${hasAllDisc(m) ? 'checked' : ''}> Every discipline</label>
          <label class="check"><input type="checkbox" name="edits_parent_types" ${m.edits_parent_types ? 'checked' : ''}> Can edit shared room types</label>
          <div class="row"><button class="primary">Save</button><button type="button" data-cancel-member>Cancel</button></div>
          <button type="button" class="danger" data-del-member="${esc(m.email)}">Remove from this project</button>
        </form></li>` : `
        <li><span class="grow">${esc(m.email)}<small>${m.role === 'consultant' ? 'Consultant: ' + esc(discLabel(m)) : m.role === 'admin' ? 'Admin' : 'Viewer'}${
          m.role === 'consultant' && m.edits_parent_types ? ' · edits shared types' : ''}</small></span>
        ${m.email === myEmail()
          ? '<span class="muted">You</span>'
          : `<button data-edit-member="${esc(m.email)}">Edit</button>`}</li>`).join('')}
      </ul>
      <p class="hint">You can’t change or remove your own row — that’s what stops a project losing its last admin. Another admin can.</p>`;
  }

  const titles = { rooms: 'Rooms', columns: 'Columns', people: 'People' };
  d.innerHTML = `<header><h2>${titles[kind]}</h2><button class="link" id="close-drawer">Close</button></header>${html}`;
  d.hidden = false;
  document.getElementById('close-drawer').onclick = () => { d.hidden = true; state.drawer = null; };
  wireDrawer();
}

// Two pasted rows can land on the same cell: the same type named twice, or two
// rows sharing an import key. Postgres refuses an upsert that touches one row
// twice -- "ON CONFLICT DO UPDATE command cannot affect row a second time" --
// and takes the whole paste down with it, so the last value quietly wins here
// instead. Last rather than first because that is how a spreadsheet behaves.
const dedupeCells = (rows, keyOf) => {
  const seen = new Map();
  rows.forEach(r => seen.set(keyOf(r), r));
  return [...seen.values()];
};

// Pasting into Types rather than Instance. A type is identified by its name --
// unique per project -- so the name does the job the room id does on the other
// sheet: a name already here updates that type, anything else creates one.
// Values land in type_values, which is the point of doing it this way: fill a
// type once and every room of that type follows.
async function pasteTypes(map, lines, unknown, after, pid) {
  const nameAt = map.findIndex(m => m && m.typeName);
  if (nameAt < 0) {
    return toast('Give one column the heading Type, holding the type name — that is what identifies a type.', true);
  }
  const parentAt = map.findIndex(m => m && m.parent);

  // Matched without regard to case or surrounding space, because a name typed
  // by hand in Excel and the same name in the sheet rarely agree on either.
  const norm = v => String(v ?? '').trim().toLowerCase();
  const byName = new Map(state.types.map(t => [norm(t.name), t]));

  let noName = 0;
  const entries = [];
  for (const cells of lines) {
    const name = String(cells[nameAt] ?? '').trim();
    if (!name) { noName++; continue; }            // a type with no name is nothing
    entries.push({ name, type: byName.get(norm(name)) || null, cells });
  }
  if (!entries.length) return toast('No rows had a type name in them.', true);

  // Two rows naming the same new type are one type, not two -- otherwise the
  // unique index would reject the second and take the whole paste with it.
  const fresh = [];
  const claimed = new Map();
  for (const x of entries) {
    if (x.type) continue;
    const seen = claimed.get(norm(x.name));
    if (seen) { x.twin = seen; continue; }
    claimed.set(norm(x.name), x);
    fresh.push(x);
  }

  let order = Math.max(0, ...state.types.map(t => t.sort_order || 0));
  if (fresh.length) {
    const { data, error } = await sb.from('room_types')
      .insert(fresh.map(x => ({ project_id: pid, name: x.name, sort_order: ++order })))
      .select('id,name');
    if (error) return toast(friendly(error), true);
    const made = new Map(data.map(t => [norm(t.name), t]));
    fresh.forEach(x => (x.type = made.get(norm(x.name)) || null));
    entries.forEach(x => { if (!x.type && x.twin) x.type = x.twin.type; });
  }

  // Parents are resolved only once every type exists, so a child may appear
  // above its parent in the paste without it mattering.
  let noParent = 0;
  if (parentAt >= 0) {
    const all = new Map([...byName]);
    entries.forEach(x => x.type && all.set(norm(x.name), x.type));
    const moves = [];
    for (const x of entries) {
      const want = String(x.cells[parentAt] ?? '').trim();
      if (!x.type || !want) continue;
      const parent = all.get(norm(want));
      if (!parent) { noParent++; continue; }
      if (parent.id === x.type.id) { noParent++; continue; }   // its own parent
      moves.push({ id: x.type.id, parent_id: parent.id });
    }
    // One at a time: the database has a trigger against loops and will refuse
    // the offending row, which should not cost the rest their parent.
    for (const m of moves) {
      const { error } = await sb.from('room_types').update({ parent_id: m.parent_id }).eq('id', m.id);
      if (error) noParent++;
    }
  }

  const values = [];
  let skipped = 0;
  for (const x of entries) {
    if (!x.type) continue;
    x.cells.forEach((raw, i) => {
      const f = map[i] && map[i].field;
      if (!f || raw === '') return;
      let value = raw;
      if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) return skipped++;
      if (f.type === 'select' && !f.options.includes(value)) return skipped++;
      if (f.type === 'checkbox') value = /^(y|yes|true|1|x)$/i.test(value) ? 'true' : 'false';
      values.push({ type_id: x.type.id, field_id: f.id, value });
    });
  }
  if (values.length) {
    const { error } = await sb.from('type_values')
      .upsert(dedupeCells(values, v => v.type_id + '|' + v.field_id), { onConflict: 'type_id,field_id' });
    if (error) return toast(friendly(error), true);
  }

  // Land on the sheet that now holds the result, or it reads as nothing having
  // happened -- the same trap as adding a column to a band you aren't viewing.
  state.subject = 'types';
  saveUI();
  after(`${fresh.length} types added, ${entries.length - fresh.length} updated`
    + (skipped ? `, ${skipped} cells skipped` : '')
    + (noName ? `, ${noName} rows had no name` : '')
    + (noParent ? `, ${noParent} parents not matched` : '')
    + (unknown.length ? `, ignored ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? `, +${unknown.length - 3} more` : ''}` : ''));
}

export function wireDrawer() {
  const pid = state.projectId;
  const after = msg => { toast(msg); loadProject(pid, true); };

  document.getElementById('f-room')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { data, error } = await sb.from('rooms').insert({
      project_id: pid,
      sort_order: Math.max(0, ...state.rooms.map(r => r.sort_order)) + 1,
    }).select('id').single();
    if (error) return toast(friendly(error), true);
    const pin = frozenFields()[0], first = (fd.get('pinned') || '').trim();
    if (pin && first) {
      const { error: vErr } = await sb.from('room_values')
        .upsert({ room_id: data.id, field_id: pin.id, value: first }, { onConflict: 'room_id,field_id' });
      if (vErr) return toast(friendly(vErr), true);
    }
    after('Room added');
  });

  document.getElementById('f-paste')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const toTypes = fd.get('dest') === 'types';
    const raw = fd.get('text').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if (!raw.trim()) return toast('Nothing to paste.', true);
    const delim = raw.split('\n')[0].includes('\t') ? '\t' : ',';
    const lines = raw.split('\n').filter(l => l.trim()).map(l => splitDelimited(l, delim));

    // The first row names the columns. Anything that doesn't match a column is
    // reported and skipped rather than guessed at by position.
    const byHeader = new Map(state.fields.map(f => [normHeader(f.label), f]));
    const headers = lines.shift();
    const unknown = [];
    const map = headers.map(h => {
      const n = normHeader(h);
      // A column you made always wins: if this project has a column called
      // "Room ID", that is what the heading means, not the internal id.
      const f = byHeader.get(n);
      if (f) return { field: f };
      if (toTypes) {
        // A type's name is its identity, the way a room's id is.
        if (n === 'type' || n === 'typename' || n === 'name') return { typeName: true };
        if (n === 'inheritsfrom' || n === 'parent' || n === 'parenttype') return { parent: true };
      } else {
        if (n === 'roomid' || n === 'id' || n === 'roomidinternal') return { roomId: true };
        // Which type a room follows. Matched by name against the Types sheet,
        // never created from here: a typo should leave a room untyped and be
        // reported, not quietly invent a type nobody meant.
        if (n === 'roomtype' || n === 'type') return { roomType: true };
      }
      if (h.trim()) unknown.push(h.trim());
      return null;
    });
    if (!map.some(m => m && m.field) && !map.some(m => m && m.roomId)) {
      return toast(`No headings matched a column. The first row must name the columns, e.g. ${
        state.fields.slice(0, 3).map(f => f.label).join(', ')}`, true);
    }
    if (!lines.length) return toast('That looks like a header row with nothing under it.', true);

    if (toTypes) return pasteTypes(map, lines, unknown, after, pid);

    // Which column identifies a room: its own id, or the nominated import key.
    const kf = keyField();
    const idAt = map.findIndex(m => m && m.roomId);
    const keyAt = kf ? map.findIndex(m => m && m.field && m.field.id === kf.id) : -1;
    const byKeyValue = new Map();
    if (keyAt >= 0) state.rooms.forEach(r => {
      const v = state.values.get(key(r.id, kf.id))?.value;
      if (v != null && v !== '') byKeyValue.set(v, r);
    });

    const entries = lines.map(cells => ({
      room: idAt >= 0 ? roomByRef(cells[idAt]) : (keyAt >= 0 ? byKeyValue.get(cells[keyAt]) || null : null),
      cells,
    }));

    let order = Math.max(0, ...state.rooms.map(r => r.sort_order));
    const fresh = entries.filter(x => !x.room);
    fresh.forEach(x => (x.order = ++order));
    if (fresh.length) {
      const { data, error } = await sb.from('rooms')
        .insert(fresh.map(x => ({ project_id: pid, sort_order: x.order })))
        .select('id,sort_order');
      if (error) return toast(friendly(error), true);
      const byOrder = new Map(data.map(r => [r.sort_order, r.id]));
      fresh.forEach(x => (x.room = { id: byOrder.get(x.order) }));
    }

    // A cell that doesn't suit its column is left out rather than failing the whole paste.
    const values = [];
    let skipped = 0;
    entries.forEach(x => x.cells.forEach((raw, i) => {
      const f = map[i] && map[i].field;
      if (!f || raw === '') return;
      let value = raw;
      if (f.type === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) return skipped++;
      if (f.type === 'select' && !f.options.includes(value)) return skipped++;
      if (f.type === 'checkbox') value = /^(y|yes|true|1|x)$/i.test(value) ? 'true' : 'false';
      values.push({ room_id: x.room.id, field_id: f.id, value });
    }));
    if (values.length) {
      const { error } = await sb.from('room_values')
        .upsert(dedupeCells(values, v => v.room_id + '|' + v.field_id), { onConflict: 'room_id,field_id' });
      if (error) return toast(friendly(error), true);
    }
    // Assigning a type moves every inherited cell in the room, so it is done
    // after the values: anything typed in the paste stays an override of it.
    let noType = 0;
    const typeAt = map.findIndex(m => m && m.roomType);
    if (typeAt >= 0) {
      const norm = v => String(v ?? '').trim().toLowerCase();
      const byTypeName = new Map(state.types.map(t => [norm(t.name), t]));
      const wanted = new Map();                   // type id -> room ids
      for (const x of entries) {
        const name = String(x.cells[typeAt] ?? '').trim();
        if (!name) continue;                      // blank leaves the type alone
        const t = byTypeName.get(norm(name));
        if (!t) { noType++; continue; }
        if (!wanted.has(t.id)) wanted.set(t.id, []);
        wanted.get(t.id).push(x.room.id);
      }
      for (const [type_id, ids] of wanted) {
        const { error } = await sb.from('rooms').update({ type_id }).in('id', ids);
        if (error) return toast(friendly(error), true);
      }
    }
    after(`${fresh.length} added, ${entries.length - fresh.length} updated`
      + (skipped ? `, ${skipped} cells skipped` : '')
      + (noType ? `, ${noType} room types not matched` : '')
      + (unknown.length ? `, ignored ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? `, +${unknown.length - 3} more` : ''}` : ''));
  });

  document.querySelectorAll('#f-field, .f-edit').forEach(form => {
    const sel = form.querySelector('select[name=type]'), o = form.querySelector('input[name=options]');
    if (!sel || !o) return;
    sel.onchange = () => { o.hidden = sel.value !== 'select'; o.required = sel.value === 'select'; };
  });

  document.querySelector('.f-edit')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = state.fields.find(x => x.id === e.target.dataset.id);
    const fd = new FormData(e.target);
    const type = fd.get('type');
    const options = type === 'select' ? fd.get('options').split(',').map(s => s.trim()).filter(Boolean) : [];
    const freeze = fd.get('pinned') === 'on';
    const is_key = fd.get('is_key') === 'on';
    const pin_order = freeze
      ? (f.pin_order ?? Math.max(0, ...frozenFields().map(x => x.pin_order)) + 1)
      : null;
    if (type === 'select' && !options.length) return toast('A list column needs at least one choice', true);

    // Values already in the sheet aren't rewritten, but they would block the next save.
    const held = state.rooms.map(r => state.values.get(key(r.id, f.id))?.value).filter(v => v != null && v !== '');
    const stranded = held.filter(v => !valueFits(type, options, v)).length;
    if (stranded && !confirm(`${stranded} of ${held.length} values no longer suit this column. They stay in the sheet, but nobody can save those cells again until they’re corrected. Change it anyway?`)) return;

    // Only one import key per project; the partial unique index would reject a second.
    if (is_key && !f.is_key) {
      const old = keyField();
      if (old) {
        const { error } = await sb.from('fields').update({ is_key: false }).eq('id', old.id);
        if (error) return toast(friendly(error), true);
      }
    }
    const { error } = await sb.from('fields').update({
      label: fd.get('label').trim(), discipline: matchDisc(fd.get('discipline')), type, options, pin_order, is_key,
    }).eq('id', f.id);
    if (error) return toast(friendly(error), true);
    state.editField = null;
    after('Column updated');
  });
  document.getElementById('f-field')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const discipline = matchDisc(fd.get('discipline'));
    // Say it out loud rather than leaving the browser to raise a validation
    // bubble on a field that may be scrolled out of sight in the drawer.
    if (!fd.get('label').trim()) return toast('Give the column a name', true);
    if (!discipline) return toast('Give the column a discipline — it decides who can edit it', true);
    const type = fd.get('type');
    const options = type === 'select' ? fd.get('options').split(',').map(s => s.trim()).filter(Boolean) : [];
    const sameDisc = state.fields.filter(f => f.discipline === discipline);
    const { error } = await sb.from('fields').insert({
      project_id: pid, label: fd.get('label').trim(), discipline, type, options,
      sort_order: Math.max(0, ...sameDisc.map(f => f.sort_order)) + 1,
    });
    // The full object, not just its message: when this fails for one person and
    // not another, the Postgres code is the thing that says why.
    if (error) { console.error('Add column failed:', error); return toast(friendly(error), true); }
    // Land on a tab that actually shows it. Adding a column while looking at
    // another discipline put it somewhere off screen, which reads exactly like
    // nothing having happened.
    if (state.view !== 'all' && state.view !== discipline) state.view = discipline;
    after(`Column added to ${discipline}`);
  });

  // Role, disciplines and the two rights, read the same way whether the person
  // is being added or edited. Only a consultant carries disciplines: an admin
  // edits everything anyway and a viewer edits nothing, so leaving stale ones
  // on the row would mean a demotion silently kept its old reach.
  const memberRights = form => {
    const fd = new FormData(form);
    const role = fd.get('role');
    const all = fd.get('all_disc') === 'on';
    const typed = [...new Set(fd.get('disciplines').split(',').map(x => x.trim()).filter(Boolean).map(matchDisc))];
    const disciplines = role !== 'consultant' ? [] : all ? [ALL_DISC] : typed.filter(d => d !== ALL_DISC);
    if (role === 'consultant' && !disciplines.length) {
      toast('Give a consultant at least one discipline, or tick Every discipline', true);
      return null;
    }
    return {
      role, disciplines,
      edits_parent_types: role === 'consultant' && fd.get('edits_parent_types') === 'on',
    };
  };

  document.getElementById('f-member')?.addEventListener('submit', async e => {
    e.preventDefault();
    const rights = memberRights(e.target);
    if (!rights) return;
    const email = new FormData(e.target).get('email').trim().toLowerCase();
    const { error } = await sb.from('project_members').upsert(
      { project_id: pid, email, ...rights }, { onConflict: 'project_id,email' });
    if (error) return toast(friendly(error), true);
    after('Person added');
  });

  document.querySelector('.f-edit-member')?.addEventListener('submit', async e => {
    e.preventDefault();
    const rights = memberRights(e.target);
    if (!rights) return;
    const { error } = await sb.from('project_members').update(rights)
      .eq('project_id', pid).eq('email', e.target.dataset.email);
    if (error) return toast(friendly(error), true);
    state.editMember = null;
    after('Person updated');
  });

  // Renumber a whole band, or the bands themselves, so a move never leaves ties behind.
  const renumber = async (rows, column) => {
    const errs = await Promise.all(rows.map((row, n) =>
      sb.from('fields').update({ [column]: n + 1 }).in('id', row.ids).then(r => r.error)));
    const bad = errs.find(Boolean);
    if (bad) return toast(friendly(bad), true);
    after('Order changed');
  };
  const moveWithin = (id, dir) => {
    const f = state.fields.find(x => x.id === id);
    const sibs = state.fields.filter(x => x.discipline === f.discipline);
    const i = sibs.indexOf(f), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    return renumber(sibs.map(x => ({ ids: [x.id] })), 'sort_order');
  };
  const moveBand = (disc, dir) => {
    const bands = state.disc.filter(d => state.fields.some(f => f.discipline === d));
    const i = bands.indexOf(disc), j = i + dir;
    if (i < 0 || j < 0 || j >= bands.length) return;
    [bands[i], bands[j]] = [bands[j], bands[i]];
    return renumber(bands.map(d => ({ ids: state.fields.filter(f => f.discipline === d).map(f => f.id) })), 'discipline_order');
  };

  document.getElementById('drawer').onclick = async e => {
    const fid = e.target.dataset.delField, mem = e.target.dataset.delMember;
    const d = e.target.dataset;
    if (d.editField) { state.editField = d.editField; return renderDrawer('columns'); }
    if ('cancelEdit' in d) { state.editField = null; return renderDrawer('columns'); }
    if ('toggleRoomid' in d) {
      state.hideRoomId = !state.hideRoomId;
      saveUI();
      paintGrid();
      return renderDrawer('columns');
    }
    if (d.editMember) { state.editMember = d.editMember; return renderDrawer('people'); }
    if ('cancelMember' in d) { state.editMember = null; return renderDrawer('people'); }
    if (d.hideField) {
      const f = state.fields.find(x => x.id === d.hideField);
      const { error } = await sb.from('fields').update({ hidden: !f.hidden }).eq('id', f.id);
      if (error) return toast(friendly(error), true);
      return after(f.hidden ? `${f.label} shown` : `${f.label} hidden — its values are kept`);
    }
    if (d.upField) return moveWithin(d.upField, -1);
    if (d.downField) return moveWithin(d.downField, 1);
    if (d.discUp) return moveBand(d.discUp, -1);
    if (d.discDown) return moveBand(d.discDown, 1);
    if (d.unpinField) {
      const { error } = await sb.from('fields').update({ pin_order: null }).eq('id', d.unpinField);
      if (error) return toast(friendly(error), true);
      return after('Column unfrozen');
    }
    if (d.pinupField || d.pindownField) {
      const froz = frozenFields();
      const i = froz.findIndex(f => f.id === (d.pinupField || d.pindownField));
      const j = i + (d.pinupField ? -1 : 1);
      if (i < 0 || j < 0 || j >= froz.length) return;
      [froz[i], froz[j]] = [froz[j], froz[i]];
      return renumber(froz.map(f => ({ ids: [f.id] })), 'pin_order');
    }
    if (fid) {
      const f = state.fields.find(x => x.id === fid);
      if (!confirm(`Delete the column “${f.label}”? Its values in every room will be removed.`)) return;
      const { error } = await sb.from('fields').delete().eq('id', fid);
      if (error) return toast(friendly(error), true);
      state.editField = null;
      after('Column deleted');
    }
    if (mem) {
      if (!confirm(`Remove ${mem} from this project?`)) return;
      const { error } = await sb.from('project_members').delete().eq('project_id', pid).eq('email', mem);
      if (error) return toast(friendly(error), true);
      state.editMember = null;
      after('Person removed');
    }
  };
}

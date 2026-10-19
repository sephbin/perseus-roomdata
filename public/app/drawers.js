// The admin drawers: rooms, columns, people. Each one renders its markup and
// then wires it, so the two halves stay next to each other.
import { sb } from './client.js';
import {
  state, isAdmin, canEdit, myEmail, dColor, frozenFields, sheetFields, matchDisc, roomByRef,
  keyField,
} from './state.js';
import { key, esc, byNatural, toast, friendly, typeNames, valueFits, splitDelimited, normHeader } from './util.js';
import { loadProject } from './data.js';

export function renderDrawer(kind) {
  state.drawer = kind;
  const d = document.getElementById('drawer');
  const discList = `<datalist id="disc-list">${state.disc.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  let html = '';

  if (kind === 'rooms') {
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
        <textarea name="text" placeholder="${['Room id', ...cols.map(f => f.label)].slice(0, 4).map(f => esc(f)).join('\t')}&#10;..."></textarea>
        <button class="primary">Add rooms</button>
      </form>
      <p class="hint" style="margin-top:16px">${state.rooms.length} rooms on this project. A room is identified by its own id, so nothing you type here has to be unique. Edit the sheet directly, or change the columns in <b>Columns</b>.</p>`;
  }

  if (kind === 'columns') {
    const grouped = state.disc.map(dd => [dd, state.fields.filter(f => f.discipline === dd)]).filter(([, fs]) => fs.length);
    const froz = frozenFields();
    html = `
      <h3>Add a column</h3>
      <form id="f-field">
        <input name="label" placeholder="Column name, e.g. Lux level" required>
        <input name="discipline" placeholder="Discipline, e.g. Electrical" list="disc-list" required>
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
      <ul class="list">${grouped.map(([dd, fs], gi) => `
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
      <h3>Add someone</h3>
      <form id="f-member">
        <input name="email" type="email" placeholder="Their email" required>
        <select name="role">
          <option value="consultant">Consultant: edits their discipline’s columns</option>
          <option value="viewer">Viewer: sees everything, edits nothing</option>
          <option value="admin">Admin: manages rooms, columns and people</option>
        </select>
        <input name="disciplines" placeholder="Disciplines, separated by commas">
        <label class="check"><input type="checkbox" name="edits_parent_types"> Can edit shared room types</label>
        <p class="hint">A room type with others beneath it sets values for all of them, so editing one needs this. Admins always can.</p>
        <p class="hint">${state.disc.length ? 'Existing disciplines: ' + esc(state.disc.join(', ')) + '. ' : ''}After adding them, send them the link to this page. They sign in with that email and the project appears.</p>
        <button class="primary">Add person</button>
      </form>
      <h3>People on this project</h3>
      <ul class="list">${state.members.slice().sort((a, b) => byNatural(a.email, b.email)).map(m => `
        <li><span class="grow">${esc(m.email)}<small>${m.role === 'consultant' ? 'Consultant: ' + esc(m.disciplines.join(', ') || 'no disciplines') : m.role === 'admin' ? 'Admin' : 'Viewer'}${
          m.role === 'consultant' && m.edits_parent_types ? ' · edits shared types' : ''}</small></span>
        ${m.email === myEmail() ? '<span class="muted">You</span>' : `<button class="danger" data-del-member="${esc(m.email)}">Remove</button>`}</li>`).join('')}
      </ul>`;
  }

  const titles = { rooms: 'Rooms', columns: 'Columns', people: 'People' };
  d.innerHTML = `<header><h2>${titles[kind]}</h2><button class="link" id="close-drawer">Close</button></header>${html}`;
  d.hidden = false;
  document.getElementById('close-drawer').onclick = () => { d.hidden = true; state.drawer = null; };
  wireDrawer();
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
    const raw = new FormData(e.target).get('text').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
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
      if (n === 'roomid' || n === 'id' || n === 'roomidinternal') return { roomId: true };
      if (h.trim()) unknown.push(h.trim());
      return null;
    });
    if (!map.some(m => m && m.field) && !map.some(m => m && m.roomId)) {
      return toast(`No headings matched a column. The first row must name the columns, e.g. ${
        state.fields.slice(0, 3).map(f => f.label).join(', ')}`, true);
    }
    if (!lines.length) return toast('That looks like a header row with nothing under it.', true);

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
      const { error } = await sb.from('room_values').upsert(values, { onConflict: 'room_id,field_id' });
      if (error) return toast(friendly(error), true);
    }
    after(`${fresh.length} added, ${entries.length - fresh.length} updated`
      + (skipped ? `, ${skipped} cells skipped` : '')
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
    const type = fd.get('type');
    const options = type === 'select' ? fd.get('options').split(',').map(s => s.trim()).filter(Boolean) : [];
    const sameDisc = state.fields.filter(f => f.discipline === discipline);
    const { error } = await sb.from('fields').insert({
      project_id: pid, label: fd.get('label').trim(), discipline, type, options,
      sort_order: Math.max(0, ...sameDisc.map(f => f.sort_order)) + 1,
    });
    if (error) return toast(friendly(error), true);
    after('Column added');
  });

  document.getElementById('f-member')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const role = fd.get('role');
    const disciplines = role === 'consultant'
      ? [...new Set(fd.get('disciplines').split(',').map(s => s.trim()).filter(Boolean).map(matchDisc))]
      : [];
    if (role === 'consultant' && !disciplines.length) return toast('Give a consultant at least one discipline', true);
    const { error } = await sb.from('project_members').upsert(
      {
        project_id: pid, email: fd.get('email').trim().toLowerCase(), role, disciplines,
        edits_parent_types: role === 'consultant' && fd.get('edits_parent_types') === 'on',
      },
      { onConflict: 'project_id,email' });
    if (error) return toast(friendly(error), true);
    after('Person added');
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
      after('Person removed');
    }
  };
}

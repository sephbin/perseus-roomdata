// The project shell: the bar, the toolbar, the drawer slot, and the wiring for
// everything that isn't inside the grid itself.
import { sb } from './client.js';
import { app, state, isAdmin, myEmail, dColor, typeName, roomLabel, typeTree, saveUI, applyUI, discLabel, typeByName, parentChoices } from './state.js';
import { esc, toast, friendly } from './util.js';
import {
  gridHTML, applyWidths, paintGrid, paintSearch, paintSelection, wireGridDrag,
} from './grid.js';
import { saveValue, fillDown, exportCSV } from './actions.js';
import { renderDrawer } from './drawers.js';
import { loadProject } from './data.js';
import { sheetHTML, sheetRooms, sheetRoom, sheetIndex, stepSheet, exportDocx, roomTitle } from './sheetview.js';
import { peersHTML, paintPeers } from './presence.js';
import { startTour, maybeStartTour } from './tour.js';
import { showAbout } from './about.js';

// One sheet per room, in the order the Instance tab has them, narrowed to the
// selection when there is one. A whole project at once would be hundreds of
// pages, so it is capped and says so.
function sheetsHTML() {
  const room = sheetRoom();
  if (!room) {
    return `<div class="empty"><h2>No rooms yet</h2><p class="muted">Data sheets are drawn one per room, so there is nothing to show until the Instance tab has some.</p></div>`;
  }
  // One sheet, which widens into a two page spread only if the content needs
  // it -- the flow has to live in a single box or its second column would be
  // clipped by the first page's own bounds.
  return `<div class="sheets" id="sheets">
    <div class="paper" id="paper">
      ${sheetHTML(room)}
      <footer class="rds-foot p1"><span>${esc(roomTitle(room))}</span><span class="pno">1</span></footer>
      <footer class="rds-foot p2"><span>${esc(roomTitle(room))}</span><span>2</span></footer>
    </div>
  </div>`;
}

// Paging keeps focus on the page rather than re-rendering the whole shell, so
// the toolbar doesn't flicker and the wheel keeps working mid-gesture.
export function turnPage(by) {
  stepSheet(by);
  renderProject(true);
}

// A sheet is a page. If its content is taller than one, the flow becomes two
// columns the width of two pages side by side, which is what a spread is.
export function fitSheet() {
  const paper = document.getElementById('paper');
  const flow = document.getElementById('rds-flow');
  if (!paper || !flow) return;
  paper.classList.remove('spread');            // measure against one page first
  flow.style.columnCount = '';
  const overflows = flow.scrollHeight > flow.clientHeight + 1;
  paper.classList.toggle('spread', overflows);
  flow.style.columnCount = overflows ? '2' : '';
  const pno = paper.querySelector('.rds-foot.p1 .pno');
  if (pno) pno.textContent = overflows ? '1' : '';
}

const shutMenu = () => {
  const pop = document.getElementById('settings-pop'), btn = document.getElementById('settings-btn');
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
};
addEventListener('click', shutMenu);
addEventListener('keydown', e => e.key === 'Escape' && shutMenu());

// The pager buttons sit in the toolbar and survive a sheet redraw; the wheel
// listener is on the sheet itself and does not, so this runs again after every
// paintSheet(). Both use onclick rather than addEventListener so calling it
// twice can't stack handlers.
export function wireSheet() {
  const prev = document.getElementById('sheet-prev'), next = document.getElementById('sheet-next');
  if (prev) prev.onclick = () => turnPage(-1);
  if (next) next.onclick = () => turnPage(1);
  if (state.subject !== 'sheet') return;

  // The wheel turns pages rather than scrolling, because a sheet is a page and
  // there is nothing below it to scroll to. A trackpad fires a burst of small
  // deltas per gesture, so they are accumulated to a threshold and rate limited
  // -- otherwise one flick would skip twenty rooms.
  const sheets = document.getElementById('sheets');
  if (!sheets) return;
  let acc = 0, last = 0;
  sheets.onwheel = e => {
    e.preventDefault();
    const now = Date.now();
    if (now - last > 400) acc = 0;              // a new gesture
    acc += e.deltaY;
    if (Math.abs(acc) < 60 || now - last < 160) return;
    last = now;
    const by = acc > 0 ? 1 : -1;
    acc = 0;
    turnPage(by);
  };
}

// Redraw the sheet and its pager in place. Searching does this on every
// keystroke, so it must not disturb anything the person is typing into.
export function paintSheet() {
  const wrap = document.getElementById('grid-wrap');
  if (wrap) wrap.innerHTML = sheetsHTML();
  const pos = document.querySelector('.pager .pos');
  const who = document.querySelector('.pager .who');
  const n = sheetRooms().length;
  if (pos) pos.textContent = n ? `${sheetIndex() + 1} of ${n}` : '0';
  if (who) who.textContent = sheetRoom() ? roomTitle(sheetRoom()) : '';
  fitSheet();
  wireSheet();
}

export function renderProject(keepUI) {
  const wrap = document.getElementById('grid-wrap');
  const scroll = keepUI && wrap ? [wrap.scrollLeft, wrap.scrollTop] : [0, 0];
  const focus = keepUI && document.activeElement?.closest?.('td[data-r]');
  const focusKey = focus ? [focus.dataset.r, focus.dataset.f] : null;

  const tabs = [];
  if (!isAdmin() && (state.me?.disciplines || []).length) tabs.push(['mine', 'My columns', null]);
  tabs.push(['all', 'All columns', null]);
  state.disc.filter(d => state.fields.some(f => f.discipline === d)).forEach(d => tabs.push([d, d, dColor(d)]));

  const roleText = state.me
    ? (state.me.role === 'consultant' ? esc(discLabel(state.me)) : state.me.role === 'admin' ? 'Admin' : 'View only')
    : '';

  app.innerHTML = `
  <div class="shell">
    <header class="bar">
      <a class="crumb" href="#">Projects</a>
      ${isAdmin()
        ? `<input id="projname" class="projname" value="${esc(state.project.name)}" aria-label="Project name" spellcheck="false">`
        : `<h1>${esc(state.project.name)}</h1>`}
      <span class="peerslot" id="peerslot">${peersHTML()}</span>
      <span class="who">${esc(myEmail())}, ${esc(roleText)}</span>
      <div class="menu">
        <button id="settings-btn" class="icon" aria-haspopup="true" aria-expanded="false" aria-label="Settings" title="Settings">\u2699</button>
        <div class="pop" id="settings-pop" hidden>
          <button id="tour-again">Show me how this works</button>
          <button id="about-btn">About &amp; version</button>
          <button id="signout">Sign out</button>
        </div>
      </div>
    </header>
    <div class="toolbar">
      <nav class="tabs subj">
        <button data-subject="rooms" aria-pressed="${state.subject === 'rooms'}">Instance</button>
        <button data-subject="types" aria-pressed="${state.subject === 'types'}">Types</button>
        <button data-subject="sheet" aria-pressed="${state.subject === 'sheet'}">Data sheets</button>
      </nav>
      ${state.subject === 'sheet' ? `<nav class="pager">
        <button id="sheet-prev" aria-label="Previous room">\u2039</button>
        <span class="pos">${sheetRooms().length ? `${sheetIndex() + 1} of ${sheetRooms().length}` : '0'}</span>
        <button id="sheet-next" aria-label="Next room">\u203a</button>
        <span class="who">${esc(sheetRoom() ? roomTitle(sheetRoom()) : '')}</span>
      </nav>` : `<nav class="tabs">${tabs.map(([v, label, c]) =>
        `<button data-view="${esc(v)}" aria-pressed="${state.view === v}" ${c ? `style="--dc:${c}"` : ''}>${c ? '<span class="dot"></span>' : ''}${esc(label)}</button>`).join('')}
      </nav>`}
      <input type="search" id="search" placeholder="Find a ${state.subject === 'types' ? 'type' : 'room'}" value="${esc(state.search)}">
      <span class="spacer"></span>
      ${state.subject === 'sheet'
        ? `<button id="export-docx" class="primary">Export to Word</button>`
        : `<button id="export">Export CSV</button>`}
      ${isAdmin() && state.subject === 'types' ? `<button id="add-type">Add type</button>` : ''}
      ${isAdmin() ? `<button data-drawer="rooms">Rooms</button><button data-drawer="columns">Columns</button><button data-drawer="people">People</button>` : ''}
    </div>
    <div class="grid-wrap" id="grid-wrap">${state.subject === 'sheet' ? sheetsHTML() : gridHTML()}</div>
  </div>
  <div class="selbar" id="selbar" hidden>
    <span id="sel-count"></span>
    ${state.subject !== 'types' && state.types.length ? `
    <input id="sel-type" list="type-names" placeholder="Set type…"
      aria-label="Give the selected rooms a type" autocomplete="off">
    <button id="sel-untype" title="Remove the type from the selected rooms">No type</button>` : ''}
    <small class="muted">Ctrl+D fills these rooms from the cell you’re in</small>
    <button id="sel-clear">Clear</button>
    <button class="danger" id="sel-delete">Delete rooms</button>
  </div>
  <aside class="drawer" id="drawer" hidden></aside>`;

  // Warm for types, cool for instances. On <body> so the page behind the grid
  // changes too, not just the sheet.
  document.body.classList.toggle('warm', state.subject === 'types');

  const g = document.getElementById('grid-wrap');
  g.scrollLeft = scroll[0]; g.scrollTop = scroll[1];
  if (focusKey) {
    const sel = `td[data-r="${focusKey[0]}"][data-f="${focusKey[1]}"] .cell`;
    document.querySelector(sel)?.focus();
  }
  applyWidths();                       // restores stored column widths; runs layoutFrozen
  if (state.subject === 'sheet') fitSheet();
  wireProject();
  paintSearch();
  if (state.drawer) renderDrawer(state.drawer);
}

export function wireProject() {
  document.getElementById('signout').onclick = () => sb.auth.signOut();

  // A popover rather than a row of buttons, because the header is the one
  // place everything competes for room and sign-out is not a thing to put
  // next to a project name you can rename by clicking it.
  const sbtn = document.getElementById('settings-btn'), spop = document.getElementById('settings-pop');
  if (sbtn && spop) {
    const shut = shutMenu;
    sbtn.onclick = e => {
      e.stopPropagation();
      spop.hidden = !spop.hidden;
      sbtn.setAttribute('aria-expanded', String(!spop.hidden));
    };
    spop.onclick = e => e.stopPropagation();
    document.getElementById('tour-again').onclick = () => { shut(); startTour(); };
    document.getElementById('about-btn').onclick = () => { shut(); showAbout(); };
  }

  // The sheet was just rebuilt, so anyone else's cells need drawing again.
  paintPeers();
  maybeStartTour();

  const pn = document.getElementById('projname');
  if (pn) pn.onchange = async () => {
    const name = pn.value.trim(), was = state.project.name;
    if (!name) { pn.value = was; return toast('A project needs a name', true); }
    if (name === was) return;
    state.project.name = name;                  // show it at once, like a cell
    const { error } = await sb.from('projects').update({ name }).eq('id', state.projectId);
    if (error) {
      state.project.name = was;
      pn.value = was;
      return toast(friendly(error), true);
    }
    toast('Project renamed');
  };
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    state.view = b.dataset.view;
    document.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', x === b));
    saveUI();
    paintGrid();
  });
  document.getElementById('search').oninput = e => {
    state.search = e.target.value;
    // On the sheets view there are no rows to grey out -- searching changes
    // which rooms the pager steps through, so the page itself has to be
    // redrawn. Only the sheet and the pager are touched, because rebuilding
    // the toolbar would take the search box, and the cursor in it, with it.
    if (state.subject === 'sheet') { state.sheetAt = 0; return paintSheet(); }
    paintSearch();
  };
  document.querySelectorAll('[data-subject]').forEach(b => b.onclick = () => {
    if (state.subject === b.dataset.subject) return;
    state.subject = b.dataset.subject;
    state.selected = new Set();
    state.cellA = state.cellB = null;
    applyUI(true);              // keep the tab just clicked; restore its own sort, filters and widths
    saveUI();
    renderProject(true);
  });
  document.getElementById('add-type')?.addEventListener('click', async () => {
    const base = 'New type', taken = new Set(state.types.map(t => t.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    const { error } = await sb.from('room_types').insert({
      project_id: state.projectId, name,
      sort_order: Math.max(0, ...state.types.map(t => t.sort_order)) + 1,
    });
    if (error) return toast(friendly(error), true);
    toast('Type added — give it a name and fill in its values');
    loadProject(state.projectId, true);
  });
  const exportCsv = document.getElementById('export');
  if (exportCsv) exportCsv.onclick = exportCSV;
  const exportWord = document.getElementById('export-docx');
  if (exportWord) exportWord.onclick = () => exportDocx(sheetRooms());
  wireSheet();
  document.querySelectorAll('[data-drawer]').forEach(b => b.onclick = () => renderDrawer(b.dataset.drawer));

  const g = document.getElementById('grid-wrap');
  if (state.subject !== 'sheet') wireGridDrag(g);

  // Giving many rooms a type at once. Nothing is overwritten: a room that has
  // its own value for a column keeps it, and only inherited cells change.
  // Same picker as the cells: type to narrow the list rather than scrolling a
  // hundred names. Clearing a whole selection is its own button, because an
  // empty box here would otherwise mean both "I haven't chosen yet" and
  // "remove the type", and the first is far more common.
  const setTypeOn = async type_id => {
    const ids = [...state.selected];
    if (!ids.length) return;
    const { error } = await sb.from('rooms').update({ type_id }).in('id', ids);
    if (error) return toast(friendly(error), true);
    const n = `${ids.length} room${ids.length === 1 ? '' : 's'}`;
    toast(type_id ? `${n} set to ${typeName(type_id)}` : `Type cleared on ${n}`);
    loadProject(state.projectId, true);
  };
  const selType = document.getElementById('sel-type');
  if (selType) selType.onchange = async () => {
    const typed = selType.value.trim();
    if (!typed) return;
    const t = typeByName(typed);
    if (!t) { selType.value = ''; return toast(`No room type called “${typed}”`, true); }
    selType.value = '';
    await setTypeOn(t.id);
  };
  const selUntype = document.getElementById('sel-untype');
  if (selUntype) selUntype.onclick = () => {
    if (state.selected.size) setTypeOn(null);
  };

  document.getElementById('sel-clear').onclick = () => { state.selected = new Set(); paintSelection(); };
  document.getElementById('sel-delete').onclick = async () => {
    const ids = [...state.selected];
    if (!ids.length) return;
    const what = ids.length === 1 ? 'this room' : 'these rooms';
    if (!confirm(`Delete ${ids.length} room${ids.length === 1 ? '' : 's'}? Everyone’s data for ${what} will be removed.`)) return;
    const { error } = await sb.from('rooms').delete().in('id', ids);
    if (error) return toast(friendly(error), true);
    state.selected = new Set();
    paintSelection();
    toast(`Deleted ${ids.length} room${ids.length === 1 ? '' : 's'}`);
    loadProject(state.projectId, true);
  };

  g.addEventListener('change', async e => {
    const td = e.target.closest('td');
    if (!td) return;
    if (td.dataset.f) return saveValue(td, e.target);

    // The room's type: changing it changes every value the room inherits.
    if (e.target.classList.contains('rtype')) {
      const id = e.target.dataset.room;
      const was = () => typeName(state.rooms.find(r => r.id === id)?.type_id);
      const typed = e.target.value.trim();
      // The box carries a name now, so a name has to become a type. Anything
      // that isn't one goes back to what it was rather than silently clearing.
      const t = typed ? typeByName(typed) : null;
      if (typed && !t) { e.target.value = was(); return toast(`No room type called “${typed}”`, true); }
      const type_id = t ? t.id : null;
      if ((state.rooms.find(r => r.id === id)?.type_id || null) === type_id) return;
      const { error } = await sb.from('rooms').update({ type_id }).eq('id', id);
      if (error) { e.target.value = was(); return toast(friendly(error), true); }
      toast(type_id ? `Room type set to ${typeName(type_id)}` : 'Room type cleared');
      return loadProject(state.projectId, true);
    }
    // Re-parenting a type moves every value its descendants inherit.
    if (e.target.classList.contains('tparent')) {
      const id = e.target.dataset.type;
      const me = state.types.find(t => t.id === id);
      const was = () => typeName(me?.parent_id);
      const typed = e.target.value.trim();
      const t = typed ? typeByName(typed) : null;
      if (typed && !t) { e.target.value = was(); return toast(`No room type called “${typed}”`, true); }
      // The list offers every type, so the loop check that used to be built
      // into the options has to happen here. The database guards it too; this
      // is so the answer is immediate and says what is wrong.
      if (t && !parentChoices(me).some(x => x.id === t.id)) {
        e.target.value = was();
        return toast(`${t.name} sits beneath ${me.name}, so it can’t also be its parent`, true);
      }
      const parent_id = t ? t.id : null;
      if ((me?.parent_id || null) === parent_id) return;
      const { error } = await sb.from('room_types').update({ parent_id }).eq('id', id);
      if (error) { e.target.value = was(); return toast(friendly(error), true); }
      toast(parent_id ? `Now inherits from ${typeName(parent_id)}` : 'No longer inherits from anything');
      return loadProject(state.projectId, true);
    }
    if (e.target.classList.contains('tname')) {
      const id = e.target.dataset.type, name = e.target.value.trim();
      const was = state.types.find(t => t.id === id)?.name ?? '';
      if (!name) { e.target.value = was; return toast('A type needs a name', true); }
      if (name === was) return;
      const { error } = await sb.from('room_types').update({ name }).eq('id', id);
      if (error) {
        e.target.value = was;
        return toast(error.code === '23505' ? `There’s already a type called ${name}` : friendly(error), true);
      }
      return loadProject(state.projectId, true);
    }
  });
  g.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      const td = e.target.closest('td[data-f]');
      if (!td) return;
      e.preventDefault();
      return fillDown(td);
    }
    if (e.key !== 'Enter' || !e.target.classList.contains('cell') || e.target.type === 'checkbox') return;
    e.preventDefault();
    const td = e.target.closest('td');
    const row = e.shiftKey ? td.parentElement.previousElementSibling : td.parentElement.nextElementSibling;
    const next = row?.cells[td.cellIndex]?.querySelector('.cell');
    if (next) next.focus(); else e.target.blur();
  });
  g.addEventListener('click', async e => {
    const typeId = e.target.closest('[data-del-type]')?.dataset.delType;
    if (typeId) {
      const t = state.types.find(x => x.id === typeId);
      const using = state.rooms.filter(r => r.type_id === typeId).length;
      if (!confirm(`Delete the type “${t.name}”?${using
        ? ` ${using} room${using === 1 ? '' : 's'} currently ${using === 1 ? 'uses' : 'use'} it and will lose the values ${using === 1 ? 'it inherits' : 'they inherit'} from it. Anything typed into those rooms directly is kept.`
        : ''}`)) return;
      const { error } = await sb.from('room_types').delete().eq('id', typeId);
      if (error) return toast(friendly(error), true);
      toast(`Deleted the type ${t.name}`);
      return loadProject(state.projectId, true);
    }

    const id = e.target.closest('[data-del-room]')?.dataset.delRoom;
    if (!id) return;
    const r = state.rooms.find(x => x.id === id);
    if (!confirm(`Delete room ${roomLabel(r)}? Everyone’s data for this room will be removed.`)) return;
    const { error } = await sb.from('rooms').delete().eq('id', id);
    if (error) return toast(friendly(error), true);
    toast(`Deleted room ${roomLabel(r)}`);
    loadProject(state.projectId, true);
  });
}

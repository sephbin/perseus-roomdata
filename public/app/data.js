// Everything that talks to the database for a whole project: the initial load,
// the realtime subscription, and the project list. Asks for a redraw through
// the bus rather than importing the view.
import { sb } from './client.js';
import { app, state, myEmail, isAdmin, applyUI } from './state.js';
import { key, esc, byNatural, toast, friendly, fetchAll, displayValue, stamp } from './util.js';
import { flash, refreshColumn } from './grid.js';
import { rerender } from './bus.js';

export async function loadProjects() {
  const { data, error } = await sb.from('projects').select('id,name,created_at').order('created_at', { ascending: false });
  if (error) return toast(friendly(error), true);
  app.innerHTML = `
  <main class="narrow">
    <h1>Projects</h1>
    <p class="muted">Signed in as ${esc(myEmail())}. <button class="link" id="signout">Sign out</button></p>
    ${data.length
      ? `<ul class="plist">${data.map(p => `<li><a href="#p=${p.id}">${esc(p.name)}</a></li>`).join('')}</ul>`
      : `<p>You’re not on any projects yet. If you’re a consultant, ask the project architect to add your email, then refresh this page.</p>`}
    <form id="f-project">
      <label for="pname">Start a new project</label>
      <input id="pname" placeholder="Project name" required>
      <button>Create project</button>
    </form>
  </main>`;
  document.getElementById('signout').onclick = () => sb.auth.signOut();
  document.getElementById('f-project').addEventListener('submit', async e => {
    e.preventDefault();
    const { data: id, error } = await sb.rpc('create_project', { p_name: document.getElementById('pname').value });
    if (error) return toast(friendly(error), true);
    location.hash = 'p=' + id;
  });
}

export async function loadProject(id, keepUI = false) {
  state.projectId = id;
  try {
    const [proj, members, rooms, fields, values, types, typeValues] = await Promise.all([
      sb.from('projects').select('*').eq('id', id).maybeSingle(),
      sb.from('project_members').select('*').eq('project_id', id),
      fetchAll(() => sb.from('rooms').select('*').eq('project_id', id).order('id')),
      sb.from('fields').select('*').eq('project_id', id),
      fetchAll(() => sb.from('room_values').select('room_id,field_id,value,updated_by,updated_at').eq('project_id', id).order('room_id').order('field_id')),
      sb.from('room_types').select('*').eq('project_id', id),
      fetchAll(() => sb.from('type_values').select('type_id,field_id,value,updated_by,updated_at').eq('project_id', id).order('type_id').order('field_id')),
    ]);
    for (const r of [proj, members, fields, types]) if (r.error) throw r.error;
    if (!proj.data) {
      app.innerHTML = `<div class="empty"><h2>You don’t have access to this project</h2>
        <p>Ask the project admin to add ${esc(myEmail())}.</p><p><a href="#">Back to projects</a></p></div>`;
      return;
    }
    state.project = proj.data;
    state.members = members.data;
    state.rooms = rooms.sort((a, b) => (a.sort_order - b.sort_order) || byNatural(a.code, b.code));
    state.fields = fields.data;
    state.values = new Map(values.map(v => [key(v.room_id, v.field_id), v]));
    state.types = (types.data || []).sort((a, b) => (a.sort_order - b.sort_order) || byNatural(a.name, b.name));
    state.typeValues = new Map(typeValues.map(v => [key(v.type_id, v.field_id), v]));
    if (!state.types.length) state.subject = 'rooms';
    state.me = state.members.find(m => m.email === myEmail()) || null;
    state.selected = new Set([...state.selected].filter(id => state.rooms.some(r => r.id === id)));

    const set = new Set();
    state.fields.forEach(f => set.add(f.discipline));
    state.members.forEach(m => (m.disciplines || []).forEach(d => set.add(d)));
    const dOrder = new Map();
    state.fields.forEach(f => { if (!dOrder.has(f.discipline)) dOrder.set(f.discipline, f.discipline_order); });
    state.disc = [...set].sort((a, b) =>
      ((dOrder.get(a) ?? Infinity) - (dOrder.get(b) ?? Infinity)) || byNatural(a, b));
    state.fields.sort((a, b) =>
      (state.disc.indexOf(a.discipline) - state.disc.indexOf(b.discipline)) ||
      (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at));

    if (!keepUI) {
      state.view = isAdmin() || !(state.me?.disciplines || []).length ? 'all' : 'mine';
      state.search = '';
      state.drawer = null;
      state.editField = null;
      state.selected = new Set();
      applyUI();                       // how this person last had the sheet set up
      state.cellA = state.cellB = null;
      subscribe(id);
    }
    if (state.view !== 'all' && state.view !== 'mine' && !state.disc.includes(state.view)) state.view = 'all';
    rerender(keepUI);
  } catch (e) {
    toast(friendly(e), true);
  }
}

export function subscribe(id) {
  if (state.channel) sb.removeChannel(state.channel);
  const reload = () => {
    clearTimeout(subscribe.t);
    subscribe.t = setTimeout(() => state.projectId === id && loadProject(id, true), 500);
  };
  state.channel = sb.channel('project-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_values', filter: `project_id=eq.${id}` }, onRemoteValue)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `project_id=eq.${id}` }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fields', filter: `project_id=eq.${id}` }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_types', filter: `project_id=eq.${id}` }, reload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'type_values', filter: `project_id=eq.${id}` }, onRemoteTypeValue)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${id}` }, reload)
    .subscribe();
}

// A type default changing moves every row that follows it, but that is still
// one column -- far short of a reason to reload the project and throw away
// where someone was scrolled to.
export function onRemoteTypeValue(payload) {
  const row = payload.new;
  if (!row || !row.type_id) return;
  state.typeValues.set(key(row.type_id, row.field_id), row);
  refreshColumn(row.field_id);
}

export function onRemoteValue(payload) {
  const row = payload.new;
  if (!row || !row.room_id) return;
  const prev = state.values.get(key(row.room_id, row.field_id));
  state.values.set(key(row.room_id, row.field_id), row);
  if (prev && prev.value === row.value) return;
  const td = document.querySelector(`td[data-r="${row.room_id}"][data-f="${row.field_id}"]`);
  if (!td) return;
  const el = td.querySelector('.cell');
  if (el && el === document.activeElement) return; // don't stomp on someone mid-edit
  if (el) {
    if (el.type === 'checkbox') el.checked = row.value === 'true';
    else el.value = row.value ?? '';
  } else {
    const f = state.fields.find(x => x.id === row.field_id);
    td.textContent = displayValue(f, row.value);
  }
  td.title = stamp(row);
  if (row.updated_by !== myEmail()) flash(td, 'remote');
}

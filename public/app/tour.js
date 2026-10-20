// The guided tour: a spotlight, an arrow and a note, stepped through once on
// someone's first visit and available again from the settings menu.
//
// This file owns one question: how does this app work? The answer is a list of
// steps, each naming a thing already on screen by selector. It never builds UI
// of its own to point at, and it never changes anything -- so a step whose
// target has gone (an admin button for a consultant, the Types tab on a job
// with no types) is skipped rather than being a bug. That is also why the steps
// are data: adding one is a line, not a function.

import { state, isAdmin } from './state.js';
import { esc } from './util.js';

const SEEN = 'roomdata:tour:seen';

// where:  which side of the target the note sits. 'centre' is a step with no
//         target -- the welcome and the sign-off.
// when:   optional; a step only shows if it returns true.
const STEPS = [
  {
    where: 'centre',
    title: 'This is the room data sheet',
    body: 'One list of rooms, shared by everyone on the job, instead of a spreadsheet per consultant. Everything you type saves itself and appears on their screen as you go. Two minutes and you will know your way around.',
  },
  {
    target: '.tabs.subj',
    where: 'below',
    title: 'Three ways to look at the job',
    body: '<b>Instance</b> is the room list. <b>Types</b> is a list of room types, each holding the values every room of that type should start with. <b>Data sheets</b> lays one room out as a printable page you can export to Word.',
  },
  {
    target: '[data-subject="types"]',
    where: 'below',
    title: 'Types save the typing',
    body: 'Fill in a type once and every room of that type follows. Type something different into a room and it overrides the type for that column only — the cell is tinted blue to show it departs from the convention. Clear the cell and it follows the type again. The page turns warm when you are editing types, so you always know which half you are in.',
  },
  {
    target: '#search',
    where: 'below',
    title: 'Finding things',
    body: 'Search filters the rows as you type. Click a column heading to sort by it, and the small caret beside the heading opens an Excel-style list of that column’s values to tick and untick.',
  },
  {
    target: '.grid tbody tr:nth-child(2) td:nth-child(2)',
    where: 'right',
    title: 'Editing is just typing',
    body: 'Click a cell and type. Drag across cells to select a block, then <b>Ctrl+C</b> and <b>Ctrl+V</b> to copy it — to and from Excel too. <b>Delete</b> clears a selected block, and <b>Ctrl+D</b> fills the cell you are in down through every selected room.',
  },
  {
    target: '.grid tbody tr:nth-child(2) td:first-child',
    where: 'right',
    title: 'Selecting rooms',
    body: 'Drag down this first column to select a run of rooms, shift-click to extend it, or click the <b>Room</b> heading to take everything on screen. A bar appears at the bottom to set their type or delete them.',
  },
  {
    target: '[data-drawer="rooms"]',
    where: 'below',
    title: 'Rooms come in from Revit',
    body: 'Paste a schedule straight out of Revit or Excel — <b>include the header row</b> and the columns are matched by name, in any order. Mark one column as the import key and you can paste the same schedule again later to update rather than duplicate.',
    when: () => isAdmin(),
  },
  {
    target: '[data-drawer="columns"]',
    where: 'below',
    title: 'Columns are yours to set',
    body: 'Every column lives here, including Code, Name and Level. Add, rename, reorder, hide or delete any of them. Columns belong to a discipline, which is what decides who may edit them — and any column can be frozen so it stays on screen as you scroll sideways.',
    when: () => isAdmin(),
  },
  {
    target: '[data-drawer="people"]',
    where: 'below',
    title: 'People edit only their own columns',
    body: 'Add a consultant by email and give them their disciplines; they will see the whole sheet but can only type in their own columns. That is enforced by the database, not the page.',
    when: () => isAdmin(),
  },
  {
    target: '.bar .who',
    where: 'left',
    title: 'Who else is here',
    body: 'A circle appears beside your name for everyone else with the job open — hover one to see who it is. While they are working you will see their cells outlined in their colour, so two people never quietly type over each other.',
  },
  {
    target: '#settings-btn',
    where: 'left',
    title: 'Everything else is in here',
    body: 'Sign out, and this tour again whenever you want it. That is the lot — go and fill something in.',
  },
];

let at = 0, steps = [], root = null, onKey = null, onMove = null;

export const tourSeen = () => { try { return !!localStorage.getItem(SEEN); } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* private window */ } };

// A step is worth showing only if it applies to this person and the thing it
// points at is actually on screen.
const usable = s => (!s.when || s.when()) && (s.where === 'centre' || document.querySelector(s.target));

export function startTour() {
  endTour();
  steps = STEPS.filter(usable);
  if (!steps.length) return;
  at = 0;
  root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-dim"></div>
    <div class="tour-hole" hidden></div>
    <div class="tour-note" role="dialog" aria-modal="true" aria-labelledby="tour-title"></div>`;
  document.body.appendChild(root);
  root.addEventListener('click', e => {
    const d = e.target.dataset || {};
    if ('tourNext' in d) return step(1);
    if ('tourBack' in d) return step(-1);
    if ('tourEnd' in d) return endTour();
    if (e.target.classList.contains('tour-dim')) return endTour();
  });
  onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); endTour(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  };
  // The sheet scrolls under the tour, so the spotlight has to follow its target
  // rather than being placed once.
  onMove = () => place();
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onMove);
  document.getElementById('grid-wrap')?.addEventListener('scroll', onMove, { passive: true });
  place();
}

export function endTour() {
  if (onKey) removeEventListener('keydown', onKey, true);
  if (onMove) {
    removeEventListener('resize', onMove);
    document.getElementById('grid-wrap')?.removeEventListener('scroll', onMove);
  }
  onKey = onMove = null;
  root?.remove();
  root = null;
  markSeen();
}

function step(by) {
  const next = at + by;
  if (next < 0) return;
  if (next >= steps.length) return endTour();
  at = next;
  place();
}

function place() {
  if (!root) return;
  const s = steps[at];
  const hole = root.querySelector('.tour-hole');
  const note = root.querySelector('.tour-note');
  const t = s.where === 'centre' ? null : document.querySelector(s.target);
  const r = t ? t.getBoundingClientRect() : null;

  note.innerHTML = `
    <h2 id="tour-title">${esc(s.title)}</h2>
    <p>${s.body}</p>
    <footer>
      <span class="tour-dots">${steps.map((_, i) => `<i class="${i === at ? 'on' : ''}"></i>`).join('')}</span>
      <span class="grow"></span>
      <button class="link" data-tour-end>${at === steps.length - 1 ? 'Done' : 'Skip'}</button>
      ${at ? '<button data-tour-back>Back</button>' : ''}
      <button class="primary" data-tour-next>${at === steps.length - 1 ? 'Finish' : 'Next'}</button>
    </footer>`;

  // A target that has scrolled out of the viewport leaves the step with nothing
  // to point at, so it reads as a plain card rather than a spotlight on nothing.
  const visible = r && r.width && r.height && r.bottom > 0 && r.top < innerHeight;
  hole.hidden = !visible;
  note.classList.toggle('centre', !visible);
  note.removeAttribute('data-arrow');

  if (!visible) {
    note.style.left = note.style.top = '';
    return;
  }

  const pad = 6;
  Object.assign(hole.style, {
    left: `${r.left - pad}px`, top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
  });

  const gap = 18;
  const nw = Math.min(360, innerWidth - 32);
  note.style.width = `${nw}px`;
  const nh = note.offsetHeight || 200;
  let left, top, arrow = s.where;

  if (s.where === 'below')      { left = r.left + r.width / 2 - nw / 2; top = r.bottom + gap; }
  else if (s.where === 'above') { left = r.left + r.width / 2 - nw / 2; top = r.top - nh - gap; }
  else if (s.where === 'left')  { left = r.left - nw - gap;             top = r.top + r.height / 2 - nh / 2; }
  else                          { left = r.right + gap;                 top = r.top + r.height / 2 - nh / 2; }

  // If it would fall off, put it on the other side rather than letting it hang
  // half off the screen -- and move the arrow with it, or it would point away
  // from the thing it is about.
  if (left < 16) { if (arrow === 'left') { arrow = 'right'; left = r.right + gap; } else left = 16; }
  if (left + nw > innerWidth - 16) {
    if (arrow === 'right') { arrow = 'left'; left = r.left - nw - gap; }
    else left = innerWidth - nw - 16;
  }
  if (top < 16) { if (arrow === 'above') { arrow = 'below'; top = r.bottom + gap; } else top = 16; }
  if (top + nh > innerHeight - 16) {
    if (arrow === 'below') { arrow = 'above'; top = r.top - nh - gap; }
    else top = Math.max(16, innerHeight - nh - 16);
  }

  note.style.left = `${Math.round(left)}px`;
  note.style.top = `${Math.round(top)}px`;
  note.dataset.arrow = arrow;
  // The arrow sits on the note's edge, lined up with the middle of the target
  // rather than the middle of the note -- which are rarely the same once the
  // note has been nudged back on screen.
  const ax = Math.min(Math.max(r.left + r.width / 2 - left, 20), nw - 20);
  const ay = Math.min(Math.max(r.top + r.height / 2 - top, 20), nh - 20);
  note.style.setProperty('--ax', `${Math.round(ax)}px`);
  note.style.setProperty('--ay', `${Math.round(ay)}px`);
}

// First visit only, and only once the sheet is actually on screen -- a tour
// that points at a grid still being drawn points at nothing.
// Once per page load, not once per render -- renderProject runs on every
// realtime change, and a tour that restarted itself at step one each time
// would be unescapable.
let autoTried = false;
export function maybeStartTour() {
  if (autoTried || tourSeen() || !state.projectId) return;
  autoTried = true;
  requestAnimationFrame(() => requestAnimationFrame(startTour));
}

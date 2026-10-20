// Who else has this project open, and where they are in it.
//
// This file owns one question: who is here right now? It is the only part of
// the app with no database behind it -- presence lives in the Realtime channel
// and disappears when the tab does, which is exactly what "who is here" means.
// Nothing here is authoritative and nothing here is saved; if it is wrong for a
// second, the worst case is a circle in the wrong place.
//
// Where someone is riding along in the presence payload rather than on a
// separate broadcast is deliberate: one mechanism means someone arriving late
// sees everyone's current selection immediately, instead of waiting for each
// of them to move.

import { sb } from './client.js';
import { state, myEmail, sheet, gridColumns, visibleRows } from './state.js';
import { esc } from './util.js';
import { on } from './bus.js';

// A colour per person, from their address, so everyone sees the same person in
// the same colour without anyone having to agree on it. Hues are spread around
// the wheel; saturation and lightness are fixed so none of them vanish against
// either theme.
const hueOf = email => {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % 360;
  return h;
};
export const peerColour = email => `hsl(${hueOf(email)} 62% 45%)`;

// Everyone here but me, in a stable order so the circles don't shuffle about.
export const peerList = () => [...state.peers.values()]
  .filter(p => p.email !== myEmail())
  .sort((a, b) => a.email.localeCompare(b.email));

export function peersHTML() {
  const peers = peerList();
  if (!peers.length) return '';
  const shown = peers.slice(0, 5);
  return `<span class="peers" id="peers">${shown.map(p => `
    <span class="peer" style="--pc:${peerColour(p.email)}" title="${esc(p.email)} is here"
      role="img" aria-label="${esc(p.email)} is here">${esc(initials(p.email))}</span>`).join('')}${
    peers.length > shown.length ? `<span class="peer more" title="${esc(peers.slice(5).map(p => p.email).join('\n'))}">+${peers.length - shown.length}</span>` : ''}</span>`;
}

// Two letters from the address, which is all a 24px circle can hold. The part
// before the @ is what people recognise; the full address is on hover.
function initials(email) {
  const name = email.split('@')[0];
  const parts = name.split(/[.\-_+]/).filter(Boolean);
  return ((parts[0] || name)[0] + (parts[1] ? parts[1][0] : (parts[0] || name)[1] || '')).toUpperCase();
}

// ---------- the channel ----------

let channel = null, mine = null, sendTimer = null, pending = false;

export function startPresence(projectId) {
  stopPresence();
  const email = myEmail();
  if (!email) return;
  mine = { email, subject: state.subject, sel: null };
  channel = sb.channel('presence-' + projectId, { config: { presence: { key: email } } });
  channel
    .on('presence', { event: 'sync' }, () => {
      const seen = channel.presenceState();
      state.peers = new Map();
      // One person with three tabs open is one person. The newest payload wins,
      // so the circle follows whichever tab they last clicked in.
      for (const key of Object.keys(seen)) {
        const last = seen[key][seen[key].length - 1];
        if (last?.email) state.peers.set(last.email, last);
      }
      paintPeerStrip();
      paintPeers();
    })
    .subscribe(status => { if (status === 'SUBSCRIBED') track(); });
}

export function stopPresence() {
  if (channel) sb.removeChannel(channel);
  channel = null;
  mine = null;
  state.peers = new Map();
  clearTimeout(sendTimer);
  sendTimer = null;
  pending = false;
}

// Dragging across a block of cells fires on every cell it crosses, so what goes
// out is throttled to the trailing edge of a window. A circle a quarter second
// behind is unnoticeable; a hundred messages a second would get the socket
// rate-limited and lose the lot.
const SEND_EVERY = 250;
function track() {
  if (!channel || !mine) return;
  if (sendTimer) { pending = true; return; }
  channel.track(mine);
  sendTimer = setTimeout(() => {
    sendTimer = null;
    if (pending) { pending = false; track(); }
  }, SEND_EVERY);
}

// What I have selected, as ids rather than positions: the person reading it has
// their own sort and their own filters, so a row number would point somewhere
// else on their screen. Ids mean a cell either exists for them or doesn't.
function myselection() {
  if (!state.cellA || !state.cellB) return null;
  return {
    a: { room: state.cellA.room, field: state.cellA.field },
    b: { room: state.cellB.room, field: state.cellB.field },
  };
}

on('selection', () => {
  if (!mine) return;
  mine = { ...mine, subject: state.subject, sel: myselection() };
  track();
});
on('painted', () => paintPeers());

// ---------- drawing them on the sheet ----------

// Someone else's rectangle, worked out against *my* row and column order --
// which is why only the corners travel. A peer looking at the Types sheet while
// I am on Instances is simply not drawn.
function peerCells(p) {
  if (!p.sel || p.subject !== state.subject) return [];
  const rooms = visibleRows().map(r => r.id);
  const cols = gridColumns().map(f => f.id);
  const r1 = rooms.indexOf(p.sel.a.room), r2 = rooms.indexOf(p.sel.b.room);
  const c1 = cols.indexOf(p.sel.a.field), c2 = cols.indexOf(p.sel.b.field);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return [];   // filtered out of my view
  const out = [];
  for (let i = Math.min(r1, r2); i <= Math.max(r1, r2); i++)
    for (let j = Math.min(c1, c2); j <= Math.max(c1, c2); j++)
      out.push({ room: rooms[i], col: j });
  return out;
}

// A cap, because someone who selects a whole column shouldn't cost everyone
// else a thousand style writes. The first cells of their block still show, so
// you can see roughly where they are.
const PEER_CAP = 300;
let painted = [];

export function paintPeers() {
  painted.forEach(td => {
    td.classList.remove('peer-cell');
    td.style.removeProperty('--pc');
    td.removeAttribute('data-peer');
  });
  painted = [];
  if (!document.querySelector('.grid tbody')) return;
  const lead = sheet().lead;
  const rows = new Map([...document.querySelectorAll('.grid tbody tr')].map(tr => [tr.dataset.room, tr]));
  for (const p of peerList()) {
    const cells = peerCells(p).slice(0, PEER_CAP);
    for (const c of cells) {
      const td = rows.get(c.room)?.children[c.col + lead];
      if (!td) continue;
      // Two people on one cell: the later one wins the outline rather than the
      // two fighting over it. The title still names whoever is drawn.
      td.classList.add('peer-cell');
      td.style.setProperty('--pc', peerColour(p.email));
      td.setAttribute('data-peer', p.email);
      painted.push(td);
    }
  }
}

// The strip of circles in the header. Patched in place rather than through a
// re-render, because people coming and going must never cost anyone the cell
// they are typing in.
export function paintPeerStrip() {
  const slot = document.getElementById('peerslot');
  if (slot) slot.innerHTML = peersHTML();
}

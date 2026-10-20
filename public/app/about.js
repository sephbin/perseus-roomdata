// Which version is this, and is it the current one?
//
// This file exists because of a real afternoon lost to the question. A fix was
// written, committed, pushed and deployed, and the bug carried on happening --
// because the person seeing it had a tab open from before, and a tab keeps the
// modules it loaded for as long as it lives. GitHub Pages holding assets for
// ten minutes makes it worse. So "is it fixed" splits into two questions, and
// only one of them is about the code.
//
// The check fetches version.js again with a cache-busting query, which the
// browser cannot answer from the copy it already has. If the number that comes
// back is higher than the one compiled into this page, this page is stale and
// the answer is a reload -- said plainly, because the person reading it is
// usually already frustrated.

import { BUILD, BUILT, VERSION } from './version.js';
import { esc } from './util.js';

let root = null, onKey = null;

export function closeAbout() {
  if (onKey) removeEventListener('keydown', onKey, true);
  onKey = null;
  root?.remove();
  root = null;
}

export function showAbout() {
  closeAbout();
  root = document.createElement('div');
  root.className = 'modal';
  root.innerHTML = `
    <div class="modal-dim"></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <h2 id="about-title">Room data</h2>
      <dl class="about-grid">
        <dt>Version</dt><dd>${esc(VERSION)}</dd>
        <dt>Build</dt><dd>${BUILD}</dd>
        <dt>Built</dt><dd>${esc(BUILT)}</dd>
      </dl>
      <p class="about-state" id="about-state">Checking for a newer version…</p>
      <footer>
        <span class="grow"></span>
        <button id="about-reload" hidden class="primary">Reload now</button>
        <button id="about-close">Close</button>
      </footer>
    </div>`;
  document.body.appendChild(root);
  root.querySelector('.modal-dim').onclick = closeAbout;
  document.getElementById('about-close').onclick = closeAbout;
  document.getElementById('about-reload').onclick = () => location.reload(true);
  onKey = e => { if (e.key === 'Escape') { e.preventDefault(); closeAbout(); } };
  addEventListener('keydown', onKey, true);
  checkLatest();
}

async function checkLatest() {
  const say = (text, stale) => {
    const el = document.getElementById('about-state');
    if (!el) return;                       // closed while we were waiting
    el.textContent = text;
    el.classList.toggle('stale', !!stale);
    const btn = document.getElementById('about-reload');
    if (btn) btn.hidden = !stale;
  };
  try {
    // The query string is the point: without it the browser is free to answer
    // from the very cache we are trying to see past.
    const res = await fetch(`./app/version.js?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    const served = Number((text.match(/export const BUILD = (\d+)/) || [])[1]);
    if (!Number.isFinite(served)) throw new Error('no build number');
    if (served > BUILD) {
      say(`Build ${served} is available. This tab is still running build ${BUILD} — reload to pick it up.`, true);
    } else {
      say(`Up to date. The server is serving build ${served} too.`);
    }
  } catch {
    // Offline, or opened from a file. Not knowing is worth saying out loud
    // rather than quietly claiming to be current.
    say('Couldn’t reach the server to check, so this may not be the latest.');
  }
}

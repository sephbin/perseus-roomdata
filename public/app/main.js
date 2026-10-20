// Entry point: decides what to show, and connects the pieces that deliberately
// don't know about each other.
import { startClient, sb } from './client.js';
import { state, currentProjectId } from './state.js';
import { toast, friendly } from './util.js';
import { onRender } from './bus.js';
import { loadProject, loadProjects } from './data.js';
import { renderLogin } from './auth.js';
import { renderProject } from './view.js';
import { stopPresence } from './presence.js';

function route() {
  if (!state.session) { leaveProject(); return renderLogin(); }
  const pid = currentProjectId();
  if (pid) {
    if (pid !== state.projectId) loadProject(pid);
  } else {
    leaveProject();
    loadProjects();
  }
}

function leaveProject() {
  if (state.channel) { sb.removeChannel(state.channel); state.channel = null; }
  stopPresence();
  state.projectId = null;
  state.drawer = null;
}

// Nothing is allowed to fail in silence. A write that throws instead of
// returning an { error } -- a dropped connection mid-request is the usual way
// -- would otherwise leave someone looking at a button that did nothing, which
// is exactly how "adding a column didn't work" gets reported with nothing to
// go on. The console keeps the real thing; the toast just says it happened.
addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
  toast(friendly(e.reason), true);
});
addEventListener('error', e => {
  if (e.message) console.error('Uncaught error:', e.error || e.message);
});

onRender(renderProject);
startClient(route);

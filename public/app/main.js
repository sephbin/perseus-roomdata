// Entry point: decides what to show, and connects the pieces that deliberately
// don't know about each other.
import { startClient, sb } from './client.js';
import { state, currentProjectId } from './state.js';
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

onRender(renderProject);
startClient(route);

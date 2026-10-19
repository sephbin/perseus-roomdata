// The Supabase client, and the two things that decide what to show: the auth
// session and the URL hash. `startClient` takes the router rather than calling
// it, so this file doesn't need to know what a route is.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { app, state } from './state.js';

export let sb;

export function startClient(onRoute) {
  if (SUPABASE_URL.includes('YOUR-PROJECT')) {
    app.innerHTML = `<main class="narrow"><h1>Almost there</h1>
      <p>Open <b>app/config.js</b> and paste your Supabase project URL and publishable key into it.</p></main>`;
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  sb.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    const uid = session?.user?.id ?? null;
    if (uid !== state.lastUserId) {
      state.lastUserId = uid;
      setTimeout(onRoute, 0); // never await Supabase calls inside this callback
    }
  });
  addEventListener('hashchange', onRoute);
}

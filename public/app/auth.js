// Signing in: password by default, emailed code behind a link.
import { sb } from './client.js';
import { app } from './state.js';
import { esc, toast, friendly } from './util.js';

export function signInError(e) {
  const msg = e?.message || '';
  if (e?.code === 'invalid_credentials' || /invalid login/i.test(msg))
    return 'That email and password don’t match. Ask whoever set up the project for the password.';
  if (e?.code === 'email_not_confirmed' || /not confirmed/i.test(msg))
    return 'That account hasn’t been confirmed yet. Ask whoever set up the project to confirm it.';
  return friendly(e);
}

export function renderLogin(sentTo = '', mode = 'password') {
  app.innerHTML = `
  <main class="narrow">
    <h1>Room data</h1>
    ${sentTo ? `
      <p>We’ve emailed <b>${esc(sentTo)}</b>. Click the link in the email, or type the code from it here.</p>
      <form id="f-code">
        <label for="code">Sign-in code</label>
        <input id="code" inputmode="numeric" autocomplete="one-time-code" required>
        <button class="primary">Sign in</button>
      </form>
      <p><button class="link" id="restart">Use a different email</button></p>
    ` : mode === 'otp' ? `
      <p class="muted">Sign in with your work email. You’ll get a link and a code by email, so there’s no password to remember.</p>
      <form id="f-email">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required>
        <button class="primary">Send sign-in email</button>
      </form>
      <p><button class="link" id="to-password">Sign in with a password instead</button></p>
    ` : `
      <p class="muted">Sign in with the email and password you were given.</p>
      <form id="f-password">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required>
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" required>
        <button class="primary">Sign in</button>
      </form>
      <p><button class="link" id="to-otp">Email me a sign-in code instead</button></p>
    `}
  </main>`;

  document.getElementById('f-password')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) toast(signInError(error), true);
  });
  document.getElementById('f-email')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const btn = e.target.querySelector('button'); btn.disabled = true;
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname },
    });
    btn.disabled = false;
    if (error) return toast(friendly(error), true);
    renderLogin(email);
  });
  document.getElementById('f-code')?.addEventListener('submit', async e => {
    e.preventDefault();
    const token = document.getElementById('code').value.trim();
    const { error } = await sb.auth.verifyOtp({ email: sentTo, token, type: 'email' });
    if (error) toast(friendly(error), true);
  });
  document.getElementById('restart')?.addEventListener('click', () => renderLogin('', 'otp'));
  document.getElementById('to-otp')?.addEventListener('click', () => renderLogin('', 'otp'));
  document.getElementById('to-password')?.addEventListener('click', () => renderLogin());
}

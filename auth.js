/* ============================================================================
 *  auth.js — Login gate for the CID Platform.
 *  Logged-out users see ONLY the login screen. Signed-in-but-unapproved users
 *  see a pending-approval screen. Approved (active profile) users get the app.
 *  Drives body[data-auth] (out|in); styling in styles.css hides the shell when out.
 * ========================================================================== */
(function () {
  'use strict';

  function setState(s) { document.body.setAttribute('data-auth', s); }
  function gateBody(html) { var b = document.getElementById('gate-body'); if (b) b.innerHTML = html; }

  function showSetup(msg) {
    setState('out');
    gateBody('<div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">' + msg + '</div>');
  }

  function showLogin() {
    setState('out');
    gateBody(
      '<p class="mb-4 text-sm text-slate-400">Authorized personnel only. Sign in to access the division portal.</p>' +
      '<button id="g-google" class="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Continue with Google</button>' +
      '<button id="g-discord" class="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">Continue with Discord</button>' +
      '<div class="flex items-center gap-2"><input id="g-email" type="email" placeholder="you@email.com" class="flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" /><button id="g-magic" class="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Email link</button></div>' +
      '<p id="g-msg" class="mt-3 text-xs text-slate-500"></p>'
    );
    var msg = function (t) { var e = document.getElementById('g-msg'); if (e) e.textContent = t; };
    document.getElementById('g-google').onclick = async function () { var r = await window.CIDDB.signInOAuth('google'); if (r && r.error) msg('Google error: ' + r.error.message); };
    document.getElementById('g-discord').onclick = async function () { var r = await window.CIDDB.signInOAuth('discord'); if (r && r.error) msg('Discord error: ' + r.error.message); };
    document.getElementById('g-magic').onclick = async function () {
      var em = document.getElementById('g-email').value.trim();
      if (!em) { msg('Enter your email first.'); return; }
      var r = await window.CIDDB.signInEmail(em);
      msg(r && r.error ? ('Error: ' + r.error.message) : 'Magic link sent — check your inbox.');
    };
  }

  function showPending(session) {
    setState('out');
    var who = (session.user && session.user.email) || 'Your account';
    gateBody(
      '<div class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">⏳ <b>' + who + '</b> is signed in but not yet approved. A Command/Director must activate your profile before you can access the portal.</div>' +
      '<button id="g-out" class="mt-4 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Sign out</button>'
    );
    document.getElementById('g-out').onclick = function () { window.CIDDB.signOut(); };
  }

  function showApp(profile, session) {
    setState('in');
    var header = document.querySelector('header');
    if (!header) return;
    var slot = document.getElementById('auth-slot');
    if (!slot) {
      slot = document.createElement('div'); slot.id = 'auth-slot'; slot.className = 'flex flex-shrink-0 items-center gap-2';
      (header.lastElementChild || header).appendChild(slot);
    }
    var name = (profile && profile.display_name) || (session.user && session.user.email) || 'Officer';
    var av = profile && profile.avatar_url;
    slot.innerHTML =
      '<span class="hidden items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-slate-200 sm:flex">' +
        (av ? '<img src="' + av + '" class="h-5 w-5 rounded-full object-cover" alt="" />' : '👤') + ' ' + name +
        (profile ? ' · <span class="uppercase text-blue-300">' + profile.role + '</span>' : '') +
      '</span>' +
      '<button id="auth-out" class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-white/10">Sign out</button>';
    document.getElementById('auth-out').onclick = function () { window.CIDDB.signOut(); };
  }

  async function evaluate() {
    if (!window.CIDDB || !window.CIDDB.ready) {
      showSetup(window.supabase
        ? 'Live access is not configured — set <code>window.CID_SUPABASE.anonKey</code> to this project\'s anon/publishable key.'
        : 'The authentication service could not load (offline?). Reconnect to sign in.');
      return;
    }
    var session = await window.CIDDB.getSession();
    if (!session) { showLogin(); return; }
    var profile = await window.CIDDB.profile(session.user.id);
    if (profile && profile.active) showApp(profile, session);
    else showPending(session);
  }

  function boot() {
    evaluate();
    if (window.CIDDB && window.CIDDB.onAuth) window.CIDDB.onAuth(function () { evaluate(); });
  }
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();

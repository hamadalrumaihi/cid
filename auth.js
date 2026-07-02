/* ============================================================================
 *  auth.js — Login gate for the CID Platform.
 *  Logged-out users see ONLY the login screen. Signed-in-but-unapproved users
 *  see a pending-approval screen. Approved (active profile) users get the app.
 *  Drives body[data-auth] (out|in); styling in styles.css hides the shell when out.
 * ========================================================================== */
(function () {
  'use strict';

  var lastSession = null;   // retained so the top bar can re-render after LOA toggles
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
    var who = escapeHTML((session.user && session.user.email) || 'Your account');
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
    lastSession = session;
    var name = (profile && profile.display_name) || (session.user && session.user.email) || 'Officer';
    var av = profile && profile.avatar_url;
    var onLoa = !!(profile && profile.loa);
    var roleCapsText = ({
      detective: 'View & edit records, log evidence, author reports, submit cases for sign-off.',
      senior_detective: 'View & edit records, log evidence, author reports, submit cases for sign-off.',
      bureau_lead: 'All detective actions + review/approve sign-offs, delete records, manage announcements (your bureau).',
      deputy_director: 'Bureau-lead actions + cross-bureau oversight and command tools.',
      director: 'Full command: cross-bureau oversight, sign-offs, deletes, roster & announcements.',
    })[profile && profile.role] || 'Active member access.';
    slot.innerHTML =
      '<span title="Your access: ' + roleCapsText.replace(/"/g, '&quot;') + '" class="hidden cursor-help items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-slate-200 sm:flex">' +
        (av ? '<img src="' + escapeHTML(safeUrl(av)) + '" class="h-5 w-5 rounded-full object-cover" alt="" />' : '👤') + ' ' + escapeHTML(name) +
        (profile ? ' · <span class="uppercase text-blue-300">' + escapeHTML(profile.role) + '</span>' : '') +
      '</span>' +
      (onLoa ? '<span class="rounded-lg bg-amber-500/15 px-2 py-2 text-[11px] font-semibold uppercase text-amber-300" title="You are marked On LOA">On LOA</span>' : '') +
      '<button id="auth-loa" class="rounded-lg border px-2.5 py-2 text-xs font-semibold transition ' + (onLoa ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10' : 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10') + '">' + (onLoa ? 'Clear LOA' : 'Set LOA') + '</button>' +
      '<button id="auth-out" class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold text-white transition hover:bg-white/10">Sign out</button>';
    var loaBtn = document.getElementById('auth-loa');
    if (loaBtn) loaBtn.onclick = function () { if (window.CIDApp && window.CIDApp.setMyLoa) window.CIDApp.setMyLoa(!onLoa); };
    document.getElementById('auth-out').onclick = function () { window.CIDDB.signOut(); };
  }
  function showAuthError() {
    setState('out');
    gateBody(
      '<div class="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">Couldn’t verify your account (network hiccup?). Your session is fine — try again.</div>' +
      '<button id="g-retry" class="mt-4 w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Retry</button>'
    );
    var r = document.getElementById('g-retry'); if (r) r.onclick = function () { evaluate(); };
  }
  window.CIDApp = window.CIDApp || {};
  // Chain any refreshAuthBar already registered (collab.js registers the sidebar
  // officer-card refresh) instead of clobbering it, so LOA toggles refresh both.
  var _prevRefreshAuthBar = window.CIDApp.refreshAuthBar;
  window.CIDApp.refreshAuthBar = function () {
    if (window.CIDDB && window.CIDDB.me && lastSession) showApp(window.CIDDB.me, lastSession);
    if (typeof _prevRefreshAuthBar === 'function') { try { _prevRefreshAuthBar(); } catch (e) {} }
  };

  // onAuthed does the heavy one-time work (fetch-all + ~30 realtime subscriptions).
  // supabase-js fires INITIAL_SESSION + TOKEN_REFRESHED (~hourly) + SIGNED_IN, and
  // boot() also calls evaluate() directly, so without this guard onAuthed would
  // re-run on every event — a double fetch-all at boot and an hourly refetch storm.
  // Fire it only on the first transition to a given active user; reset on sign-out.
  var lastAuthedUid = null;

  async function evaluate() {
    if (!window.CIDDB || !window.CIDDB.ready) {
      showSetup(window.supabase
        ? 'Live access is not configured — set <code>window.CID_SUPABASE.anonKey</code> to this project\'s anon/publishable key.'
        : 'The authentication service could not load (offline?). Reconnect to sign in.');
      return;
    }
    var session = await window.CIDDB.getSession();
    if (!session) {
      // Signed out: drop the cached identity and tear down realtime so a different
      // account on a shared browser doesn't inherit the previous member's state.
      lastAuthedUid = null;
      if (window.CIDDB) { window.CIDDB.me = null; if (window.CIDDB.removeAllChannels) window.CIDDB.removeAllChannels(); }
      showLogin(); return;
    }
    var profile;
    try { profile = await window.CIDDB.profile(session.user.id); }
    catch (e) { showAuthError(); return; }   // transient error — offer retry, don't mislabel as unapproved
    window.CIDDB.me = profile || null;
    if (profile && profile.active) {
      showApp(profile, session);
      // Capture the Discord user id (for DM notifications) from a Discord OAuth identity.
      try {
        var ids = (session.user && session.user.identities) || [];
        var disc = ids.filter(function (i) { return i.provider === 'discord'; })[0];
        var did = disc && ((disc.identity_data && (disc.identity_data.provider_id || disc.identity_data.sub)) || disc.id);
        if (did && !profile.discord_id && window.CIDDB.from) {
          window.CIDDB.from('profiles').update({ discord_id: String(did) }).eq('id', profile.id).then(function () {});
          profile.discord_id = String(did); if (window.CIDDB.me) window.CIDDB.me.discord_id = String(did);
        }
      } catch (e) {}
      if (window.CIDApp && typeof window.CIDApp.onAuthed === 'function' && lastAuthedUid !== profile.id) {
        lastAuthedUid = profile.id;
        window.CIDApp.onAuthed(profile, session);
      }
    } else showPending(session);
  }

  function boot() {
    evaluate();
    if (window.CIDDB && window.CIDDB.onAuth) window.CIDDB.onAuth(function () { evaluate(); });
  }
  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();

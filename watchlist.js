/* watchlist.js — Wave 5 "Follow / Watchlist". Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html: after
   vehicles.js, before feedback.js / app.js).

   A per-member, opt-in follow list over cases, persons and vehicles. Following
   never widens access — the targets stay bureau-isolated by their own RLS; a
   follow is a personal bookmark that surfaces "what moved" on My Desk. Backed by
   the `watchlist` table (RLS: each row owned by, and visible only to, one member).

   Public surface used elsewhere:
     watchBtnHtml(type,id,label,opts) → HTML for a follow toggle (delegated click)
     isWatched(type,id) · toggleWatch(type,id,label)
     fetchWatchlist() · deskWatchlist() (My Desk section) · watchlistNewCount() */
"use strict";

    let WATCHLIST = [];   // rows: { id, user_id, target_type, target_id, created_at }
    const WATCH_TYPES = { case: 'case', person: 'person', vehicle: 'vehicle' };

    // "Last seen" per followed target so we can flag items that moved since you
    // last looked. Persisted client-side (Store) — it's a personal read-marker,
    // not shared state.
    const watchSeen = () => (typeof Store !== 'undefined' ? Store.get('watchSeen', {}) : {});
    const watchKey = (type, id) => type + ':' + id;
    function markWatchSeen(type, id, ts) {
      if (typeof Store === 'undefined') return;
      const m = watchSeen(); m[watchKey(type, id)] = ts || new Date().toISOString(); Store.set('watchSeen', m);
    }

    async function fetchWatchlist() {
      if (!dbReady() || !(DB() && DB().me)) { WATCHLIST = []; return WATCHLIST; }
      try { WATCHLIST = await DB().list('watchlist', { order: 'created_at', ascending: false }); }
      catch (e) { WATCHLIST = []; }
      return WATCHLIST;
    }
    function watchRow(type, id) { return WATCHLIST.find((w) => w.target_type === type && w.target_id === id); }
    function isWatched(type, id) { return !!watchRow(type, id); }

    // Toggle follow state. Returns the NEW state (true = now following).
    async function toggleWatch(type, id, label) {
      if (!(dbReady() && DB() && DB().me)) { toast('Sign in to follow.', 'warn'); return isWatched(type, id); }
      if (!WATCH_TYPES[type] || !id) return false;
      const existing = watchRow(type, id);
      if (existing) {
        const res = await DB().remove('watchlist', existing.id);
        if (res && res.error) { toast('Unfollow failed: ' + res.error.message, 'danger'); return true; }
        WATCHLIST = WATCHLIST.filter((w) => w.id !== existing.id);
        toast('Unfollowed' + (label ? ' ' + label : ''), 'info');
        return false;
      }
      const res = await DB().insert('watchlist', { target_type: type, target_id: id });
      if (res && res.error) {
        // A double-click race can hit the unique index — treat as already-following.
        if (/duplicate|unique|23505/i.test(res.error.message || '')) { await fetchWatchlist(); return isWatched(type, id); }
        toast('Follow failed: ' + res.error.message, 'danger'); return false;
      }
      if (res.data && res.data[0]) WATCHLIST.unshift(res.data[0]); else await fetchWatchlist();
      markWatchSeen(type, id);   // following it now = you've seen its current state
      toast('Following' + (label ? ' ' + label : '') + ' — updates show on My Desk', 'success');
      return true;
    }

    // Follow-toggle button. `opts.compact` renders a star-only pill (for cards).
    function watchBtnHtml(type, id, label, opts) {
      opts = opts || {};
      const on = isWatched(type, id);
      const tint = on ? 'text-amber-300 border-amber-500/30 bg-amber-500/10' : 'text-slate-200 border-white/10 bg-white/5';
      const txt = opts.compact ? (on ? '★' : '☆') : (on ? '★ Following' : '☆ Follow');
      return `<button class="watch-btn rounded-md border px-2.5 py-1 text-xs font-semibold transition hover:bg-white/10 ${tint}" data-wt="${escapeHTML(type)}" data-wi="${escapeHTML(id)}" data-wl="${escapeHTML(label || '')}" data-wc="${opts.compact ? '1' : '0'}" title="${on ? 'Following — click to unfollow' : 'Follow for updates on My Desk'}" aria-pressed="${on}">${txt}</button>`;
    }
    // Repaint every follow-toggle for a target in place (no full re-render needed).
    function repaintWatchBtns(type, id) {
      const on = isWatched(type, id);
      document.querySelectorAll('.watch-btn').forEach((x) => {
        if (x.dataset.wt !== type || x.dataset.wi !== id) return;
        const compact = x.dataset.wc === '1';
        x.className = 'watch-btn rounded-md border px-2.5 py-1 text-xs font-semibold transition hover:bg-white/10 ' + (on ? 'text-amber-300 border-amber-500/30 bg-amber-500/10' : 'text-slate-200 border-white/10 bg-white/5');
        x.textContent = compact ? (on ? '★' : '☆') : (on ? '★ Following' : '☆ Follow');
        x.title = on ? 'Following — click to unfollow' : 'Follow for updates on My Desk';
        x.setAttribute('aria-pressed', String(on));
      });
    }

    // One delegated handler for every follow toggle anywhere in the app.
    document.addEventListener('click', async (e) => {
      const b = e.target && e.target.closest ? e.target.closest('.watch-btn') : null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      if (b.dataset.busy === '1') return; b.dataset.busy = '1';
      try { await toggleWatch(b.dataset.wt, b.dataset.wi, b.dataset.wl); repaintWatchBtns(b.dataset.wt, b.dataset.wi); }
      finally { b.dataset.busy = '0'; }
    });

    /* ---- My Desk surfacing --------------------------------------------------
       Resolve each followed target to its live record (from the RLS-scoped
       caches) and flag anything that moved since you last saw it. */
    function resolveWatchTarget(w) {
      if (w.target_type === 'case') {
        const c = (typeof casesCache !== 'undefined' ? casesCache : []).find((x) => x.id === w.target_id);
        if (!c) return null;
        return { icon: '🗂️', title: c.case_number + ' · ' + (c.title || 'Untitled'), sub: c.bureau + ' · ' + c.status, ts: c.updated_at, open: () => openDeskCaseTab(c.id, 'overview'), w };
      }
      if (w.target_type === 'person') {
        const p = (typeof PERSONS !== 'undefined' ? PERSONS : []).find((x) => x.id === w.target_id);
        if (!p) return null;
        return { icon: '👤', title: p.name || 'Person', sub: [p.alias ? '“' + p.alias + '”' : '', p.status || ''].filter(Boolean).join(' · ') || 'Person of interest', ts: p.updated_at, open: () => { if (typeof openIntelProfile === 'function') openIntelProfile('person', p.id); }, w };
      }
      if (w.target_type === 'vehicle') {
        const v = (typeof VEHICLES !== 'undefined' ? VEHICLES : []).find((x) => x.id === w.target_id);
        if (!v) return null;
        return { icon: '🚗', title: v.plate, sub: [v.model, v.color].filter(Boolean).join(' · ') || 'Registered plate', ts: v.updated_at, open: () => { if (typeof navigate === 'function') navigate('vehicles'); }, w };
      }
      return null;
    }
    function watchResolvedItems() {
      return WATCHLIST.map(resolveWatchTarget).filter(Boolean);
    }
    function isWatchNew(item) {
      const seen = watchSeen()[watchKey(item.w.target_type, item.w.target_id)];
      if (!item.ts) return false;
      if (!seen) return true;   // followed before this marker existed → treat any activity as new-ish
      return new Date(item.ts).getTime() > new Date(seen).getTime();
    }
    function watchlistNewCount() { return watchResolvedItems().filter(isWatchNew).length; }

    // My Desk section. Followed items with activity-since-last-seen float to the top.
    function deskWatchlist() {
      const items = watchResolvedItems();
      const wrap = el('div', {});
      if (!items.length) return wrap;
      const newCount = items.filter(isWatchNew).length;
      items.sort((a, b) => (isWatchNew(b) - isWatchNew(a)) || (new Date(b.ts || 0) - new Date(a.ts || 0)));
      wrap.innerHTML = `<div class="mb-2 mt-2 flex items-center justify-between">
        <h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Following <span class="ml-1 text-slate-500">(${items.length})</span></h4>
        <div class="flex items-center gap-2">${newCount ? `<span class="text-[11px] font-semibold text-amber-300">${newCount} updated</span>` : ''}${newCount ? '<button id="wl-seen" class="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10">Mark all seen</button>' : ''}</div>
      </div>
      <div class="space-y-2">${items.map((it, i) => {
        const fresh = isWatchNew(it);
        return `<div class="flex items-center justify-between gap-3 rounded-xl border ${fresh ? 'border-amber-500/25' : 'border-white/5'} bg-ink-900/60 p-3">
          <div class="min-w-0"><p class="truncate text-sm text-slate-200">${it.icon} ${escapeHTML(it.title)}${fresh ? ' <span class="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">updated</span>' : ''}</p><p class="text-[11px] text-slate-500">${escapeHTML(it.sub)}${it.ts ? ' · ' + (typeof timeAgo === 'function' ? timeAgo(it.ts) : new Date(it.ts).toLocaleDateString('en-US')) : ''}</p></div>
          <button class="wl-open flex-shrink-0 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110" data-i="${i}">Open →</button>
        </div>`;
      }).join('')}</div>`;
      wrap.querySelectorAll('.wl-open').forEach((b) => b.onclick = () => {
        const it = items[+b.dataset.i]; if (!it) return;
        markWatchSeen(it.w.target_type, it.w.target_id, it.ts);
        it.open();
      });
      const seenBtn = wrap.querySelector('#wl-seen');
      if (seenBtn) seenBtn.onclick = () => { items.forEach((it) => markWatchSeen(it.w.target_type, it.w.target_id, it.ts)); if (typeof onEnterInbox === 'function') onEnterInbox(); };
      return wrap;
    }

    // Load the follow list once auth resolves (chain the shared onAuthed hook,
    // matching inbox.js / feedback.js), and clear it on sign-out.
    document.addEventListener('DOMContentLoaded', () => {
      if (window.CIDApp) { const prev = window.CIDApp.onAuthed; window.CIDApp.onAuthed = function (p, s) { if (typeof prev === 'function') prev(p, s); fetchWatchlist(); }; }
      if (dbReady()) fetchWatchlist();
      if (DB() && DB().onAuth) DB().onAuth((s) => { if (!s) WATCHLIST = []; });
    });

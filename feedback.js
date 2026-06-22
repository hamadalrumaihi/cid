/* feedback.js — private, owner-only "suggest a feature / report a bug" tab.
   Shares the global lexical scope with the other app *.js files (see AGENTS.md).
   Gated to the app owner by uid/email on the client; the feedback table's RLS
   enforces the same owner-only access on the server. */
"use strict";

    const FEEDBACK_OWNER_ID = '25466146-c512-4497-8ee8-88cbf3b1d22d';
    const FEEDBACK_OWNER_EMAIL = 'hkalrumaihi@gmail.com';
    function isAppOwner() {
      const me = DB() && DB().me;
      return !!(me && (me.id === FEEDBACK_OWNER_ID || (me.email && me.email.toLowerCase() === FEEDBACK_OWNER_EMAIL)));
    }
    function updateOwnerNav() {
      const b = $('#nav-feedback'); if (!b) return;
      if (isAppOwner()) { b.classList.remove('hidden'); b.classList.add('flex'); }
      else { b.classList.add('hidden'); b.classList.remove('flex'); }
    }
    let FEEDBACK = [];
    const FB_KIND = {
      feature: { icon: '💡', label: 'Feature', tint: 'bg-blue-500/15 text-blue-300' },
      bug: { icon: '🐞', label: 'Bug', tint: 'bg-rose-500/15 text-rose-300' },
    };
    const FB_STATUS = {
      open: { label: 'Open', tint: 'bg-amber-500/15 text-amber-300' },
      done: { label: 'Done', tint: 'bg-emerald-500/15 text-emerald-300' },
      wontfix: { label: "Won't fix", tint: 'bg-slate-500/20 text-slate-300' },
    };
    async function fetchFeedback() {
      if (!isAppOwner() || !dbReady()) { FEEDBACK = []; renderFeedback(); return; }
      try { FEEDBACK = await DB().list('feedback', { order: 'created_at', ascending: false }); }
      catch (e) { toast('Couldn’t load feedback — check your connection.', 'danger'); }
      renderFeedback();
    }
    function onEnterFeedback() {
      if (!isAppOwner()) { navigate('command'); return; }
      fetchFeedback();
    }
    function renderFeedback() {
      const list = $('#feedback-list'); if (!list) return;
      if (!isAppOwner()) { list.innerHTML = ''; return; }
      if (!dbReady()) { list.innerHTML = '<p class="text-sm text-slate-500">Sign in to view your feedback.</p>'; return; }
      if (!FEEDBACK.length) { list.innerHTML = '<p class="text-sm text-slate-500">Nothing logged yet — add a feature idea or a bug above.</p>'; return; }
      const open = FEEDBACK.filter((f) => f.status === 'open');
      const closed = FEEDBACK.filter((f) => f.status !== 'open');
      const card = (f) => {
        const k = FB_KIND[f.kind] || FB_KIND.feature, s = FB_STATUS[f.status] || FB_STATUS.open;
        return `<div class="rounded-xl border border-white/10 bg-ink-900 p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><p class="text-sm font-semibold text-white">${k.icon} ${esc(f.title)}</p>${f.details ? `<p class="mt-1 whitespace-pre-wrap text-xs text-slate-400">${esc(f.details)}</p>` : ''}<p class="mt-1.5 text-[11px] text-slate-500">${new Date(f.created_at).toLocaleString('en-US')}</p></div>
            <span class="flex flex-shrink-0 items-center gap-1.5"><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${k.tint}">${k.label}</span><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${s.tint}">${s.label}</span></span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${f.status !== 'done' ? `<button class="fb-status rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-white/10" data-id="${f.id}" data-to="done">✓ Done</button>` : `<button class="fb-status rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-white/10" data-id="${f.id}" data-to="open">↩ Reopen</button>`}
            ${f.status !== 'wontfix' ? `<button class="fb-status rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10" data-id="${f.id}" data-to="wontfix">Won't fix</button>` : ''}
            <button class="fb-del rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/10" data-id="${f.id}">Delete</button>
          </div></div>`;
      };
      list.innerHTML = `<p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Open (${open.length})</p><div class="space-y-3">${open.length ? open.map(card).join('') : '<p class="text-sm text-slate-500">No open items — nice.</p>'}</div>`
        + (closed.length ? `<p class="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400">Closed (${closed.length})</p><div class="space-y-3">${closed.map(card).join('')}</div>` : '');
      $$('.fb-status', list).forEach((b) => b.onclick = async () => {
        const res = await DB().update('feedback', b.dataset.id, { status: b.dataset.to, updated_at: new Date().toISOString() });
        if (res && res.error) { toast('Update failed: ' + res.error.message, 'danger'); return; }
        fetchFeedback();
      });
      $$('.fb-del', list).forEach((b) => b.onclick = async () => {
        if (!(await uiConfirm('Delete this item?', { confirmText: 'Delete' }))) return;
        const res = await DB().remove('feedback', b.dataset.id);
        if (res && res.error) { toast('Delete failed: ' + res.error.message, 'danger'); return; }
        toast('Deleted', 'info'); fetchFeedback();
      });
    }
    async function addFeedback() {
      if (!isAppOwner()) return;
      const titleEl = $('#fb-title'); const title = titleEl ? titleEl.value.trim() : '';
      if (!title) { toast('Give it a short title first.', 'warn'); return; }
      const res = await DB().insert('feedback', { kind: $('#fb-kind').value, title: title, details: ($('#fb-details').value || '').trim() || null });
      if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
      $('#fb-title').value = ''; $('#fb-details').value = '';
      toast('Added to your feedback list', 'success'); fetchFeedback();
    }
    function initFeedback() {
      updateOwnerNav();
      const add = $('#fb-add'); if (add) add.onclick = addFeedback;
      const navBtn = $('#nav-feedback'); if (navBtn) navBtn.addEventListener('click', () => navigate('feedback'));
      const ti = $('#fb-title'); if (ti) ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFeedback(); } });
      // Re-evaluate owner-only nav visibility whenever auth state changes.
      if (window.CIDApp) { const prev = window.CIDApp.onAuthed; window.CIDApp.onAuthed = function (p, s) { if (typeof prev === 'function') prev(p, s); updateOwnerNav(); }; }
      if (DB() && DB().onAuth) DB().onAuth(() => updateOwnerNav());
    }

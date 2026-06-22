/* feedback.js — "suggest a feature / report a bug" tab.
   Shares the global lexical scope with the other app *.js files (see AGENTS.md).
   Any signed-in member can submit a request and see/withdraw their own; the app
   owner triages — only the owner reads every submission and changes status. The
   feedback table's RLS enforces the same split on the server. */
"use strict";

    // Both accounts belong to the app owner; either one triages feedback.
    const FEEDBACK_OWNER_IDS = ['25466146-c512-4497-8ee8-88cbf3b1d22d', '6554181a-e2ed-4993-a66f-420c08f1471c'];
    const FEEDBACK_OWNER_EMAILS = ['hkalrumaihi@gmail.com', 'jcarrter04@gmail.com'];
    function isAppOwner() {
      const me = DB() && DB().me;
      if (!me) return false;
      if (FEEDBACK_OWNER_IDS.includes(me.id)) return true;
      return !!(me.email && FEEDBACK_OWNER_EMAILS.includes(me.email.toLowerCase()));
    }
    // Show the Feedback tab to any signed-in member (everyone can request).
    function updateFeedbackNav() {
      const b = $('#nav-feedback'); if (!b) return;
      if (dbReady()) { b.classList.remove('hidden'); b.classList.add('flex'); }
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
    function fbSubmitter(f) {
      const me = DB() && DB().me;
      if (me && f.created_by === me.id) return 'You';
      if (typeof officerName === 'function') return officerName(f.created_by) || 'Member';
      return 'Member';
    }
    async function fetchFeedback() {
      if (!dbReady()) { FEEDBACK = []; renderFeedback(); return; }
      try { FEEDBACK = await DB().list('feedback', { order: 'created_at', ascending: false }); }
      catch (e) { toast('Couldn’t load feedback — check your connection.', 'danger'); }
      renderFeedback();
    }
    function onEnterFeedback() {
      const intro = $('#fb-intro');
      if (intro) intro.textContent = isAppOwner()
        ? 'Triage box — every member’s feature requests and bug reports land here. Mark them done, won’t-fix, or reopen.'
        : 'Suggest a feature or report a bug. Your note goes straight to the CID dev team — you’ll see your own submissions and their status below.';
      fetchFeedback();
    }
    function renderFeedback() {
      const list = $('#feedback-list'); if (!list) return;
      if (!dbReady()) { list.innerHTML = '<p class="text-sm text-slate-500">Sign in to submit feedback.</p>'; return; }
      const owner = isAppOwner();
      if (!FEEDBACK.length) {
        list.innerHTML = owner
          ? '<p class="text-sm text-slate-500">No submissions yet.</p>'
          : '<p class="text-sm text-slate-500">You haven’t submitted anything yet — add a feature idea or a bug above.</p>';
        return;
      }
      const card = (f) => {
        const k = FB_KIND[f.kind] || FB_KIND.feature, s = FB_STATUS[f.status] || FB_STATUS.open;
        const meta = owner
          ? `${esc(fbSubmitter(f))} · ${new Date(f.created_at).toLocaleString('en-US')}`
          : new Date(f.created_at).toLocaleString('en-US');
        return `<div class="rounded-xl border border-white/10 bg-ink-900 p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><p class="text-sm font-semibold text-white">${k.icon} ${esc(f.title)}</p>${f.details ? `<p class="mt-1 whitespace-pre-wrap text-xs text-slate-400">${esc(f.details)}</p>` : ''}<p class="mt-1.5 text-[11px] text-slate-500">${meta}</p></div>
            <span class="flex flex-shrink-0 items-center gap-1.5"><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${k.tint}">${k.label}</span><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${s.tint}">${s.label}</span></span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${owner ? (f.status !== 'done' ? `<button class="fb-status rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-white/10" data-id="${f.id}" data-to="done">✓ Done</button>` : `<button class="fb-status rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-white/10" data-id="${f.id}" data-to="open">↩ Reopen</button>`) : ''}
            ${owner && f.status !== 'wontfix' ? `<button class="fb-status rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10" data-id="${f.id}" data-to="wontfix">Won't fix</button>` : ''}
            <button class="fb-del rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/10" data-id="${f.id}">${owner ? 'Delete' : 'Withdraw'}</button>
          </div></div>`;
      };
      if (owner) {
        const open = FEEDBACK.filter((f) => f.status === 'open');
        const closed = FEEDBACK.filter((f) => f.status !== 'open');
        list.innerHTML = `<p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Open (${open.length})</p><div class="space-y-3">${open.length ? open.map(card).join('') : '<p class="text-sm text-slate-500">No open items — nice.</p>'}</div>`
          + (closed.length ? `<p class="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400">Closed (${closed.length})</p><div class="space-y-3">${closed.map(card).join('')}</div>` : '');
      } else {
        list.innerHTML = `<p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Your submissions (${FEEDBACK.length})</p><div class="space-y-3">${FEEDBACK.map(card).join('')}</div>`;
      }
      $$('.fb-status', list).forEach((b) => b.onclick = async () => {
        const res = await DB().update('feedback', b.dataset.id, { status: b.dataset.to, updated_at: new Date().toISOString() });
        if (res && res.error) { toast('Update failed: ' + res.error.message, 'danger'); return; }
        fetchFeedback();
      });
      $$('.fb-del', list).forEach((b) => b.onclick = async () => {
        if (!(await uiConfirm(owner ? 'Delete this item?' : 'Withdraw this submission?', { confirmText: owner ? 'Delete' : 'Withdraw' }))) return;
        const res = await DB().remove('feedback', b.dataset.id);
        if (res && res.error) { toast('Failed: ' + res.error.message, 'danger'); return; }
        toast(owner ? 'Deleted' : 'Withdrawn', 'info'); fetchFeedback();
      });
    }
    async function addFeedback() {
      if (!dbReady()) { toast('Sign in to submit feedback.', 'warn'); return; }
      const titleEl = $('#fb-title'); const title = titleEl ? titleEl.value.trim() : '';
      if (!title) { toast('Give it a short title first.', 'warn'); return; }
      const res = await DB().insert('feedback', { kind: $('#fb-kind').value, title: title, details: ($('#fb-details').value || '').trim() || null });
      if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
      $('#fb-title').value = ''; $('#fb-details').value = '';
      toast(isAppOwner() ? 'Added to your feedback list' : 'Thanks — your feedback was submitted', 'success'); fetchFeedback();
    }
    function initFeedback() {
      updateFeedbackNav();
      const add = $('#fb-add'); if (add) add.onclick = addFeedback;
      const navBtn = $('#nav-feedback'); if (navBtn) navBtn.addEventListener('click', () => navigate('feedback'));
      const ti = $('#fb-title'); if (ti) ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFeedback(); } });
      // Re-evaluate nav visibility whenever auth state changes.
      if (window.CIDApp) { const prev = window.CIDApp.onAuthed; window.CIDApp.onAuthed = function (p, s) { if (typeof prev === 'function') prev(p, s); updateFeedbackNav(); }; }
      if (DB() && DB().onAuth) DB().onAuth(() => updateFeedbackNav());
    }

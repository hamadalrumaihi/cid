/* inbox.js — Sign-off Inbox (Wave 1). Classic script sharing one global lexical
   scope with the other app *.js files (load order in index.html: after
   casefiles.js / command.js / signoff.js, before app.js).

   A per-user, action-oriented view over the existing server-authoritative
   sign-off workflow (signoff.js). It does NOT change any workflow state — it
   only classifies the cases RLS already lets the user see into three buckets:
     • review  — awaiting MY decision (as the assigned reviewer, or my own
                 stop-point call after a Deputy approval)
     • bounced — sent back to me (changes requested / denied)
     • mine    — my submissions still moving through the chain (waiting on others)
   The Command badge counts only items that need MY action (review + bounced).
   Overdue = no movement in >= INBOX_STALE_DAYS (matches the auto-escalate rule). */
"use strict";

    const INBOX_STALE_DAYS = 14;
    let INBOX_CACHE = { review: [], bounced: [], mine: [] };

    function inboxAwaiting(s) { return s === 'awaiting_bureau_lead' || s === 'awaiting_deputy' || s === 'awaiting_director'; }
    function inboxDaysSince(ts) { if (!ts) return 0; const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000); return d < 0 ? 0 : d; }
    function inboxAge(c) { return inboxDaysSince(c.signoff_submitted_at || c.updated_at || c.created_at); }
    function inboxIsOverdue(c) { return inboxAge(c) >= INBOX_STALE_DAYS; }

    function classifyInbox(all, me) {
      const review = [], bounced = [], mine = [];
      (all || []).forEach((c) => {
        const st = c.signoff_status || 'none';
        const iAmReviewer = c.signoff_assignee_id === me && inboxAwaiting(st);
        const iAmOwner = (c.signoff_submitted_by === me || c.lead_detective_id === me);
        if (iAmReviewer) review.push(c);
        else if (st === 'approved_deputy' && iAmOwner) review.push(c);          // my stop-point: complete or escalate
        else if ((st === 'changes_requested' || st === 'denied') && iAmOwner) bounced.push(c);
        else if (iAmOwner && inboxAwaiting(st)) mine.push(c);                   // in-flight, waiting on a reviewer
      });
      // Overdue first, then oldest activity first.
      const sorter = (a, b) => (inboxIsOverdue(b) - inboxIsOverdue(a)) || (inboxAge(b) - inboxAge(a));
      review.sort(sorter); bounced.sort(sorter); mine.sort(sorter);
      return { review, bounced, mine };
    }

    async function fetchInbox() {
      if (!dbReady() || !(DB() && DB().me)) { INBOX_CACHE = { review: [], bounced: [], mine: [] }; return INBOX_CACHE; }
      let all = [];
      try { all = await DB().list('cases', { order: 'signoff_submitted_at', ascending: true }); }
      catch (e) { return INBOX_CACHE; }
      INBOX_CACHE = classifyInbox(all, DB().me.id);
      return INBOX_CACHE;
    }

    function inboxActionCount() { return INBOX_CACHE.review.length + INBOX_CACHE.bounced.length; }

    function updateSignoffBadge() {
      const n = inboxActionCount();
      const show = n > 0 && dbReady() && DB().me;
      ['#signoff-nav-badge', '#signoff-bnav-badge'].forEach((sel) => { const b = $(sel); if (!b) return; b.textContent = String(n); b.classList.toggle('hidden', !show); });
    }
    async function refreshInboxBadge() { await fetchInbox(); updateSignoffBadge(); }

    function inboxCaseCard(c, kind) {
      const st = c.signoff_status || 'none';
      const overdue = inboxIsOverdue(c);
      const age = inboxAge(c);
      const who = kind === 'review'
        ? (st === 'approved_deputy' ? 'Your call — complete or escalate' : 'Awaiting your decision (' + (SIGNOFF.label[c.signoff_stage] || 'review') + ')')
        : kind === 'bounced'
          ? (st === 'denied' ? 'Denied — revise & resubmit' : 'Changes requested — revise & resubmit')
          : 'Awaiting: ' + (escapeHTML(officerName(c.signoff_assignee_id) || '—'));
      const btnLabel = kind === 'review' ? 'Review →' : kind === 'bounced' ? 'Open & fix →' : 'Open →';
      const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-4 ' + (overdue ? 'ring-1 ring-rose-500/30' : '') });
      card.innerHTML = `
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="font-mono text-sm text-blue-300">${escapeHTML(c.case_number || '—')}</p>
              <span class="rounded-md px-2 py-0.5 text-[10px] font-semibold ${signoffTint(st)}">${escapeHTML(signoffLabel(st))}</span>
              ${overdue ? `<span class="rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300" title="No movement in ${age} days">⏳ ${age}d overdue</span>` : ''}
            </div>
            <p class="mt-1 truncate font-semibold text-white">${escapeHTML(c.title || 'Untitled case')}</p>
            <p class="mt-0.5 text-xs text-slate-400">${who} · ${escapeHTML(c.bureau || '')}${age ? ' · ' + age + 'd' : ''}</p>
          </div>
          <button class="inbox-open flex-shrink-0 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110" data-id="${c.id}">${btnLabel}</button>
        </div>`;
      card.querySelector('.inbox-open').onclick = () => openInboxCase(c.id);
      return card;
    }

    function inboxSection(title, list, kind, emptyText) {
      const wrap = el('div', {});
      const overdueN = list.filter(inboxIsOverdue).length;
      wrap.innerHTML = `<div class="mb-2 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">${escapeHTML(title)} <span class="ml-1 text-slate-500">(${list.length})</span></h4>${overdueN ? `<span class="text-[11px] font-semibold text-rose-300">${overdueN} overdue</span>` : ''}</div>`;
      if (!list.length) { const p = el('p', { class: 'text-sm text-slate-500' }); p.textContent = emptyText; wrap.appendChild(p); return wrap; }
      const grid = el('div', { class: 'space-y-3' });
      list.forEach((c) => grid.appendChild(inboxCaseCard(c, kind)));
      wrap.appendChild(grid);
      return wrap;
    }

    async function onEnterInbox() {
      const body = $('#inbox-body'); if (!body) return;
      const notice = $('#inbox-notice');
      if (!dbReady() || !(DB() && DB().me)) {
        if (notice) { notice.classList.remove('hidden'); notice.textContent = 'Sign in as an active member to use the Sign-off inbox.'; }
        body.innerHTML = ''; return;
      }
      if (notice) notice.classList.add('hidden');
      body.innerHTML = '<p class="text-sm text-slate-500">Loading…</p>';
      const { review, bounced, mine } = await fetchInbox();
      updateSignoffBadge();
      body.innerHTML = '';
      if (!review.length && !bounced.length && !mine.length) {
        body.innerHTML = '<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">✅ Your sign-off inbox is clear — nothing awaiting you and no submissions in flight.</div>';
        return;
      }
      body.appendChild(inboxSection('Awaiting your decision', review, 'review', 'Nothing is waiting on your sign-off right now.'));
      body.appendChild(inboxSection('Sent back to you', bounced, 'bounced', 'No cases have been returned to you.'));
      body.appendChild(inboxSection('Your submissions in progress', mine, 'mine', 'You have no cases moving through the chain.'));
    }

    async function openInboxCase(id) {
      navigate('cases');
      await openCaseDetail(id);
      // Land directly on the Sign-Off tab so the action is one click away.
      if (typeof detailTab !== 'undefined' && typeof detailCase !== 'undefined' && detailCase && detailCase.id === id) {
        detailTab = 'signoff'; renderCaseDetailShell(); loadDetailTab();
      }
    }

    function initInbox() {
      const rb = $('#inbox-refresh'); if (rb) rb.onclick = onEnterInbox;
      // Refresh once the user is fully authed (auth.js sets DB().me, then calls
      // onAuthed) — wrapping avoids the race where me isn't set yet on the raw
      // auth event. casefiles.js owns onAuthed; we chain, not replace.
      if (window.CIDApp) { const prev = window.CIDApp.onAuthed; window.CIDApp.onAuthed = function (p, s) { if (typeof prev === 'function') prev(p, s); refreshInboxBadge(); }; }
      if (!dbReady()) return;
      refreshInboxBadge();
      if (DB().onAuth) DB().onAuth((s) => { if (!s) refreshInboxBadge(); });   // clear badge on sign-out
      // Any case change can move things in/out of my buckets — keep the badge live.
      DB().subscribe('cases', () => { refreshInboxBadge(); if ($('#view-inbox') && $('#view-inbox').classList.contains('active')) onEnterInbox(); });
    }

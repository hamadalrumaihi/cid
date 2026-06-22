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
    const INBOX_NUDGE_DAYS = 7;   // pre-overdue: surface aging items before they tip over
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

    // My Desk needs-attention count: sign-off actions + unread mentions + my overdue cases.
    function inboxActionCount() {
      const me = (DB() && DB().me) ? DB().me.id : null;
      const mentions = (typeof NOTIFS !== 'undefined' ? NOTIFS : []).filter((n) => !n.read && n.type === 'chat_mention').length;
      const inSignoff = new Set([...INBOX_CACHE.review, ...INBOX_CACHE.bounced, ...INBOX_CACHE.mine].map((c) => c.id));
      const overdue = me ? (typeof casesCache !== 'undefined' ? casesCache : []).filter((c) => c.lead_detective_id === me && inboxIsOverdue(c) && !inSignoff.has(c.id)).length : 0;
      return INBOX_CACHE.review.length + INBOX_CACHE.bounced.length + mentions + overdue;
    }

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
          : kind === 'overdue'
            ? 'Overdue — no movement in ' + age + ' days'
            : 'Awaiting: ' + (escapeHTML(officerName(c.signoff_assignee_id) || '—'));
      const btnLabel = kind === 'review' ? 'Review →' : kind === 'bounced' ? 'Open & fix →' : 'Open →';
      const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-4 ' + (overdue ? 'ring-1 ring-rose-500/30' : '') });
      card.innerHTML = `
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="font-mono text-sm text-blue-300">${escapeHTML(c.case_number || '—')}</p>
              <span class="rounded-md px-2 py-0.5 text-[10px] font-semibold ${signoffTint(st)}">${escapeHTML(signoffLabel(st))}</span>
              ${overdue ? `<span class="rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300" title="No movement in ${age} days">⏳ ${age}d overdue</span>` : (age >= INBOX_NUDGE_DAYS ? `<span class="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300" title="Approaching the ${INBOX_STALE_DAYS}-day overdue mark — nudge it along">⏳ ${age}d in queue</span>` : '')}
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
      const me = DB().me.id;
      const inSignoff = new Set([...review, ...bounced, ...mine].map((c) => c.id));
      // My overdue cases (I'm the lead), not already surfaced in a sign-off bucket.
      const myOverdue = (typeof casesCache !== 'undefined' ? casesCache : [])
        .filter((c) => c.lead_detective_id === me && inboxIsOverdue(c) && !inSignoff.has(c.id))
        .sort((a, b) => inboxAge(b) - inboxAge(a));
      // Unread @mentions + my unfinalized report drafts.
      const mentions = (typeof NOTIFS !== 'undefined' ? NOTIFS : []).filter((n) => !n.read && n.type === 'chat_mention');
      let myDrafts = [];
      try { myDrafts = await DB().from('reports').select('*').eq('author_id', me).eq('finalized', false).then((r) => r.data || []); } catch (e) {}

      body.innerHTML = '';
      if (!review.length && !bounced.length && !mine.length && !myOverdue.length && !mentions.length && !myDrafts.length) {
        body.innerHTML = '<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">✅ All clear — nothing waiting on you. No sign-off actions, overdue cases, unread mentions, or open drafts.</div>';
        return;
      }
      const chip = (n, label, tint) => n ? `<span class="rounded-full px-2.5 py-1 text-xs font-semibold ${tint}">${n} ${label}</span>` : '';
      const summary = el('div', { class: 'flex flex-wrap gap-2' });
      summary.innerHTML = [
        chip(review.length, 'to review', 'bg-blue-500/15 text-blue-300'),
        chip(bounced.length, 'sent back', 'bg-rose-500/15 text-rose-300'),
        chip(myOverdue.length, 'overdue', 'bg-amber-500/15 text-amber-300'),
        chip(mentions.length, 'mentions', 'bg-violet-500/15 text-violet-300'),
        chip(myDrafts.length, 'draft reports', 'bg-emerald-500/15 text-emerald-300'),
        chip(mine.length, 'in progress', 'bg-white/5 text-slate-300'),
      ].filter(Boolean).join('');
      body.appendChild(summary);
      if (review.length) body.appendChild(inboxSection('Awaiting your decision', review, 'review', ''));
      if (bounced.length) body.appendChild(inboxSection('Sent back to you', bounced, 'bounced', ''));
      if (myOverdue.length) body.appendChild(inboxSection('Your overdue cases', myOverdue, 'overdue', ''));
      if (mentions.length) body.appendChild(deskMentions(mentions));
      if (myDrafts.length) body.appendChild(deskDrafts(myDrafts));
      if (mine.length) body.appendChild(inboxSection('Your submissions in progress', mine, 'mine', ''));
    }

    // My Desk extras: unread @mentions and my unfinalized report drafts as
    // clickable next-actions (open the case on the right tab). Reuses inbox cards
    // for cases; these two are not case-shaped, so they get their own rows.
    async function openDeskCaseTab(caseId, tab) {
      navigate('cases'); await openCaseDetail(caseId);
      if (typeof detailTab !== 'undefined' && typeof detailCase !== 'undefined' && detailCase && detailCase.id === caseId) { detailTab = tab; renderCaseDetailShell(); loadDetailTab(); }
    }
    function deskMentions(list) {
      const wrap = el('div', {});
      wrap.innerHTML = `<div class="mb-2"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Unread mentions <span class="ml-1 text-slate-500">(${list.length})</span></h4></div>`;
      const grid = el('div', { class: 'space-y-2' });
      list.forEach((n) => {
        const p = n.payload || {};
        const card = el('div', { class: 'flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-ink-900/60 p-3' });
        card.innerHTML = `<div class="min-w-0"><p class="truncate text-sm text-slate-200">💬 ${escapeHTML(p.reason || 'You were mentioned')}</p><p class="text-[11px] text-slate-500">${p.case_number ? escapeHTML(p.case_number) + ' · ' : ''}${timeAgo(n.created_at)}</p></div>${p.case_id ? `<button class="desk-mention flex-shrink-0 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110" data-case="${p.case_id}" data-notif="${n.id}">Open →</button>` : ''}`;
        const b = card.querySelector('.desk-mention'); if (b) b.onclick = async () => { try { await DB().update('notifications', b.dataset.notif, { read: true }); } catch (e) {} if (typeof fetchNotifications === 'function') fetchNotifications(); openDeskCaseTab(b.dataset.case, 'chat'); };
        grid.appendChild(card);
      });
      wrap.appendChild(grid); return wrap;
    }
    function deskDrafts(list) {
      const wrap = el('div', {});
      wrap.innerHTML = `<div class="mb-2"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Your draft reports <span class="ml-1 text-slate-500">(${list.length})</span></h4></div>`;
      const grid = el('div', { class: 'space-y-2' });
      list.forEach((r) => {
        const caseNo = (typeof caseNumById === 'function' && caseNumById(r.case_id)) || '';
        const tpl = (typeof tplById === 'function') && tplById(r.template);
        const card = el('div', { class: 'flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-ink-900/60 p-3' });
        card.innerHTML = `<div class="min-w-0"><p class="truncate text-sm text-slate-200">📝 ${escapeHTML((tpl && tpl.name) || 'Report')} <span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">draft</span></p><p class="text-[11px] text-slate-500">${caseNo ? escapeHTML(caseNo) + ' · ' : ''}${timeAgo(r.created_at)}</p></div><button class="desk-draft flex-shrink-0 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110" data-case="${r.case_id}">Open →</button>`;
        card.querySelector('.desk-draft').onclick = () => openDeskCaseTab(r.case_id, 'reports');
        grid.appendChild(card);
      });
      wrap.appendChild(grid); return wrap;
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

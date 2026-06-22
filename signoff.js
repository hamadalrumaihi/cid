/* signoff.js — Case sign-off workflow + LOA (Tom Wood / 934 workflow).
   Classic script sharing one global lexical scope with the other app *.js files
   (load order in index.html). Adds: LOA flags, the Detective → Bureau Lead →
   Deputy Director → Director sign-off chain with LOA auto-routing, sign-off
   notifications, status tracking, the stop-point option, and ownership/sign-off
   separation. Integrates with casefiles.js (Case Detail "Sign-Off" tab). */
"use strict";

    /* ============================================================ SIGN-OFF CHAIN ============================================================ */
    // Chain stages and which roles satisfy each.
    const SIGNOFF = {
      order: ['bureau_lead', 'deputy', 'director'],
      roles: { bureau_lead: ['bureau_lead'], deputy: ['deputy_director'], director: ['director'] },
      label: { bureau_lead: 'Bureau Lead', deputy: 'Deputy Director', director: 'Director' },
      statusOf: { bureau_lead: 'awaiting_bureau_lead', deputy: 'awaiting_deputy', director: 'awaiting_director' },
    };
    const SUBMIT_ROLES = ['detective', 'senior_detective'];
    const REASSIGN_ROLES = ['bureau_lead', 'deputy_director', 'director'];
    const SIGNOFF_LABEL = {
      none: 'Open', awaiting_bureau_lead: 'Awaiting Bureau Lead', awaiting_deputy: 'Awaiting Deputy Director',
      approved_deputy: 'Approved by Deputy', approved_complete: 'Approved & Complete',
      awaiting_director: 'Awaiting Director', ready_doj: 'Ready for DOJ',
      changes_requested: 'Changes Requested', denied: 'Denied',
    };
    const SIGNOFF_TINT = {
      none: 'bg-slate-500/15 text-slate-300', awaiting_bureau_lead: 'bg-amber-500/15 text-amber-300',
      awaiting_deputy: 'bg-amber-500/15 text-amber-300', awaiting_director: 'bg-amber-500/15 text-amber-300',
      approved_deputy: 'bg-blue-500/15 text-blue-300', approved_complete: 'bg-emerald-500/15 text-emerald-300',
      ready_doj: 'bg-emerald-500/15 text-emerald-300', changes_requested: 'bg-orange-500/15 text-orange-300',
      denied: 'bg-rose-500/15 text-rose-300',
    };
    const ROLE_LABEL = { detective: 'Detective', senior_detective: 'Senior Detective', bureau_lead: 'Bureau Lead', deputy_director: 'Deputy Director', director: 'Director' };

    const meProfile = () => (DB() && DB().me) || null;
    const meRole = () => { const m = meProfile(); return m ? m.role : null; };
    const meId = () => { const m = meProfile(); return m ? m.id : null; };
    const signoffLabel = (s) => SIGNOFF_LABEL[s] || (s || 'Open');
    const signoffTint = (s) => SIGNOFF_TINT[s] || SIGNOFF_TINT.none;
    function canReassign() { const m = meProfile(); return !!(m && m.active && REASSIGN_ROLES.includes(m.role)); }

    /* ---- Server-authoritative workflow ----
     * Submission, decisions, and the owner stop-point all run through SECURITY
     * DEFINER RPCs (signoff_submit / signoff_decide / signoff_owner_action). The
     * server does the LOA-aware routing AND writes case_signoff_history, so the
     * client no longer patches cases.signoff_* directly or logs history. Each RPC
     * returns the updated case row, which drives the (client-side) notifications. */

    // Feature 4: rich notification (case #, detective, reason, link via case_id).
    async function notifySignoff(userId, type, c, reason, extra) {
      if (!userId || typeof notify !== 'function') return;
      const detective = officerName(c.lead_detective_id) || officerName(c.signoff_submitted_by) || (meProfile() && meProfile().display_name) || '';
      await notify(userId, type, Object.assign({ case_id: c.id, case_number: c.case_number, detective, reason: reason || '' }, extra || {}));
    }
    function ownerNotifyTarget(c) { return c.signoff_submitted_by || c.lead_detective_id || null; }

    async function refreshCaseDetail(id) {
      try { const rows = await DB().list('cases', { eq: { id } }); if (rows[0] && typeof detailCase !== 'undefined') detailCase = rows[0]; } catch (e) {}
      if (typeof fetchCases === 'function') fetchCases();
      if (typeof detailCase !== 'undefined' && detailCase && detailCase.id === id && typeof renderCaseDetailShell === 'function') { renderCaseDetailShell(); loadDetailTab(); }
    }

    /* ---- Feature 2: submit for review (RPC: signoff_submit) ---- */
    // Soft completeness check before a case goes up the chain — non-blocking, so
    // the detective can still submit, but never anxiously submits half-finished.
    async function caseCompletenessGaps(c) {
      const gaps = [];
      if (!c.summary || !String(c.summary).trim()) gaps.push('No case summary written');
      if (!(Array.isArray(c.charges) ? c.charges : []).length) gaps.push('No charges attached');
      if (!c.lead_detective_id) gaps.push('No lead detective assigned');
      try { const ev = await DB().list('evidence', { eq: { case_id: c.id } }); if (!ev.length) gaps.push('No evidence logged'); } catch (e) {}
      try { const reps = await DB().list('reports', { eq: { case_id: c.id } }); if (!reps.some((r) => r.finalized)) gaps.push('No finalized report'); } catch (e) {}
      return gaps;
    }
    async function submitForSignoff(c) {
      if (!dbReady()) { toast('Sign-in required.', 'warn'); return; }
      const gaps = await caseCompletenessGaps(c);
      if (gaps.length) {
        const ok = await uiConfirm('Before this goes up for sign-off, a quick check found:\n\n• ' + gaps.join('\n• ') + '\n\nYou can still submit — reviewers may send it back if these matter.', { title: 'Completeness check', confirmText: 'Submit anyway', cancelText: 'Go fix it', danger: false });
        if (!ok) return;
      }
      const res = await DB().rpc('signoff_submit', { p_case: c.id });
      if (res.error) { toast('Submit failed: ' + res.error.message, 'danger'); return; }
      const c2 = res.data || c;
      const stage = c2.signoff_stage;
      if (c2.signoff_assignee_id) await notifySignoff(c2.signoff_assignee_id, 'signoff_waiting', c2, 'New case submitted for your sign-off.', { stage });
      toast('Submitted → ' + (SIGNOFF.label[stage] || 'review'), 'success');
      refreshCaseDetail(c.id);
    }

    /* ---- Feature 2/3/6: approve at the current stage (RPC: signoff_decide) ---- */
    async function approveSignoff(c, note) {
      const prevStage = c.signoff_stage;
      const res = await DB().rpc('signoff_decide', { p_case: c.id, p_decision: 'approve', p_note: note || null });
      if (res.error) { toast('Approve failed: ' + res.error.message, 'danger'); return; }
      const c2 = res.data || c;
      const status = c2.signoff_status;
      if (status === 'awaiting_deputy' || status === 'awaiting_director') {
        await notifySignoff(ownerNotifyTarget(c2), 'signoff_approved', c2, SIGNOFF.label[prevStage] + ' approved your case — now with the ' + SIGNOFF.label[c2.signoff_stage] + '.', { stage: prevStage });
        if (c2.signoff_assignee_id) await notifySignoff(c2.signoff_assignee_id, 'signoff_waiting', c2, SIGNOFF.label[prevStage] + ' approved — case now awaiting your sign-off.', { stage: c2.signoff_stage });
        toast('Approved → ' + SIGNOFF.label[c2.signoff_stage], 'success');
      } else if (status === 'approved_deputy') {
        // STOP POINT (Feature 6): Deputy approval can finish here.
        await notifySignoff(ownerNotifyTarget(c2), 'signoff_approved', c2, 'Deputy Director approved your case. You can finish here or escalate to the Director.', { stage: 'deputy' });
        const dirs = (typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active && p.role === 'director');
        for (const d of dirs) await notifySignoff(d.id, 'signoff_heads_up', c2, 'Deputy Director approved this case (no action required unless the detective escalates).', { stage: 'deputy' });
        toast('Approved by Deputy (stop-point reached)', 'success');
      } else if (status === 'ready_doj') {
        await notifySignoff(ownerNotifyTarget(c2), 'signoff_approved', c2, 'Director approved your case — Ready for DOJ.', { stage: 'director' });
        toast('Approved by Director — Ready for DOJ', 'success');
      } else if (status === 'approved_complete') {
        await notifySignoff(ownerNotifyTarget(c2), 'signoff_approved', c2, SIGNOFF.label[prevStage] + ' approved — no higher reviewer available, case complete.', { stage: prevStage });
        toast('Approved (complete)', 'success');
      } else {
        toast('Approved', 'success');
      }
      refreshCaseDetail(c.id);
    }
    async function denySignoff(c, note) {
      const stage = c.signoff_stage;
      const res = await DB().rpc('signoff_decide', { p_case: c.id, p_decision: 'deny', p_note: note || null });
      if (res.error) { toast('Deny failed: ' + res.error.message, 'danger'); return; }
      const c2 = res.data || c;
      await notifySignoff(ownerNotifyTarget(c2), 'signoff_denied', c2, note ? ('Denied by ' + SIGNOFF.label[stage] + ': ' + note) : ('Denied by ' + SIGNOFF.label[stage] + '.'), { stage });
      toast('Case denied', 'warn'); refreshCaseDetail(c.id);
    }
    async function requestChangesSignoff(c, note) {
      const stage = c.signoff_stage;
      const res = await DB().rpc('signoff_decide', { p_case: c.id, p_decision: 'changes', p_note: note || null });
      if (res.error) { toast('Request changes failed: ' + res.error.message, 'danger'); return; }
      const c2 = res.data || c;
      await notifySignoff(ownerNotifyTarget(c2), 'signoff_changes', c2, note ? ('Changes requested by ' + SIGNOFF.label[stage] + ': ' + note) : ('Changes requested by ' + SIGNOFF.label[stage] + '.'), { stage });
      toast('Changes requested', 'info'); refreshCaseDetail(c.id);
    }
    /* ---- Feature 6: owner stop / escalate after Deputy approval (RPC: signoff_owner_action) ---- */
    async function completeAtDeputy(c) {
      const res = await DB().rpc('signoff_owner_action', { p_case: c.id, p_action: 'complete' });
      if (res.error) { toast('Action failed: ' + res.error.message, 'danger'); return; }
      toast('Marked Approved & Complete', 'success'); refreshCaseDetail(c.id);
    }
    async function escalateToDirector(c) {
      const res = await DB().rpc('signoff_owner_action', { p_case: c.id, p_action: 'escalate' });
      if (res.error) { toast('Escalation failed: ' + res.error.message, 'danger'); return; }
      const c2 = res.data || c;
      if (c2.signoff_assignee_id) await notifySignoff(c2.signoff_assignee_id, 'signoff_waiting', c2, 'Detective escalated this case to you after Deputy approval.', { stage: 'director' });
      toast('Escalated to Director', 'success'); refreshCaseDetail(c.id);
    }

    /* ---- Feature 2/5/6: the Case Detail "Sign-Off" tab ---- */
    async function renderSignoffTab(body, c) {
      let history = [];
      try { history = await DB().list('case_signoff_history', { order: 'created_at', ascending: false, eq: { case_id: c.id } }); } catch (e) { toast('Could not load the sign-off history — check your connection.', 'danger'); }
      const status = c.signoff_status || 'none';
      const stage = c.signoff_stage;
      const owner = officerName(c.lead_detective_id);
      const submitter = officerName(c.signoff_submitted_by);
      const assignee = officerName(c.signoff_assignee_id);
      const isOwnerSide = meId() && (meId() === c.lead_detective_id || meId() === c.signoff_submitted_by || SUBMIT_ROLES.includes(meRole()));
      const canSubmit = (status === 'none' || status === 'changes_requested' || status === 'denied') && (meId() === c.lead_detective_id || SUBMIT_ROLES.includes(meRole()) || canReassign());
      const canReview = stage && SIGNOFF.roles[stage] && SIGNOFF.roles[stage].includes(meRole()) && meProfile() && meProfile().active;
      const canDecide = status === 'approved_deputy' && isOwnerSide;

      // Chain progress chips.
      const reached = { bureau_lead: 0, deputy: 1, director: 2 };
      const stageState = (st) => {
        if (status === 'ready_doj') return 'done';
        if (status === 'approved_complete') return st === 'director' ? 'idle' : 'done';
        if (status === 'approved_deputy') return st === 'director' ? 'idle' : 'done';
        if (stage) { const cur = reached[stage]; const idx = reached[st]; return idx < cur ? 'done' : idx === cur ? 'active' : 'idle'; }
        return 'idle';
      };
      const chip = (st) => { const s = stageState(st); const cls = s === 'done' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : s === 'active' ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-white/5 text-slate-400'; return `<span class="rounded-lg border px-3 py-1.5 text-xs font-semibold ${cls}">${s === 'done' ? '✓ ' : ''}${SIGNOFF.label[st]}</span>`; };

      const actHtml = (canReview || canSubmit || canDecide)
        ? `<div class="mt-5 rounded-2xl border border-white/5 bg-ink-900/60 p-5">
             ${canReview ? `
               <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Your decision — ${SIGNOFF.label[stage]}</p>
               <textarea id="so-note" rows="2" class="mb-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Optional note (required for deny / request changes)…"></textarea>
               <div class="flex flex-wrap gap-2">
                 <button id="so-approve" class="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">✓ Approve</button>
                 <button id="so-changes" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:bg-white/10">↻ Request changes</button>
                 <button id="so-deny" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">✕ Deny</button>
               </div>` : ''}
             ${canDecide ? `
               <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Deputy approved — your call</p>
               <div class="flex flex-wrap gap-2">
                 <button id="so-complete" class="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Mark Approved &amp; Complete</button>
                 <button id="so-escalate" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-blue-200 transition hover:bg-white/10">Escalate to Director</button>
               </div>` : ''}
             ${canSubmit ? `
               <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">${status === 'none' ? 'Submit for sign-off' : 'Resubmit for sign-off'}</p>
               <button id="so-submit" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Submit for review →</button>` : ''}
           </div>`
        : (status === 'none' ? '<p class="mt-4 text-sm text-slate-500">This case has not been submitted for sign-off. Only the case owner (Detective/Senior Detective) can submit it.</p>' : '');

      body.innerHTML = `
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div><p class="text-xs uppercase tracking-wider text-slate-400">Sign-off status</p><p class="mt-1"><span class="rounded-md px-2.5 py-1 text-xs font-semibold ${signoffTint(status)}">${escapeHTML(signoffLabel(status))}</span></p></div>
            <div class="text-right text-[11px] text-slate-400">
              <p>Owner: <span class="text-slate-200">${escapeHTML(owner || '— unassigned —')}</span></p>
              ${submitter ? `<p>Submitted by ${escapeHTML(submitter)}${c.signoff_submitted_at ? ' · ' + new Date(c.signoff_submitted_at).toLocaleDateString('en-US') : ''}</p>` : ''}
              ${assignee && stage ? `<p>Awaiting: <span class="text-amber-200">${escapeHTML(assignee)}</span></p>` : ''}
            </div>
          </div>
          <div class="mt-4 flex flex-wrap items-center gap-2">${SIGNOFF.order.map(chip).join('<span class="text-slate-600">→</span>')}</div>
        </div>
        ${actHtml}
        <div class="mt-5">
          <h4 class="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Sign-off history</h4>
          ${history.length ? `<ul class="space-y-3">${history.map((h) => {
            const v = { submitted: 'submitted for review', approved: 'approved', denied: 'denied', changes_requested: 'requested changes', escalated: 'escalated', auto_routed: 'auto-routed', completed: 'marked complete' }[h.action] || h.action;
            const dotc = h.action === 'approved' || h.action === 'completed' ? 'bg-emerald-400' : h.action === 'denied' ? 'bg-rose-400' : h.action === 'changes_requested' ? 'bg-amber-400' : 'bg-blue-400';
            return `<li class="flex gap-3"><span class="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dotc}"></span><div><p class="text-sm text-slate-200"><span class="font-semibold text-white">${escapeHTML(h.actor_name || 'Officer')}</span> ${escapeHTML(v)}${h.stage ? ' <span class="text-slate-400">(' + escapeHTML(SIGNOFF.label[h.stage] || h.stage) + ')</span>' : ''}</p>${h.note ? `<p class="text-xs text-slate-400">“${escapeHTML(h.note)}”</p>` : ''}<p class="text-[11px] text-slate-500">${new Date(h.created_at).toLocaleString('en-US')}</p></div></li>`;
          }).join('')}</ul>` : '<p class="text-sm text-slate-500">No sign-off activity yet.</p>'}
        </div>`;

      const noteVal = () => { const t = body.querySelector('#so-note'); return t ? t.value.trim() : ''; };
      const wire = (id, fn) => { const b = body.querySelector(id); if (b) b.onclick = fn; };
      wire('#so-submit', () => submitForSignoff(c));
      wire('#so-approve', () => approveSignoff(c, noteVal()));
      wire('#so-deny', () => { const n = noteVal(); if (!n) { toast('A note is required to deny.', 'warn'); return; } denySignoff(c, n); });
      wire('#so-changes', () => { const n = noteVal(); if (!n) { toast('Describe the changes needed.', 'warn'); return; } requestChangesSignoff(c, n); });
      wire('#so-complete', () => completeAtDeputy(c));
      wire('#so-escalate', () => escalateToDirector(c));
    }

    /* ============================================================ LOA (Feature 1) ============================================================ */
    // Self-service LOA toggle (does NOT block sign-off; informational + routing).
    async function setMyLoa(on) {
      if (!dbReady() || !meProfile()) { toast('Sign-in required.', 'warn'); return; }
      const patch = { loa: !!on, loa_since: on ? new Date().toISOString() : null };
      const res = await DB().update('profiles', meId(), patch);
      if (res.error) { toast('Could not update LOA: ' + res.error.message, 'danger'); return; }
      DB().me.loa = !!on; DB().me.loa_since = patch.loa_since;
      toast(on ? 'You are now marked On LOA' : 'LOA cleared — back active', on ? 'info' : 'success');
      if (window.CIDApp && typeof window.CIDApp.refreshAuthBar === 'function') window.CIDApp.refreshAuthBar();
      if (typeof fetchProfiles === 'function') fetchProfiles();
    }
    // Admin/command can mark any officer LOA.
    async function setOfficerLoa(id, on) {
      if (!dbReady()) return { error: { message: 'offline' } };
      const res = await DB().update('profiles', id, { loa: !!on, loa_since: on ? new Date().toISOString() : null });
      if (!res.error && typeof fetchProfiles === 'function') fetchProfiles();
      return res;
    }
    window.CIDApp = window.CIDApp || {};
    window.CIDApp.setMyLoa = setMyLoa;

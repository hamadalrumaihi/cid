/* collab.js — Officer info card (#14), in-case chat (#8), cross-case access
   control (#9), and announcements (#15). Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html). */
"use strict";

    /* ============================================================ OFFICER INFO CARD (#14) ============================================================ */
    const DEPT_OF_BUREAU = { LSB: 'LSPD', BCB: 'BCSO', SAB: 'SAHP', JTF: 'JTF (Joint)' };
    function deptLabel(div) { return DEPT_OF_BUREAU[div] || div || '—'; }
    function initials(name) { return (name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?'; }
    function renderOfficerCard() {
      const nameEl = $('#oc-name'); if (!nameEl) return;
      const subEl = $('#oc-sub'), rankEl = $('#oc-rank'), avEl = $('#oc-avatar'), loaEl = $('#oc-loa'), dotEl = $('#oc-dot');
      const me = (DB() && DB().me) || null;
      if (!me) {
        nameEl.textContent = 'Not signed in'; subEl.textContent = '—'; rankEl.textContent = ''; avEl.textContent = '—';
        if (loaEl) loaEl.classList.add('hidden');
        if (dotEl) { dotEl.className = 'sidebar-hide pulse-dot h-2.5 w-2.5 flex-shrink-0 rounded-full bg-slate-500'; dotEl.title = 'Offline'; }
        return;
      }
      nameEl.textContent = me.display_name || 'Officer';
      subEl.textContent = (me.badge_number ? 'Badge ' + me.badge_number + ' · ' : '') + deptLabel(me.division);
      rankEl.textContent = (typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[me.role]) || me.role || '';
      if (me.avatar_url) avEl.innerHTML = `<img src="${esc(me.avatar_url)}" class="h-9 w-9 rounded-full object-cover" alt="" onerror="this.replaceWith(document.createTextNode('${esc(initials(me.display_name))}'))">`;
      else avEl.textContent = initials(me.display_name);
      if (loaEl) loaEl.classList.toggle('hidden', !me.loa);
      if (dotEl) { dotEl.className = 'sidebar-hide pulse-dot h-2.5 w-2.5 flex-shrink-0 rounded-full ' + (me.loa ? 'bg-amber-400' : 'bg-emerald-400'); dotEl.title = me.loa ? 'On LOA' : 'On duty'; }
    }
    function openMyProfile() {
      const me = (DB() && DB().me) || null;
      if (!me) { toast('Sign in to manage your profile.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">My Profile</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="mb-4 flex items-center gap-3">
          <div class="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 text-lg font-bold text-white">${me.avatar_url ? `<img src="${esc(me.avatar_url)}" class="h-14 w-14 rounded-2xl object-cover" alt="">` : esc(initials(me.display_name))}</div>
          <div><p class="text-[11px] uppercase tracking-wider text-blue-300/80">${esc((typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[me.role]) || me.role)}</p><p class="text-sm text-slate-300">${esc(deptLabel(me.division))} · ${esc(me.email || '')}</p></div>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Display name</label><input id="mp-name" value="${esc(me.display_name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Badge number</label><input id="mp-badge" value="${esc(me.badge_number || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <label class="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-3 text-sm text-slate-200"><input id="mp-loa" type="checkbox" ${me.loa ? 'checked' : ''} class="accent-amber-500" /> <span><b>On Leave of Absence (LOA)</b> — informational only. You can still sign in and sign off cases; sign-off auto-routes around you while on LOA.</span></label>
        <button id="mp-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#mp-save').onclick = async () => {
        const name = node.querySelector('#mp-name').value.trim();
        const badge = node.querySelector('#mp-badge').value.trim();
        const loa = node.querySelector('#mp-loa').checked;
        const patch = { display_name: name || me.display_name, badge_number: badge || null, loa: loa, loa_since: loa ? (me.loa_since || new Date().toISOString()) : null };
        const res = await DB().update('profiles', me.id, patch);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        Object.assign(DB().me, patch);
        closeModal(); toast('Profile updated', 'success'); renderOfficerCard();
        if (typeof fetchProfiles === 'function') fetchProfiles();
      };
      openModal(node);
    }

    /* ============================================================ ACCESS CONTROL (#9) ============================================================ */
    const LEAD_ROLES = ['bureau_lead', 'deputy_director', 'director'];
    let MY_GRANTS = new Set();   // case ids the current user has been granted
    async function fetchMyGrants() {
      if (!dbReady() || !(DB() && DB().me)) { MY_GRANTS = new Set(); return; }
      try { const rows = await DB().list('case_access_grants', {}); MY_GRANTS = new Set(rows.filter((g) => g.officer_id === DB().me.id).map((g) => g.case_id)); } catch (e) { MY_GRANTS = new Set(); }
    }
    function canAccessCaseClient(c) {
      const me = (DB() && DB().me) || null; if (!me || !c) return false;
      if (c.lead_detective_id === me.id || c.created_by === me.id) return true;
      if (c.bureau && c.bureau === me.division) return true;
      if (LEAD_ROLES.includes(me.role)) return true;
      return MY_GRANTS.has(c.id);
    }
    function canGrantCaseClient(c) {
      const me = (DB() && DB().me) || null; if (!me || !c) return false;
      return c.lead_detective_id === me.id || LEAD_ROLES.includes(me.role);
    }
    async function requestCaseAccess(c, reason) {
      if (!dbReady()) return;
      const me = DB().me;
      const res = await DB().insert('case_access_requests', { case_id: c.id, requester_name: me.display_name, reason: reason || null });
      if (res.error) { toast('Request failed: ' + res.error.message, 'danger'); return; }
      // notify deciders (owner + leads)
      const deciders = new Set();
      if (c.lead_detective_id) deciders.add(c.lead_detective_id);
      (typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active && LEAD_ROLES.includes(p.role)).forEach((p) => deciders.add(p.id));
      for (const uid of deciders) { if (uid !== me.id && typeof notify === 'function') await notify(uid, 'access_requested', { case_id: c.id, case_number: c.case_number, detective: me.display_name, reason: reason ? ('Access requested: ' + reason) : 'Requested access to this case.' }); }
      toast('Access request sent to the case owner.', 'success');
      if (typeof detailCase !== 'undefined' && detailCase && detailCase.id === c.id) loadDetailTab();
    }
    async function decideAccessRequest(req, c, approve) {
      const me = DB().me;
      if (approve) {
        const g = await DB().insert('case_access_grants', { case_id: req.case_id, officer_id: req.requester_id });
        if (g.error && !/duplicate/i.test(g.error.message)) { toast('Grant failed: ' + g.error.message, 'danger'); return; }
      }
      const up = await DB().update('case_access_requests', req.id, { status: approve ? 'approved' : 'denied', decided_by: me.id, decided_at: new Date().toISOString() });
      if (up.error) { toast('Update failed: ' + up.error.message, 'danger'); return; }
      if (typeof notify === 'function') await notify(req.requester_id, approve ? 'access_granted' : 'access_denied', { case_id: req.case_id, case_number: c ? c.case_number : '', detective: me.display_name, reason: approve ? 'Your access request was approved — you can now open the case channel.' : 'Your access request was denied.' });
      toast(approve ? 'Access granted' : 'Request denied', approve ? 'success' : 'info');
      if (typeof detailCase !== 'undefined' && detailCase && detailCase.id === req.case_id) loadDetailTab();
    }

    /* ============================================================ IN-CASE CHAT (#8) ============================================================ */
    const REC_LINK = { case: { icon: '🗂️', tab: 'cases' }, person: { icon: '🧑‍⚖️', tab: 'persons' }, evidence: { icon: '🧾', tab: 'cases' }, report: { icon: '📝', tab: 'reports' } };
    function renderChatMessage(m) {
      const me = DB() && DB().me;
      const mine = me && m.author_id === me.id;
      const canMod = !!(mine || (DB() && DB().isAdmin && DB().isAdmin()));
      const links = Array.isArray(m.links) ? m.links : [];
      const mentions = Array.isArray(m.mentions) ? m.mentions : [];
      const bodyHtml = esc(m.body).replace(/(@[\w.\-]+(?:\s[\w.\-]+)?)/g, '<span class="text-blue-300">$1</span>');
      const mentionChips = mentions.map((x, i) => `<span class="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@${esc(mentionLabel(x.target || x))}${canMod ? `<button class="cm-rm-mention text-blue-300/60 hover:text-rose-300" data-id="${esc(m.id)}" data-i="${i}" title="Remove mention">✕</button>` : ''}</span>`).join(' ');
      const linkChips = links.map((l, i) => `<span class="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300"><button class="chat-link font-medium hover:underline" data-type="${esc(l.type)}" data-id="${esc(l.id)}">${(REC_LINK[l.type] || {}).icon || '🔗'} ${esc(l.label || l.id)}</button>${canMod ? `<button class="cm-rm-link text-blue-300/60 hover:text-rose-300" data-id="${esc(m.id)}" data-i="${i}" title="Remove link">✕</button>` : ''}</span>`).join(' ');
      return `<div class="group flex gap-3 ${mine ? 'flex-row-reverse text-right' : ''}" data-mid="${esc(m.id)}">
        <div class="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-[10px] font-bold text-white">${esc(initials(m.author_name))}</div>
        <div class="min-w-0 max-w-[80%]">
          <p class="text-[11px] text-slate-500">${esc(m.author_name || 'Officer')} · ${new Date(m.created_at).toLocaleString('en-US')}</p>
          <div class="cm-bubble mt-1 inline-block rounded-2xl ${mine ? 'bg-badge-500/15' : 'bg-ink-800'} px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap break-words">${bodyHtml}</div>
          ${(mentionChips || linkChips) ? `<div class="mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : ''}">${mentionChips}${mentionChips && linkChips ? ' ' : ''}${linkChips}</div>` : ''}
          ${canMod ? `<div class="mt-1 flex gap-3 ${mine ? 'justify-end' : ''} text-[11px] text-slate-500 opacity-0 transition group-hover:opacity-100"><button class="cm-edit hover:text-white" data-id="${esc(m.id)}">Edit</button><button class="cm-del hover:text-rose-300" data-id="${esc(m.id)}">Delete</button></div>` : ''}
        </div>
      </div>`;
    }
    async function renderChatTab(body, c) {
      const access = canAccessCaseClient(c);
      const canGrant = canGrantCaseClient(c);
      // Pending access requests (visible to deciders)
      let requests = [];
      if (canGrant) { try { requests = await DB().list('case_access_requests', { order: 'created_at', ascending: false, eq: { case_id: c.id } }); } catch (e) {} }
      const pending = requests.filter((r) => r.status === 'pending');

      if (!access) {
        let mine = [];
        try { mine = await DB().list('case_access_requests', { eq: { case_id: c.id } }); } catch (e) {}
        const myReq = mine.find((r) => r.requester_id === (DB().me && DB().me.id));
        body.innerHTML = `
          <div class="rounded-2xl border border-white/10 bg-ink-900/60 p-8 text-center">
            <p class="text-3xl">🔒</p>
            <h4 class="mt-2 text-lg font-bold text-white">Restricted case channel</h4>
            <p class="mx-auto mt-1 max-w-md text-sm text-slate-400">This case channel is limited to its owner, the ${esc(deptLabel(c.bureau))} department, and CID command. Request access to join the discussion.</p>
            ${myReq ? `<p class="mt-4 inline-block rounded-lg border px-3 py-2 text-sm ${myReq.status === 'pending' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : myReq.status === 'approved' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}">Your request is ${esc(myReq.status)}.</p>`
              : `<button id="chat-request" class="mt-4 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Request access</button>`}
          </div>`;
        const rb = body.querySelector('#chat-request');
        if (rb) rb.onclick = async () => { const reason = (await uiPrompt('Reason for requesting access (optional):', { title: 'Request case access' })) || ''; requestCaseAccess(c, reason); };
        return;
      }

      let msgs = [];
      try { msgs = await DB().list('case_messages', { order: 'created_at', ascending: true, eq: { case_id: c.id } }); } catch (e) { toast('Could not load the case channel — check your connection.', 'danger'); }
      const officers = (typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active);
      const recentCases = (typeof casesCache !== 'undefined' ? casesCache : []).slice(0, 30);

      body.innerHTML = `
        ${pending.length ? `<div class="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">Pending access requests (${pending.length})</p>
          <div class="space-y-2">${pending.map((r) => `<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2"><div><p class="text-sm text-white">${esc(r.requester_name || 'Officer')}</p>${r.reason ? `<p class="text-[11px] text-slate-400">“${esc(r.reason)}”</p>` : ''}</div><div class="flex gap-2"><button class="ar-approve rounded-md bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25" data-id="${r.id}" data-req="${r.requester_id}">Approve</button><button class="ar-deny rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/10" data-id="${r.id}" data-req="${r.requester_id}">Deny</button></div></div>`).join('')}</div>
        </div>` : ''}
        <div id="chat-scroll" class="max-h-[48vh] space-y-4 overflow-y-auto rounded-2xl border border-white/5 bg-ink-900/40 p-4">${msgs.length ? msgs.map(renderChatMessage).join('') : '<p class="py-8 text-center text-sm text-slate-500">No messages yet. Start the case discussion below.</p>'}</div>
        <div class="mt-3 rounded-2xl border border-white/10 bg-ink-900/60 p-3">
          <div class="mb-2 flex flex-wrap gap-2">
            <select id="chat-mention" class="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500"><option value="">＠ Mention…</option>${officers.map((p) => `<option value="${p.id}|${esc(p.display_name)}">${esc(p.display_name)} · ${esc((ROLE_LABEL && ROLE_LABEL[p.role]) || p.role)}</option>`).join('')}</select>
            <select id="chat-link" class="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500"><option value="">🔗 Link case…</option>${recentCases.map((x) => `<option value="${x.id}|${esc(x.case_number)}">${esc(x.case_number)}</option>`).join('')}</select>
          </div>
          <div id="chat-tokens" class="mb-2 flex flex-wrap gap-1"></div>
          <div class="flex items-end gap-2">
            <textarea id="chat-input" rows="2" class="flex-1 resize-none rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Message the case channel…  (Enter to send, Shift+Enter for newline)"></textarea>
            <button id="chat-send" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Send</button>
          </div>
        </div>`;

      const scroll = body.querySelector('#chat-scroll'); if (scroll) scroll.scrollTop = scroll.scrollHeight;
      body.querySelectorAll('.chat-link').forEach((b) => b.onclick = () => { if (b.dataset.type === 'case') { if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(b.dataset.id); } else if (typeof navigate === 'function') navigate((REC_LINK[b.dataset.type] || {}).tab || 'cases'); });
      // Edit / delete messages + remove mention/link chips (RLS: author or command).
      const reloadChat = () => { if (typeof detailCase !== 'undefined' && detailCase && detailCase.id === c.id) loadDetailTab(); };
      const updateMsg = async (id, patch) => { const res = await DB().update('case_messages', id, patch); if (res && res.error) { toast('Update failed: ' + res.error.message, 'danger'); return false; } return true; };
      body.querySelectorAll('.cm-del').forEach((b) => b.onclick = async () => {
        if (!(await uiConfirm('Delete this message?', { confirmText: 'Delete' }))) return;
        const res = await DB().remove('case_messages', b.dataset.id);
        if (res && res.error) { toast('Delete failed: ' + res.error.message, 'danger'); return; }
        toast('Message deleted', 'warn'); reloadChat();
      });
      body.querySelectorAll('.cm-rm-link').forEach((b) => b.onclick = async () => {
        const m = msgs.find((x) => x.id === b.dataset.id); if (!m) return;
        const links = (Array.isArray(m.links) ? m.links : []).filter((_, i) => i !== +b.dataset.i);
        if (await updateMsg(m.id, { links })) reloadChat();
      });
      body.querySelectorAll('.cm-rm-mention').forEach((b) => b.onclick = async () => {
        const m = msgs.find((x) => x.id === b.dataset.id); if (!m) return;
        const mentions = (Array.isArray(m.mentions) ? m.mentions : []).filter((_, i) => i !== +b.dataset.i);
        if (await updateMsg(m.id, { mentions })) reloadChat();
      });
      body.querySelectorAll('.cm-edit').forEach((b) => b.onclick = () => {
        const m = msgs.find((x) => x.id === b.dataset.id); if (!m) return;
        const wrap = b.closest('[data-mid]'); const bubble = wrap && wrap.querySelector('.cm-bubble'); if (!bubble) return;
        const ta = document.createElement('textarea');
        ta.value = m.body; ta.rows = 2;
        ta.className = 'mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500';
        ta.title = 'Enter to save · Esc to cancel';
        bubble.replaceWith(ta); ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
        ta.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const v = ta.value.trim(); if (!v) { toast('Message can’t be empty — use Delete instead.', 'warn'); return; } if (await updateMsg(m.id, { body: v })) { toast('Message updated', 'success'); reloadChat(); } }
          else if (e.key === 'Escape') { e.preventDefault(); reloadChat(); }
        });
      });
      body.querySelectorAll('.ar-approve').forEach((b) => b.onclick = () => decideAccessRequest({ id: b.dataset.id, requester_id: b.dataset.req, case_id: c.id }, c, true));
      body.querySelectorAll('.ar-deny').forEach((b) => b.onclick = () => decideAccessRequest({ id: b.dataset.id, requester_id: b.dataset.req, case_id: c.id }, c, false));

      // composer state
      const pendingMentions = []; const pendingLinks = [];
      const tokensEl = body.querySelector('#chat-tokens'), input = body.querySelector('#chat-input');
      // Persist a half-typed message per case so it survives refresh / tab switch.
      const chatDraftKey = 'chat:' + c.id;
      { const cd = (typeof Drafts !== 'undefined') && Drafts.load(chatDraftKey); if (cd && cd.data && !input.value) input.value = cd.data; }
      input.addEventListener('input', () => { if (typeof Drafts === 'undefined') return; if (input.value.trim()) Drafts.save(chatDraftKey, input.value); else Drafts.clear(chatDraftKey); });
      const renderTokens = () => { tokensEl.innerHTML = pendingMentions.map((m) => `<span class="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@${esc(m.name)}</span>`).join(' ') + ' ' + pendingLinks.map((l) => `<span class="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-300">🔗 ${esc(l.label)}</span>`).join(' '); };
      body.querySelector('#chat-mention').onchange = (e) => { if (!e.target.value) return; const [id, name] = e.target.value.split('|'); if (!pendingMentions.find((m) => m.id === id)) { pendingMentions.push({ id, name }); input.value = (input.value + ' @' + name + ' ').trimStart(); renderTokens(); } e.target.value = ''; input.focus(); };
      body.querySelector('#chat-link').onchange = (e) => { if (!e.target.value) return; const [id, label] = e.target.value.split('|'); if (!pendingLinks.find((l) => l.id === id)) { pendingLinks.push({ type: 'case', id, label }); renderTokens(); } e.target.value = ''; };

      const send = async () => {
        const text = input.value.trim(); if (!text) return;
        const payload = { case_id: c.id, author_name: DB().me.display_name, body: text, mentions: pendingMentions.map((m) => m.id), links: pendingLinks };
        const res = await DB().insert('case_messages', payload);
        if (res.error) { toast('Send failed: ' + res.error.message, 'danger'); return; }
        for (const m of pendingMentions) { if (m.id !== DB().me.id && typeof notify === 'function') await notify(m.id, 'chat_mention', { case_id: c.id, case_number: c.case_number, detective: DB().me.display_name, reason: DB().me.display_name + ' mentioned you in the ' + c.case_number + ' channel.' }); }
        input.value = ''; pendingMentions.length = 0; pendingLinks.length = 0; renderTokens();
        if (typeof Drafts !== 'undefined') Drafts.clear(chatDraftKey);
        if (typeof detailCase !== 'undefined' && detailCase && detailCase.id === c.id) loadDetailTab();
      };
      body.querySelector('#chat-send').onclick = send;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    }

    /* ============================================================ ANNOUNCEMENTS (#15) ============================================================ */
    let ANNOUNCEMENTS = [];
    function canAnnounceClient() { const me = DB() && DB().me; return !!(me && me.active && LEAD_ROLES.includes(me.role)); }
    function annDismissed() { return new Set((typeof Store !== 'undefined' && Store.get('annDismissed', [])) || []); }
    function dismissAnnouncement(id) { const s = annDismissed(); s.add(id); Store.set('annDismissed', [...s]); renderAnnouncements(); }
    function restoreAnnouncements() { Store.set('annDismissed', []); renderAnnouncements(); }
    function visibleAnnouncements(includeDismissed) {
      const me = DB() && DB().me; const div = me ? me.division : null; const dis = annDismissed();
      return ANNOUNCEMENTS
        .filter((a) => a.audience === 'all' || a.audience === div)
        .filter((a) => includeDismissed || !dis.has(a.id))
        .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (new Date(b.created_at) - new Date(a.created_at)));
    }
    // mention/link rendering helpers
    function mentionLabel(t) { if (t === 'all') return 'All Officers'; if (typeof t === 'string' && t.indexOf('role:') === 0) return 'All ' + ((ROLE_LABEL && ROLE_LABEL[t.slice(5)]) || t.slice(5)) + 's'; return officerName(t) || 'Officer'; }
    function annChips(a) {
      const m = (a.mentions || []).map((x) => `<span class="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@${esc(mentionLabel(x.target || x))}</span>`).join(' ');
      const l = (a.links || []).map((x) => `<span class="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-300">${(REC_LINK[x.type] || {}).icon || '🔗'} ${esc(x.label || x.id)}</span>`).join(' ');
      return (m || l) ? `<div class="mt-2 flex flex-wrap gap-1">${m} ${l}</div>` : '';
    }
    async function fetchAnnouncements() {
      if (!dbReady()) { renderAnnouncements(); return; }
      try { ANNOUNCEMENTS = await DB().list('announcements', { order: 'created_at', ascending: false }); } catch (e) { ANNOUNCEMENTS = []; }
      renderAnnouncements(); updateAnnounceBadge();
    }
    function onEnterAnnounce() { if (dbReady()) fetchAnnouncements(); else renderAnnouncements(); markAnnouncementsSeen(); }
    function markAnnouncementsSeen() { const latest = visibleAnnouncements(true)[0]; if (latest && typeof Store !== 'undefined') Store.set('annSeen', latest.created_at); updateAnnounceBadge(); }
    function updateAnnounceBadge() {
      const badge = $('#ann-nav-badge'); if (!badge) return;
      const seen = (typeof Store !== 'undefined' && Store.get('annSeen', '')) || '';
      const unread = visibleAnnouncements(true).filter((a) => a.created_at > seen).length;
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
    }
    function renderAnnouncements() {
      const wrap = $('#ann-list'); if (!wrap) return;
      const nb = $('#ann-new'); if (nb) nb.classList.toggle('hidden', !canAnnounceClient());
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Sign in to view announcements.</p>'; return; }
      const items = visibleAnnouncements();
      const dismissedCount = visibleAnnouncements(true).length - items.length;
      if (!items.length) { wrap.innerHTML = `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-10 text-center"><p class="text-3xl">📣</p><p class="mt-2 text-sm text-slate-400">${dismissedCount ? 'All announcements dismissed.' : 'No announcements yet.' + (canAnnounceClient() ? ' Use “+ New Announcement” to post the first.' : '')}</p>${dismissedCount ? '<button id="ann-restore" class="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">Show ' + dismissedCount + ' dismissed</button>' : ''}</div>`; const rb = wrap.querySelector('#ann-restore'); if (rb) rb.onclick = restoreAnnouncements; return; }
      const canManage = canAnnounceClient();
      wrap.innerHTML = items.map((a) => `
        <article class="ann-card cursor-pointer rounded-2xl border ${a.pinned ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-white/5 bg-ink-900/60'} p-5 transition hover:border-blue-500/30" data-id="${a.id}">
          <div class="flex items-start justify-between gap-3">
            <div><h4 class="flex items-center gap-2 text-base font-bold text-white">${a.pinned ? '📌 ' : ''}${esc(a.title)}</h4>
            <p class="mt-0.5 text-[11px] text-slate-500">${esc(a.author_name || 'Command')} · ${new Date(a.created_at).toLocaleString('en-US')}${a.audience !== 'all' ? ' · ' + esc(deptLabel(a.audience)) + ' only' : ''}</p></div>
            <div class="flex flex-shrink-0 items-center gap-2">${canManage ? `<button class="ann-edit text-[11px] text-slate-400 hover:text-white" data-id="${a.id}">edit</button>` : ''}<button class="ann-dismiss text-slate-500 hover:text-white" title="Dismiss (hides for you)" data-id="${a.id}">✕</button></div>
          </div>
          <p class="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">${esc(a.body)}</p>
          ${annChips(a)}
        </article>`).join('') + (dismissedCount ? `<div class="text-center"><button id="ann-restore" class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-white/10">Show ${dismissedCount} dismissed</button></div>` : '');
      wrap.querySelectorAll('.ann-edit').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openAnnouncementModal(ANNOUNCEMENTS.find((x) => x.id === b.dataset.id)); });
      wrap.querySelectorAll('.ann-dismiss').forEach((b) => b.onclick = (e) => { e.stopPropagation(); dismissAnnouncement(b.dataset.id); });
      wrap.querySelectorAll('.ann-card').forEach((c) => c.onclick = () => openAnnouncementView(ANNOUNCEMENTS.find((x) => x.id === c.dataset.id)));
      const rb = wrap.querySelector('#ann-restore'); if (rb) rb.onclick = restoreAnnouncements;
      markAnnouncementsSeen();
    }
    function openAnnouncementView(a) {
      if (!a) return;
      const node = el('div', { class: 'p-6' });
      const links = (a.links || []);
      node.innerHTML = `
        <div class="mb-4 flex items-start justify-between gap-3"><div><h3 class="text-xl font-bold text-white">${a.pinned ? '📌 ' : ''}${esc(a.title)}</h3><p class="mt-1 text-[11px] text-slate-500">${esc(a.author_name || 'Command')} · ${new Date(a.created_at).toLocaleString('en-US')}${a.audience !== 'all' ? ' · ' + esc(deptLabel(a.audience)) + ' only' : ''}</p></div><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        ${(a.mentions || []).length ? `<div class="mb-3 flex flex-wrap gap-1">${(a.mentions || []).map((x) => `<span class="rounded bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-300">@${esc(mentionLabel(x.target || x))}</span>`).join(' ')}</div>` : ''}
        <p class="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">${esc(a.body)}</p>
        ${links.length ? `<div class="mt-4 border-t border-white/5 pt-4"><p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Linked records</p><div class="flex flex-wrap gap-2">${links.map((l) => `<button class="av-link rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-white/10" data-type="${esc(l.type)}" data-id="${esc(l.id)}">${(REC_LINK[l.type] || {}).icon || '🔗'} ${esc(l.label || l.id)}</button>`).join('')}</div></div>` : ''}`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelectorAll('.av-link').forEach((b) => b.onclick = () => { closeModal(); const tab = (REC_LINK[b.dataset.type] || {}).tab || 'cases'; if (typeof navigate === 'function') navigate(tab); if (b.dataset.type === 'case' && typeof openCaseDetail === 'function') openCaseDetail(b.dataset.id); });
      openModal(node, { wide: true });
    }
    function announceRecipients(a) {
      const me = DB().me; const all = (typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active && p.id !== me.id);
      const ids = new Set((a.audience === 'all' ? all : all.filter((p) => p.division === a.audience)).map((p) => p.id));
      const mentioned = new Set();
      (a.mentions || []).forEach((m) => { const t = m.target || m;
        if (t === 'all') all.forEach((p) => { ids.add(p.id); mentioned.add(p.id); });
        else if (typeof t === 'string' && t.indexOf('role:') === 0) { const r = t.slice(5); all.filter((p) => p.role === r).forEach((p) => { ids.add(p.id); mentioned.add(p.id); }); }
        else if (t && t !== me.id) { ids.add(t); mentioned.add(t); } });
      return { ids: [...ids], mentioned };
    }
    function openAnnouncementModal(record) {
      if (!canAnnounceClient()) { toast('Only Bureau Lead and above can post announcements.', 'warn'); return; }
      const a = record || {}; const node = el('div', { class: 'p-6' });
      const officers = (typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active);
      const roleOpts = ['detective', 'senior_detective', 'bureau_lead', 'deputy_director', 'director'];
      const recentCases = (typeof casesCache !== 'undefined' ? casesCache : []).slice(0, 30);
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Announcement</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title *</label><input id="an-title" value="${esc(a.title || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Message *</label><textarea id="an-body" rows="5" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${esc(a.body || '')}</textarea></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Audience</label><select id="an-aud" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${[['all', 'All divisions'], ['LSB', 'LSPD'], ['BCB', 'BCSO'], ['SAB', 'SAHP'], ['JTF', 'JTF']].map(([v, l]) => `<option value="${v}" ${v === (a.audience || 'all') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <label class="mt-6 flex items-center gap-2 text-sm text-slate-200"><input id="an-pin" type="checkbox" ${a.pinned ? 'checked' : ''} class="accent-amber-500" /> Pin to top</label>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Mention</label><select id="an-mention" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="">＠ add…</option><option value="all|All Officers">@All Officers</option>${roleOpts.map((r) => `<option value="role:${r}|All ${esc((ROLE_LABEL && ROLE_LABEL[r]) || r)}s">@All ${esc((ROLE_LABEL && ROLE_LABEL[r]) || r)}s</option>`).join('')}${officers.map((p) => `<option value="${p.id}|${esc(p.display_name)}">@${esc(p.display_name)}</option>`).join('')}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Link case</label><select id="an-link" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="">🔗 add…</option>${recentCases.map((x) => `<option value="${x.id}|${esc(x.case_number)}">${esc(x.case_number)}</option>`).join('')}</select></div>
          </div>
          <div id="an-tokens" class="flex flex-wrap gap-1"></div>
        </div>
        <div class="mt-5 flex gap-2"><button id="an-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save' : 'Post'}</button>${record ? '<button id="an-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}</div>`;
      node.querySelector('.close-x').onclick = closeModal;
      const mentions = (a.mentions || []).map((m) => ({ target: m.target || m, label: m.label || mentionLabel(m.target || m) }));
      const links = (a.links || []).map((l) => ({ type: l.type, id: l.id, label: l.label }));
      const tokensEl = node.querySelector('#an-tokens');
      const renderTokens = () => { tokensEl.innerHTML = mentions.map((m) => `<span class="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@${esc(m.label)}</span>`).join(' ') + ' ' + links.map((l) => `<span class="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-300">🔗 ${esc(l.label)}</span>`).join(' '); };
      renderTokens();
      node.querySelector('#an-mention').onchange = (e) => { if (!e.target.value) return; const [target, label] = e.target.value.split('|'); if (!mentions.find((m) => m.target === target)) { mentions.push({ target, label }); renderTokens(); } e.target.value = ''; };
      node.querySelector('#an-link').onchange = (e) => { if (!e.target.value) return; const [id, label] = e.target.value.split('|'); if (!links.find((l) => l.id === id)) { links.push({ type: 'case', id, label }); renderTokens(); } e.target.value = ''; };
      node.querySelector('#an-save').onclick = async () => {
        const title = node.querySelector('#an-title').value.trim();
        const bodyv = node.querySelector('#an-body').value.trim();
        if (!title || !bodyv) { toast('Title and message are required.', 'warn'); return; }
        const payload = { title, body: bodyv, audience: node.querySelector('#an-aud').value, pinned: node.querySelector('#an-pin').checked, author_name: DB().me.display_name, mentions, links };
        const res = record && record.id ? await DB().update('announcements', record.id, payload) : await DB().insert('announcements', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        if (!record && typeof notify === 'function') {   // notify on first post only
          const rec = announceRecipients(payload);
          for (const uid of rec.ids) await notify(uid, 'announcement', { announce_id: (res.data && res.data[0] && res.data[0].id) || null, title: title, reason: (rec.mentioned.has(uid) ? 'You were mentioned: ' : 'New announcement: ') + title });
        }
        closeModal(); toast(record ? 'Announcement updated' : 'Announcement posted', 'success'); fetchAnnouncements();
      };
      const del = node.querySelector('#an-del');
      if (del) del.onclick = async () => { if (!(await uiConfirm('Delete this announcement?', { confirmText: 'Delete' }))) return; const r = await DB().remove('announcements', record.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Deleted', 'warn'); fetchAnnouncements(); };
      openModal(node);
    }

    /* ============================================================ ENCOURAGEMENT WIDGET (#16) ============================================================ */
    const ENCOURAGEMENTS = [
      'You got this, Detective.', 'Build the case step by step.', 'Justice requires patience.',
      'Every detail matters — document it.', 'Follow the evidence, not the noise.',
      'Strong cases are built, not rushed.', 'Chain of custody is everything.',
      'Verify, then trust.', 'The quiet lead often breaks the case.',
      'Protect the integrity of the investigation.', 'Good notes today win the case tomorrow.',
      'Stay sharp. Stay thorough. Stay fair.',
    ];
    let _encDismissed = false;   // session-only: clears on reload (spec #16)
    function rotateEncouragement() {
      const w = $('#encourage-widget'), t = $('#encourage-text'); if (!w || !t) return;
      if (_encDismissed) { w.classList.add('hidden'); return; }
      t.textContent = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
      w.classList.remove('hidden'); w.classList.add('flex');
    }

    // Wire static elements once the DOM is ready (before app.js init runs).
    document.addEventListener('DOMContentLoaded', function () {
      const card = $('#officer-card'); if (card) card.onclick = openMyProfile;
      const annNew = $('#ann-new'); if (annNew) annNew.onclick = () => openAnnouncementModal(null);
      const ed = $('#encourage-dismiss'); if (ed) ed.onclick = () => { _encDismissed = true; const w = $('#encourage-widget'); if (w) { w.classList.add('hidden'); w.classList.remove('flex'); } };
      rotateEncouragement();
      setInterval(rotateEncouragement, 5 * 60 * 1000);
      renderOfficerCard();
    });
    window.CIDApp = window.CIDApp || {};
    window.CIDApp.refreshAuthBar = renderOfficerCard;   // called by signoff.setMyLoa

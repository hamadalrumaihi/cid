/* modus.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 9. M.O. DETECTOR ============================================================
     * Indicators are extracted from a narrative against MO_DICT, then cross-referenced
     * against live mo_profiles (one profile per case, indicators stored as jsonb).
     * A profile can be saved straight from a scan and linked to a case. */
    const SAMPLE_MO = "Two suspects in an unmarked black Burrito breached the rear door via lockpick. One matched the alias 'Tre'. A Class 2 AP Pistol casing was recovered, and thermite residue was found on the safe. They fled before our black CID SUV arrived.";
    let MO_PROFILES = [];
    let lastMoScan = null;
    function scanMO(text) {
      const lc = text.toLowerCase();
      const found = { names:[], entry:[], vehicles:[], weapons:[] };
      Object.keys(MO_DICT).forEach((cat) => MO_DICT[cat].forEach((term) => { if (lc.includes(term) && !found[cat].includes(term)) found[cat].push(term); }));
      return found;
    }
    const moFlatten = (ind) => [].concat(...['names','entry','vehicles','weapons'].map((k) => (ind && ind[k]) || []));
    async function fetchMoProfiles() { if (!dbReady()) { return; } try { MO_PROFILES = await DB().list('mo_profiles', { order: 'created_at', ascending: false }); } catch (e) {} }
    function onEnterModus() { if (dbReady()) fetchMoProfiles(); }
    function renderMO() {
      const text = $('#mo-input').value.trim();
      const tagBox = $('#mo-tags'); const matchBox = $('#mo-matches'); const saveBtn = $('#mo-save');
      if (!text) { toast('Paste an incident narrative first.', 'warn'); return; }
      const found = scanMO(text);
      const all = moFlatten(found);
      lastMoScan = { narrative: text, indicators: found };
      if (saveBtn) saveBtn.classList.toggle('hidden', !(all.length && DB() && DB().canEdit()));
      const catMeta = { names:{l:'Aliases / Names', t:'bg-rose-500/10 text-rose-300 border-rose-500/20'}, entry:{l:'Entry Methods', t:'bg-amber-500/10 text-amber-300 border-amber-500/20'}, vehicles:{l:'Vehicles', t:'bg-blue-500/10 text-blue-300 border-blue-500/20'}, weapons:{l:'Weapons', t:'bg-violet-500/10 text-violet-300 border-violet-500/20'} };
      tagBox.innerHTML = `<p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Extracted Tactical Indicators (${all.length})</p>` +
        (all.length ? Object.keys(catMeta).filter((c)=>found[c].length).map((c)=>`<div class="mb-2"><p class="mb-1 text-[10px] uppercase tracking-wider text-slate-500">${catMeta[c].l}</p><div class="flex flex-wrap gap-2">${found[c].map((t)=>`<span class="rounded-full border px-2.5 py-1 text-[11px] font-medium ${catMeta[c].t}">${esc(t)}</span>`).join('')}</div></div>`).join('')
        : '<p class="text-sm text-slate-500">No known indicators detected.</p>');

      if (!dbReady()) { matchBox.innerHTML = '<p class="text-sm text-slate-500">Sign in to cross-reference against case M.O. profiles.</p>'; return; }
      // Score each stored case profile by shared indicators
      const scored = MO_PROFILES.map((p) => {
        const tags = moFlatten(p.indicators);
        const shared = tags.filter((tag) => all.includes(tag));
        const pct = tags.length ? Math.round((shared.length / tags.length) * 100) : 0;
        const c = casesCache.find((x) => x.id === p.case_id);
        return { caseObj: c, id: (c && c.case_number) || '—', status: c ? (c.status === 'cold' ? 'Cold' : 'Open') : '—', shared, pct };
      }).filter((c) => c.shared.length).sort((a,b) => b.pct - a.pct);

      // #9 + bureau isolation — full detail only on cases you can access. Cases in
      // OTHER bureaus are RLS-hidden, so their matches come from the mo_crossref
      // SECURITY DEFINER RPC (existence + shared tags only) → a locked "request
      // access" card. Same-DB accessible matches render with full detail.
      const accessOk = (co) => typeof canAccessCaseClient !== 'function' || !co || canAccessCaseClient(co);
      const lockedCard = (names, cid, cnum) => `<div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div class="flex items-center gap-2"><span class="text-lg">🔒</span><span class="text-sm font-semibold text-amber-200">Flagged in another bureau’s investigation</span></div>
          <p class="mt-1 text-xs text-slate-300">Indicators (<span class="text-amber-200">${esc(names || 'A suspect')}</span>) match ${cnum ? `case <span class="font-mono text-amber-200">${esc(cnum)}</span>` : 'a case'} you don’t have access to. Details are restricted.</p>
          <button class="mo-request mt-2 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110" data-cid="${esc(cid || '')}" data-cnum="${esc(cnum || '')}">Request access</button>
        </div>`;
      const wireMoButtons = (scope) => {
        scope.querySelectorAll('.mo-open').forEach((b) => b.onclick = () => { if (!b.dataset.cid) return; if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(b.dataset.cid); });
        scope.querySelectorAll('.mo-request').forEach((b) => b.onclick = async () => { const co = casesCache.find((x) => x.id === b.dataset.cid) || { id: b.dataset.cid, case_number: b.dataset.cnum }; if (typeof requestCaseAccess === 'function') { const reason = (await uiPrompt('Reason for requesting access (optional):', { title: 'Request case access' })) || ''; requestCaseAccess(co, reason); } });
      };
      const accCards = scored.map((c) => {
        if (!accessOk(c.caseObj)) return lockedCard(c.shared.join(', '), c.caseObj ? c.caseObj.id : '', c.id);
        const tint = c.pct >= 70 ? 'border-rose-500/40 bg-rose-500/5' : c.pct >= 40 ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-ink-900';
        const bar = c.pct >= 70 ? 'bg-rose-500' : c.pct >= 40 ? 'bg-amber-500' : 'bg-blue-500';
        return `<div class="rounded-xl border ${tint} p-4">
          <div class="flex items-center justify-between"><div><button class="mo-open font-mono text-sm font-semibold text-white hover:text-blue-300" data-cid="${c.caseObj ? c.caseObj.id : ''}">${esc(c.id)}</button> <span class="ml-2 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${c.status==='Cold'?'bg-slate-500/20 text-slate-300':'bg-emerald-500/15 text-emerald-300'}">${esc(c.status)}</span></div><span class="font-mono text-lg font-bold ${c.pct>=70?'text-rose-300':c.pct>=40?'text-amber-300':'text-blue-300'}">${c.pct}%</span></div>
          <p class="mt-1 text-xs text-slate-400">${c.pct}% M.O. match — shared: ${c.shared.map((s)=>esc(s)).join(', ')}</p>
          <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full ${bar}" style="width:${c.pct}%"></div></div>
        </div>`;
      });
      matchBox.innerHTML = (accCards.length ? accCards.join('') : `<p class="text-sm text-slate-500" data-mo-empty>No cross-reference matches found${MO_PROFILES.length ? '' : ' — no case M.O. profiles saved yet'}.</p>`) + '<div id="mo-crossbureau" class="space-y-3"></div>';
      wireMoButtons(matchBox);
      if (scored.length) { const top = scored[0]; toast(accessOk(top.caseObj) ? `${top.pct}% M.O. match found with ${top.id}` : 'Indicators flagged in another active investigation', top.pct >= 70 && accessOk(top.caseObj) ? 'danger' : 'info'); }
      // Cross-bureau (RLS-hidden) matches — existence + shared tags via definer RPC.
      if (all.length && typeof DB === 'function' && DB() && DB().rpc) {
        DB().rpc('mo_crossref', { terms: all }).then((r) => {
          const box = $('#mo-crossbureau'); if (!box) return;
          const rows = ((r && r.data) || []).filter((row) => (row.shared || []).length);
          if (!rows.length) return;
          const empty = matchBox.querySelector('[data-mo-empty]'); if (empty) empty.remove();
          box.innerHTML = rows.map((row) => lockedCard((row.shared || []).join(', '), row.case_id, row.case_number)).join('');
          wireMoButtons(box);
        }).catch(() => {});
      }
    }
    function openMoSaveModal() {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      if (!lastMoScan || !moFlatten(lastMoScan.indicators).length) { toast('Run an analysis with detected indicators first.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      const caseOpts = casesCache.length ? casesCache.map((c) => `<option value="${c.id}">${esc(c.case_number)}</option>`).join('') : '<option value="">— no cases —</option>';
      const tags = moFlatten(lastMoScan.indicators);
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Save M.O. Profile</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-3 text-xs text-slate-400">Link these ${tags.length} indicators to a case so future scans cross-reference against it.</p>
        <div class="mb-3 flex flex-wrap gap-2">${tags.map((t) => `<span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">${esc(t)}</span>`).join('')}</div>
        <label class="mb-1 block text-xs font-semibold text-slate-400">Case *</label>
        <select id="mo-case" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select>
        <button id="mo-go" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save Profile</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#mo-go').onclick = async () => {
        const caseId = node.querySelector('#mo-case').value;
        if (!caseId) { toast('Select a case.', 'warn'); return; }
        const res = await DB().insert('mo_profiles', { case_id: caseId, indicators: lastMoScan.indicators, narrative: lastMoScan.narrative });
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('M.O. profile saved', 'success'); await fetchMoProfiles(); renderMO();
      };
      openModal(node);
    }


/* rico.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 11D. RICO ELEMENT TRACKER ============================================================ */
    function withinTenYears(dateStr) { if (!dateStr) return false; const d = new Date(dateStr); return (Date.now() - d.getTime()) <= 10 * 365.25 * 24 * 3.6e6 && d.getTime() <= Date.now(); }
    const predEvidenced = (p) => !!((p.evidence_id || p.evidence_ref) && withinTenYears(p.act_date));
    async function ensureRicoCase(caseId) {
      const rows = await DB().list('rico_cases', { eq: { case_id: caseId } });
      if (rows.length) return rows[0];
      const res = await DB().insert('rico_cases', { case_id: caseId });
      if (res.error) { toast('RICO init failed: ' + res.error.message, 'danger'); return null; }
      return res.data && res.data[0];
    }
    // Page-level entry point (RICO tab). Delegates to the container-agnostic
    // renderer, which is reused embedded in the per-case detail "RICO" tab.
    async function renderRico() {
      renderRicoInto($('#rico-case') ? $('#rico-case').value : '', $('#rico-body'));
    }
    async function renderRicoInto(caseId, body, rerender) {
      if (!body) return;
      rerender = rerender || (() => renderRicoInto(caseId, body, rerender));
      const wrap = (inner) => { body.innerHTML = `<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">${inner}</div>`; };
      if (!dbReady()) { wrap('<div class="lg:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">Sign in to use the RICO tracker.</div>'); return; }
      if (!caseId) { wrap('<div class="lg:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">No case selected — create a case in Case Files first.</div>'); return; }
      // The enterprise picker needs the gangs cache; warm it if a consumer (e.g. the
      // per-case tab) opened before the Gangs/Persons views populated it.
      if (typeof GANGS === 'undefined' || !GANGS.length) { try { GANGS = await DB().list('gangs', { order: 'name', ascending: true }); } catch (e) {} }
      let rc = null, preds = [];
      try { const rows = await DB().list('rico_cases', { eq: { case_id: caseId } }); rc = rows[0] || null; if (rc) preds = await DB().list('predicate_acts', { order: 'act_date', ascending: true, eq: { rico_case_id: rc.id } }); }
      catch (e) { wrap('<p class="text-sm text-rose-300">Could not load the RICO tracker — check your connection and retry.</p>'); return; }
      const enterpriseGangId = rc ? rc.enterprise_gang_id : '';
      const evidenced = preds.filter(predEvidenced);
      const enterpriseOK = !!enterpriseGangId;
      const patternOK = evidenced.length >= 2;
      const allEvidenced = preds.length > 0 && preds.every(predEvidenced);
      const ready = enterpriseOK && patternOK && allEvidenced;
      const score = (enterpriseOK ? 34 : 0) + Math.min(2, evidenced.length) * 22 + (allEvidenced ? 22 : 0);
      const gang = GANGS.find((g) => g.id === enterpriseGangId);
      const canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      wrap(`
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">① Enterprise</p>
          <p class="mb-3 text-xs text-slate-400">Link the criminal organization (a gang) that constitutes the enterprise.</p>
          <select id="rico-gang" ${canEdit ? '' : 'disabled'} class="w-full rounded-lg border border-white/10 bg-ink-850 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"><option value="">— select enterprise —</option>${GANGS.map((g) => `<option value="${g.id}" ${g.id === enterpriseGangId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
          <div class="mt-3 rounded-lg border ${enterpriseOK ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/10 bg-ink-850'} p-3 text-xs"><span class="${enterpriseOK ? 'text-emerald-300' : 'text-slate-400'}">${enterpriseOK ? `✓ Enterprise: ${esc(gang ? gang.name : '—')}${gang && gang.threat_level ? ` (${cap(gang.threat_level)} threat)` : ''}` : '✗ No enterprise defined'}</span></div>
        </div>
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6 lg:col-span-1">
          <div class="mb-2 flex items-center justify-between"><p class="text-xs font-semibold uppercase tracking-wider text-blue-300/70">② Pattern of Racketeering</p>${canEdit ? '<button id="rico-add" class="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Predicate</button>' : ''}</div>
          <p class="mb-3 text-xs text-slate-400">Requires ≥2 predicate acts within 10 years, each evidenced.</p>
          <div class="space-y-2">${preds.length ? preds.map((p) => { const ok = predEvidenced(p); const evTxt = p.evidence_id ? 'linked case evidence' : (p.evidence_ref || ''); return `<div class="rounded-lg border ${ok ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'} p-3"><div class="flex items-center justify-between"><span class="text-sm font-semibold text-white">${esc(p.predicate_type)}</span>${canDel ? `<button class="pr-del text-rose-300 hover:text-rose-200" data-id="${p.id}">✕</button>` : ''}</div><p class="text-[11px] text-slate-400">${esc(p.act_date || 'no date')} · ${evTxt ? ('evidence: ' + esc(evTxt)) : '⚠ no evidence linked'}${!withinTenYears(p.act_date) && p.act_date ? ' · ⚠ outside 10yr' : ''}</p>${p.note ? `<p class="mt-1 text-[11px] text-slate-500">${esc(p.note)}</p>` : ''}</div>`; }).join('') : ('<p class="text-xs text-slate-500">No predicate acts logged.' + (canEdit ? ' Use “+ Predicate” above to add one.' : '') + '</p>')}</div>
        </div>
        <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">③ Readiness Meter</p>
          <div class="mb-2 flex items-end justify-between"><span class="font-mono text-3xl font-bold ${ready ? 'text-emerald-300' : score >= 50 ? 'text-amber-300' : 'text-rose-300'}">${score}%</span><span class="rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${ready ? 'bg-emerald-500/15 text-emerald-300' : score >= 50 ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'}">${ready ? 'RICO-ready' : score >= 50 ? 'In progress' : 'Insufficient'}</span></div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full ${ready ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500'}" style="width:${score}%"></div></div>
          <ul class="mt-4 space-y-2 text-xs">
            <li class="${enterpriseOK ? 'text-emerald-300' : 'text-slate-400'}">${enterpriseOK ? '✓' : '○'} Enterprise defined</li>
            <li class="${patternOK ? 'text-emerald-300' : 'text-slate-400'}">${patternOK ? '✓' : '○'} ≥2 dated predicate acts within 10 years (${evidenced.length})</li>
            <li class="${allEvidenced ? 'text-emerald-300' : 'text-slate-400'}">${allEvidenced ? '✓' : '○'} Every predicate evidenced &amp; in-window</li>
          </ul>
          <p class="mt-4 text-[11px] text-slate-500">Tracking aid only — charging sufficiency is a prosecutor's determination.</p>
        </div>`);
      const gs = body.querySelector('#rico-gang');
      if (gs && canEdit) gs.onchange = async (e) => { const r = await ensureRicoCase(caseId); if (!r) return; await DB().update('rico_cases', r.id, { enterprise_gang_id: e.target.value || null }); rerender(); };
      const ab = body.querySelector('#rico-add'); if (ab) ab.onclick = async () => { const r = await ensureRicoCase(caseId); if (r) openPredicateModal(r.id, caseId, rerender); };
      body.querySelectorAll('.pr-del').forEach((b) => b.onclick = async () => { await DB().remove('predicate_acts', b.dataset.id); rerender(); });
    }
    async function openPredicateModal(ricoCaseId, caseId, rerender) {
      let evidence = [];
      try { evidence = await DB().list('evidence', { eq: { case_id: caseId } }); } catch (e) {}
      const node = el('div', { class: 'p-6' });
      const evOpts = ['<option value="">— none / use text below —</option>'].concat(evidence.map((ev) => `<option value="${ev.id}">${esc((ev.item_code ? ev.item_code + ' · ' : '') + (ev.description || ev.type || 'evidence'))}</option>`)).join('');
      // Predicate type → the FULL San Andreas Penal Code catalog, grouped by Title,
      // with RICO-eligible charges surfaced in a group on top. Falls back to the
      // legacy shortlist only if the penal catalog isn't loaded.
      const PENAL_TITLE_NAMES = { '1': 'Title 1 · Against the Person', '2': 'Title 2 · Property', '3': 'Title 3 · Public Safety & Order', '4': 'Title 4 · Against Justice', '5': 'Title 5 · Firearms & Weapons', '6': 'Title 6 · Public Health', '7': 'Title 7 · Wildlife', '8': 'Title 8 · Commercial Vehicles', '9': 'Title 9 · Traffic', '10': 'Title 10 · RICO' };
      const penalCat = (typeof PENAL_CODE !== 'undefined' ? PENAL_CODE : []);
      let prTypeOpts;
      if (penalCat.length) {
        const optEl = (c) => `<option value="${esc(c.code + ' ' + c.title)}">${esc(c.code)} · ${esc(c.title)}${c.rico ? ' · ★RICO' : ''}</option>`;
        const groups = {}; penalCat.forEach((c) => { const t = (c.code.match(/\((\d+)\)/) || [])[1] || '?'; (groups[t] = groups[t] || []).push(c); });
        const ricoOnes = penalCat.filter((c) => c.rico);
        prTypeOpts = (ricoOnes.length ? `<optgroup label="★ RICO-eligible predicates">${ricoOnes.map(optEl).join('')}</optgroup>` : '')
          + Object.keys(groups).sort((a, b) => (+a) - (+b)).map((t) => `<optgroup label="${esc(PENAL_TITLE_NAMES[t] || ('Title ' + t))}">${groups[t].map(optEl).join('')}</optgroup>`).join('');
      } else {
        prTypeOpts = RICO_PREDICATES.map((p) => `<option>${esc(p)}</option>`).join('');
      }
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Add Predicate Act</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Predicate Type *</label><select id="pr-type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${prTypeOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Date of Act *</label><input id="pr-date" type="date" value="${todayISO()}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Link Case Evidence</label><select id="pr-evid" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${evOpts}</select><p class="mt-1 text-[10px] text-slate-500">${evidence.length ? evidence.length + ' evidence item(s) on this case.' : 'No evidence on this case yet — add some in the Case Detail.'}</p></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Evidence Reference (if not linking above)</label><input id="pr-ev" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Surveillance Log #2" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Note</label><textarea id="pr-note" rows="2" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"></textarea></div>
        </div>
        <button id="pr-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add Predicate</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#pr-save').onclick = async () => {
        const payload = { rico_case_id: ricoCaseId, predicate_type: node.querySelector('#pr-type').value, act_date: node.querySelector('#pr-date').value || null, evidence_id: node.querySelector('#pr-evid').value || null, evidence_ref: node.querySelector('#pr-ev').value.trim() || null, note: node.querySelector('#pr-note').value.trim() || null };
        const res = await DB().insert('predicate_acts', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Predicate act added', 'success'); (rerender || renderRico)();
      };
      openModal(node);
    }
    async function exportRicoDocx() {
      const caseId = $('#rico-case').value; const caseNo = caseNumById(caseId) || caseId;
      let rc = null, preds = [];
      try { const rows = await DB().list('rico_cases', { eq: { case_id: caseId } }); rc = rows[0] || null; if (rc) preds = await DB().list('predicate_acts', { order: 'act_date', ascending: true, eq: { rico_case_id: rc.id } }); } catch (e) {}
      const gang = rc ? GANGS.find((g) => g.id === rc.enterprise_gang_id) : null;
      const paras = [{ text: 'Criminal Investigation Division — State of San Andreas', style: 'subtitle' }, { text: 'RICO Predicate Summary', style: 'title' }, { text: `${caseNo}  ·  Prepared ${new Date().toLocaleDateString('en-US')}`, style: 'subtitle' }, { text: '', style: 'normal' },
        { text: 'Enterprise', style: 'heading' }, { text: gang ? `${gang.name}${gang.threat_level ? ' — threat ' + gang.threat_level : ''}` : 'Not defined', style: 'normal' },
        { text: 'Pattern of Racketeering — Predicate Acts', style: 'heading' }];
      if (!preds.length) paras.push({ text: 'No predicate acts logged.', style: 'normal' });
      preds.forEach((p, i) => paras.push({ text: `${i + 1}. ${p.predicate_type} — ${p.act_date || 'no date'} — evidence: ${p.evidence_id ? 'linked case evidence' : (p.evidence_ref || 'none')}${p.note ? (' — ' + p.note) : ''}`, style: 'normal' }));
      paras.push({ text: '', style: 'normal' });
      paras.push({ text: 'Disclaimer: organizational tracking aid only; predicate sufficiency is a prosecutor’s determination.', style: 'subtitle' });
      downloadDocx('RICO Predicate Summary', paras, `${String(caseNo).replace(/[^a-z0-9]/gi, '-')}-rico-summary.docx`);
      toast('RICO Predicate Summary exported as .docx', 'success');
    }


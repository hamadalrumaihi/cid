/* reports.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 11C. REPORTS (template-driven + chains) ============================================================ */
    // Report authoring lives inside each case's Reports tab (renderCaseReports);
    // there is no standalone Reports view. fillCaseSelect/refreshCaseSelects remain
    // for the RICO Builder's case picker.
    // Populate a <select> with live cases (value = uuid, label = case_number), preserving selection.
    function fillCaseSelect(sel) {
      if (!sel) return; const prev = sel.value;
      sel.innerHTML = casesCache.length ? casesCache.map((c) => `<option value="${c.id}">${esc(c.case_number)}</option>`).join('') : '<option value="">— no cases —</option>';
      if (prev && casesCache.some((c) => c.id === prev)) sel.value = prev;
    }
    function refreshCaseSelects() {
      if ($('#rico-case')) { fillCaseSelect($('#rico-case')); if ($('#view-rico').classList.contains('active')) renderRico(); }
    }
    function reportKindBadge(r) {
      const map = { initial: 'bg-blue-500/15 text-blue-300', supplemental: 'bg-violet-500/15 text-violet-300', followup: 'bg-amber-500/15 text-amber-300' };
      const label = r.kind === 'initial' ? 'Initial' : r.kind === 'supplemental' ? `Supplemental #${r.seq}` : `Follow-up #${r.seq}`;
      return `<span class="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${map[r.kind] || ''}">${label}</span>`;
    }
    // Render the report-chain cards for one case into `wrap`. Shared by the
    // in-case Reports tab (renderCaseReports).
    function renderChainInto(wrap, list, caseId, canEdit) {
      if (!wrap) return;
      if (!list.length) { wrap.innerHTML = '<p class="text-sm text-slate-500">No reports for this case yet.' + (canEdit ? ' Pick a template above to author the initial report.' : '') + '</p>'; return; }
      wrap.innerHTML = '';
      list.forEach((r) => {
        const tpl = tplById(r.template);
        const card = el('div', { class: 'rounded-xl border border-white/10 bg-ink-900 p-4' });
        card.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">${reportKindBadge(r)}<span class="text-sm font-semibold text-white">${esc(tpl ? tpl.name : 'Report')}</span>${r.finalized ? '<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">🔒 finalized</span>' : '<span class="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-300">draft</span>'}</div>
            <span class="text-[11px] text-slate-500">${new Date(r.created_at).toLocaleDateString('en-US')}</span>
          </div>
          ${r.parent_id ? `<p class="mt-1 text-[11px] text-slate-500">↳ linked to prior report</p>` : ''}
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="r-view rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10">View</button>
            <button class="r-docx rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10">.docx</button>
            <button class="r-pdf rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-white/10">.pdf</button>
            ${canEdit ? '<button class="r-supp rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-violet-300 transition hover:bg-white/10">+ Supplemental</button><button class="r-follow rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-amber-300 transition hover:bg-white/10">+ Follow-up</button>' : ''}
          </div>`;
        card.querySelector('.r-view').onclick = () => viewReport(r);
        card.querySelector('.r-docx').onclick = () => exportReportDocx(r);
        card.querySelector('.r-pdf').onclick = () => exportReportPdf(r);
        const rs = card.querySelector('.r-supp'); if (rs) rs.onclick = () => openReportModal(r.template, caseId, r.id, 'supplemental');
        const rf = card.querySelector('.r-follow'); if (rf) rf.onclick = () => openReportModal(r.template, caseId, r.id, 'followup');
        wrap.appendChild(card);
      });
    }
    // In-case Reports tab: official-template launcher + this case's report chain.
    async function renderCaseReports(body, caseId) {
      if (!body) return;
      const canEdit = DB() && DB().canEdit();
      if (!dbReady()) { body.innerHTML = '<p class="text-sm text-slate-500">Sign in to view case reports.</p>'; return; }
      let list = [];
      try { list = await DB().list('reports', { order: 'created_at', ascending: true, eq: { case_id: caseId } }); }
      catch (e) { body.innerHTML = '<p class="text-sm text-rose-300">Load error: ' + escapeHTML(e.message || e) + '</p>'; return; }
      const tplBtns = REPORT_TEMPLATES.map((t) => `<button class="rpt-tpl flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10 hover:text-white" data-tpl="${t.id}"><span class="text-lg">${t.icon}</span><span>${esc(t.name)}${t.default ? ' · default' : ''}</span></button>`).join('');
      body.innerHTML = `
        ${canEdit ? `<div class="mb-4 rounded-2xl border border-white/5 bg-ink-900/60 p-4"><p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">New report — official templates</p><div class="flex flex-wrap gap-2">${tplBtns}</div></div>` : ''}
        <div class="mb-2 flex items-center justify-between"><h4 class="text-xs font-semibold uppercase tracking-wider text-slate-400">Report chain</h4><span class="text-[11px] text-slate-500">${list.length} report${list.length === 1 ? '' : 's'}</span></div>
        <div id="case-report-chain" class="space-y-3"></div>`;
      body.querySelectorAll('.rpt-tpl').forEach((b) => { b.onclick = () => openReportModal(b.dataset.tpl, caseId, null, 'initial'); });
      renderChainInto(body.querySelector('#case-report-chain'), list, caseId, canEdit);
    }
    // After saving/finalizing a report, refresh the in-case Reports tab if open.
    function reloadCaseReports() {
      if (typeof detailCase !== 'undefined' && detailCase && typeof detailTab !== 'undefined' && detailTab === 'reports' && typeof loadDetailTab === 'function') loadDetailTab();
    }
    // QoL: reusable boilerplate snippets a detective can drop into report prose.
    const REPORT_SNIPPETS = [
      { label: 'Miranda', text: 'The subject was advised of their Miranda rights per Article 31 and indicated understanding prior to questioning. ' },
      { label: 'Chain of custody', text: 'All recovered items were photographed, sealed, and entered into the chain of custody at the time of recovery. ' },
      { label: 'Positive ID', text: 'A positive identification was made via comparison of the subject against their DOC booking photograph. ' },
      { label: 'Vehicle stop', text: 'A traffic stop was initiated; the operator was identified via the vehicle registration return. ' },
      { label: 'Use of force', text: 'No use of force was applied during this contact. ' },
    ];
    // QoL: pre-fill the report header from the case + the signed-in detective's
    // profile so they're not re-typing case number / name / rank / date each time.
    function reportSeed(templateId, caseId, kind) {
      if (templateId !== 'cid_investigative_report') return {};
      const c = (typeof casesCache !== 'undefined') ? casesCache.find((x) => x.id === caseId) : null;
      const me = DB() && DB().me;
      const seed = { report_type: kind === 'supplemental' ? 'Supplemental' : kind === 'followup' ? 'Follow-up' : 'Initial', filed_at: todayISO() };
      if (c) seed.case_number = c.case_number;
      if (me) {
        seed.det_name = me.display_name || '';
        seed.det_rank = (typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[me.role]) || me.role || '';
        seed.det_callsign = me.badge_number || '';
      }
      return seed;
    }
    async function openReportModal(templateId, caseId, parentId, kind) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const tpl = tplById(templateId); if (!tpl || !tpl.schema) return;
      let seq = 0;
      if (kind !== 'initial') { try { const ex = await DB().list('reports', { eq: { case_id: caseId, kind: kind } }); seq = ex.length + 1; } catch (e) { seq = 1; } }
      const heading = kind === 'initial' ? tpl.name : kind === 'supplemental' ? `Supplemental #${seq}` : `Follow-up #${seq}`;
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">${esc(tpl.name)}</p><h3 class="text-xl font-bold text-white">${esc(heading)}</h3></div><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        ${parentId ? `<p class="mb-4 rounded-lg border border-white/10 bg-ink-900 p-2.5 text-xs text-slate-400">↳ Linked as ${kind} to a prior report on <span class="font-mono text-blue-300">${esc(caseNumById(caseId) || caseId)}</span>.</p>` : ''}
        <div class="mb-3 flex flex-wrap items-center gap-1.5"><span class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Insert snippet:</span>${REPORT_SNIPPETS.map((s, i) => `<button type="button" class="rpt-snippet rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 transition hover:bg-white/10" data-i="${i}">${esc(s.label)}</button>`).join('')}</div>
        <div class="max-h-[60vh] overflow-y-auto pr-1" id="r-form">${renderFormBody(tpl.schema, reportSeed(templateId, caseId, kind), true)}</div>
        <button id="r-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save Report to Case</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      wireFormBody(node.querySelector('#r-form'), tpl.schema);
      // Snippet insertion targets the last-focused textarea (defaults to Narrative).
      let lastTextarea = node.querySelector('#r-form textarea[data-fkey="narrative"]') || node.querySelector('#r-form textarea');
      node.querySelectorAll('#r-form textarea').forEach((ta) => ta.addEventListener('focus', () => { lastTextarea = ta; }));
      node.querySelectorAll('.rpt-snippet').forEach((b) => b.onclick = () => {
        const s = REPORT_SNIPPETS[+b.dataset.i]; const ta = lastTextarea; if (!s || !ta) { toast('Tap a text box first, then insert.', 'info'); return; }
        const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length, end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
        ta.value = ta.value.slice(0, start) + s.text + ta.value.slice(end);
        const pos = start + s.text.length; ta.focus(); try { ta.setSelectionRange(pos, pos); } catch (e) {}
      });
      node.querySelector('#r-save').onclick = async () => {
        const fields = readForm(node, tpl.schema);
        const payload = { case_id: caseId, template: templateId, kind: kind, seq: seq, parent_id: parentId || null, fields: fields };
        if (DB().me) payload.author_id = DB().me.id;
        const res = await DB().insert('reports', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(`${heading} saved`, 'success'); reloadCaseReports();
      };
      openModal(node, { wide: true });
    }
    function reportTitle(r) { const tpl = tplById(r.template); return `${tpl ? tpl.name : 'Report'}${r.kind !== 'initial' ? ' — ' + (r.kind === 'supplemental' ? 'Supplemental #' + r.seq : 'Follow-up #' + r.seq) : ''}`; }
    function viewReport(r) {
      const tpl = tplById(r.template); const caseNo = caseNumById(r.case_id) || r.case_id;
      const sig = r.signature || null; const canFinalize = DB() && DB().canEdit() && !r.finalized;
      const node = el('div', { class: 'p-6 print-area' });
      node.innerHTML = `
        <div class="mb-4 flex items-start justify-between no-print"><h3 class="text-lg font-bold text-white">Report Preview</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="rounded-xl border border-white/10 bg-ink-900 p-5">
          <p class="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-300/70">Criminal Investigation Division — State of San Andreas</p>
          <h2 class="mt-1 text-center text-xl font-bold text-white">${esc(reportTitle(r))}</h2>
          <p class="mt-1 text-center text-xs text-slate-400">${esc(caseNo)} · ${new Date(r.created_at).toLocaleString('en-US')}${r.finalized ? ' · 🔒 FINALIZED' : ' · DRAFT'}</p>
          <div class="mt-5 space-y-3">${renderFormBody(tpl.schema, r.fields || {}, false)}</div>
          ${sig ? `<div class="mt-6 border-t border-white/10 pt-4 text-xs text-slate-300"><p class="font-semibold uppercase tracking-wider text-emerald-300/80">Electronically signed</p><p class="mt-1 font-[cursive] text-base text-blue-200">${esc(sig.officer)}</p><p class="text-[11px] text-slate-500">Badge ${esc(sig.badge || '—')} · ${sig.signed_at ? new Date(sig.signed_at).toLocaleString('en-US') : ''}</p></div>` : ''}
        </div>
        <div class="mt-5 flex flex-wrap gap-3 no-print">
          <button onclick="window.print()" class="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">🖨️ Print</button>
          <button id="v-docx" class="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Export .docx</button>
          <button id="v-pdf" class="rounded-lg border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Export .pdf</button>
          ${canFinalize ? '<button id="v-final" class="rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">🔏 Finalize &amp; Sign</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#v-docx').onclick = () => exportReportDocx(r);
      node.querySelector('#v-pdf').onclick = () => exportReportPdf(r);
      const vf = node.querySelector('#v-final'); if (vf) vf.onclick = () => openFinalizeModal(r);
      openModal(node, { wide: true });
    }
    function openFinalizeModal(r) {
      const node = el('div', { class: 'p-6' });
      const me = DB().me || {};
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Finalize &amp; e-Sign</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">Finalizing locks the report against further edits and attaches your electronic signature. The signer is recorded server-side from your CID account — it cannot be changed here.</p>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Officer (from your CID profile)</label><input id="fin-officer" value="${esc(me.display_name || '')}" readonly class="w-full cursor-not-allowed rounded-lg border border-white/10 bg-ink-800 px-3 py-2 font-[cursive] text-base text-blue-200 outline-none" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Badge Number</label><input id="fin-badge" value="${esc(me.badge_number || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <button id="fin-go" class="mt-5 w-full rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Sign &amp; Lock Report</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#fin-go').onclick = async () => {
        const badge = node.querySelector('#fin-badge').value.trim();
        const res = await DB().rpc('report_finalize', { p_report: r.id, p_badge: badge || null });
        if (res.error) { toast('Finalize failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Report finalized & signed', 'success'); reloadCaseReports();
      };
      openModal(node);
    }
    function reportParas(r) {
      const tpl = tplById(r.template); const caseNo = caseNumById(r.case_id) || r.case_id;
      const paras = [{ text: 'Criminal Investigation Division — State of San Andreas', style: 'subtitle' }, { text: reportTitle(r), style: 'title' }, { text: `${caseNo}  ·  ${new Date(r.created_at).toLocaleString('en-US')}${r.finalized ? '  ·  FINALIZED' : ''}`, style: 'subtitle' }, { text: '', style: 'normal' }];
      // Schema-backed templates render through the shared form serializer.
      formToText(tpl.schema, r.fields || {}).split('\n').forEach((ln) => {
        const tr = ln.trim();
        const heading = tr.length > 0 && tr.length <= 52 && tr === tr.toUpperCase() && /[A-Z]/.test(tr);
        paras.push({ text: ln, style: heading ? 'heading' : 'normal' });
      });
      if (r.signature) { paras.push({ text: '', style: 'normal' }); paras.push({ text: 'Electronically signed', style: 'heading' }); paras.push({ text: `${r.signature.officer} — Badge ${r.signature.badge || '—'} — ${r.signature.signed_at ? new Date(r.signature.signed_at).toLocaleString('en-US') : ''}`, style: 'normal' }); }
      return paras;
    }
    function exportReportDocx(r) {
      downloadDocx(reportTitle(r), reportParas(r), `${(caseNumById(r.case_id) || 'case').replace(/[^a-z0-9]/gi, '-')}-${r.kind}-${r.seq || 0}.docx`);
      toast('Report exported as .docx', 'success');
    }
    function exportReportPdf(r) {
      const J = window.jspdf && window.jspdf.jsPDF;
      if (!J) { toast('PDF library unavailable (offline). Use .docx or Print.', 'warn'); return; }
      const doc = new J({ unit: 'pt', format: 'letter' }); const W = 612, M = 56; let y = M;
      const line = (txt, opts) => {
        opts = opts || {}; doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(opts.size || 11);
        const wrapped = doc.splitTextToSize(String(txt), W - M * 2);
        wrapped.forEach((ln) => { if (y > 740) { doc.addPage(); y = M; } doc.text(ln, opts.center ? W / 2 : M, y, opts.center ? { align: 'center' } : undefined); y += (opts.size || 11) + 5; });
      };
      line('CRIMINAL INVESTIGATION DIVISION — STATE OF SAN ANDREAS', { center: true, size: 9 });
      line(reportTitle(r), { center: true, bold: true, size: 16 }); y += 4;
      line(`${caseNumById(r.case_id) || r.case_id} · ${new Date(r.created_at).toLocaleString('en-US')}${r.finalized ? ' · FINALIZED' : ' · DRAFT'}`, { center: true, size: 9 }); y += 10;
      const tpl = tplById(r.template);
      formToText(tpl.schema, r.fields || {}).split('\n').forEach((ln) => {
        const tr = ln.trim(); if (!tr) { y += 3; return; }
        const heading = tr.length <= 52 && tr === tr.toUpperCase() && /[A-Z]/.test(tr);
        line(ln, heading ? { bold: true, size: 10 } : { size: 11 });
      });
      if (r.signature) { y += 10; line('ELECTRONICALLY SIGNED', { bold: true, size: 10 }); line(`${r.signature.officer} — Badge ${r.signature.badge || '—'} — ${r.signature.signed_at ? new Date(r.signature.signed_at).toLocaleString('en-US') : ''}`, { size: 10 }); }
      doc.save(`${(caseNumById(r.case_id) || 'case').replace(/[^a-z0-9]/gi, '-')}-${r.kind}-${r.seq || 0}.pdf`);
      toast('Report exported as .pdf', 'success');
    }


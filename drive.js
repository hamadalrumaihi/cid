/* drive.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 10. DOCUMENTS LIBRARY ============================================================
       The Drive tab was retired; this module keeps the shared documents cache,
       the live paperwork viewers (doc/sheet/form + history), and the SOP /
       roster / gang-intel surfaces that render from it. */
    const fileIcon = (t) => ({ doc:'📄', sheet:'📊', pdf:'📕', zip:'🗜️', matrix:'🛡️', form:'📝' }[t] || '📄');
    const safeName = (n) => n.replace(/\.[a-z]+$/i,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase();
    // Display type drives the icon / sub-label: a name/flag matching a fillable form
    // schema → 'form'; a sheet flagged content.view='matrix' is the live CI matrix.
    const docDisplayType = (d) => formSchemaIdFor(d) ? 'form' : (d.content && d.content.view === 'matrix') ? 'matrix' : d.kind;
    async function fetchDocuments() {
      if (!dbReady()) return;
      try { DOCS = await DB().list('documents', { order: 'name' }); } catch (e) { toast('Could not load documents — check your connection.', 'danger'); }
      if (typeof refreshSopSurfaces === 'function') refreshSopSurfaces();
    }
    // Case-linked paperwork (legacy Drive files + anything case-tagged): listed
    // on the case detail Reports tab.
    const docsForCase = (id) => DOCS.filter((d) => d.case_id === id);

    /* ============================================================ LIVE CID PAPERWORK ============================================================
     * Every documents-table file opens as live, shared paperwork:
     *   doc  → editable rich-text (.docx export)   ·  sheet → editable grid (CSV export)
     *   pdf  → read-only reference (.docx export)   ·  zip  → archive listing
     *   sheet w/ content.view='matrix' → live computed CI risk matrix (read-only)
     * Edits persist to the documents table and broadcast via realtime.
     * ---------------------------------------------------------------------------------------------------- */
    function exportDocText(title, body, filename) {
      const paras = [{ text:title, style:'title' }].concat(body.split('\n').map((l) => {
        const tr = l.trim();
        const heading = tr.length > 0 && tr.length <= 52 && tr === tr.toUpperCase() && /[A-Z]/.test(tr);
        return { text: l, style: heading ? 'heading' : 'normal' };
      }));
      downloadDocx(title, paras, filename);
    }
    function downloadCsv(filename, cols, rows) {
      // Neutralize spreadsheet formula/DDE injection: a member-authored cell that
      // starts with = + - @ (or a leading control char) is prefixed with ' so
      // Excel/Sheets treat it as literal text, not a formula, when another member
      // opens the export.
      const q = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const csv = [cols.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\r\n');
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
      const a = document.createElement('a'); const url = URL.createObjectURL(blob);
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* ---- Fillable structured forms (FORM_SCHEMAS) ----------------------------
     * A documents row whose name/flag matches a schema renders as a fillable form:
     * labelled fields, dropdowns and repeatable tables. Saved to content.values. */
    function formCellInput(f, val, editable) {
      if (f.type === 'checks') {
        const set = new Set(Array.isArray(val) ? val : (val ? String(val).split(/\s*,\s*/) : []));
        if (!editable) { const txt = [...set].join(', '); return `<div class="rounded-md border border-white/5 bg-ink-900/60 px-2.5 py-1.5 text-sm text-slate-200 min-h-[34px]">${txt ? esc(txt) : '<span class="text-slate-600">—</span>'}</div>`; }
        return `<div class="flex flex-wrap gap-x-4 gap-y-1.5 py-1" data-checks="${f.key}">${(f.opts || []).map((o) => `<label class="inline-flex items-center gap-1.5 text-sm text-slate-200"><input type="checkbox" data-checkval="${esc(o)}"${set.has(o) ? ' checked' : ''} class="h-3.5 w-3.5 accent-blue-500" />${esc(o)}</label>`).join('')}</div>`;
      }
      const v = val == null ? '' : String(val);
      const base = 'w-full rounded-md border border-white/10 bg-ink-900 px-2.5 py-1.5 text-sm text-white outline-none focus:border-badge-500';
      if (!editable) return `<div class="rounded-md border border-white/5 bg-ink-900/60 px-2.5 py-1.5 text-sm text-slate-200 min-h-[34px] whitespace-pre-wrap">${esc(v) || '<span class="text-slate-600">—</span>'}</div>`;
      if (f.type === 'select') return `<select data-fkey="${f.key}" class="${base}">${(f.opts || []).map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      if (f.type === 'textarea') return `<textarea data-fkey="${f.key}" rows="4" class="${base} resize-y leading-relaxed">${esc(v)}</textarea>`;
      const t = f.type === 'date' ? 'date' : 'text';
      const ph = f.type === 'money' ? ' placeholder="$0"' : '';
      // Person-name fields get autocomplete against the live Persons registry.
      const person = f.person ? ' data-person="1" list="dl-persons" autocomplete="off"' : '';
      return `<input type="${t}" data-fkey="${f.key}"${person}${ph} value="${esc(v)}" class="${base}" />`;
    }
    // Shared <datalist> of known person names/aliases, refreshed from PERSONS.
    function ensurePersonsDatalist() {
      let dl = document.getElementById('dl-persons');
      if (!dl) { dl = document.createElement('datalist'); dl.id = 'dl-persons'; document.body.appendChild(dl); }
      const names = new Set();
      (typeof PERSONS !== 'undefined' ? PERSONS : []).forEach((p) => { if (p.name) names.add(p.name); if (p.alias) names.add(p.alias); });
      dl.innerHTML = [...names].sort().map((n) => `<option value="${esc(n)}"></option>`).join('');
    }
    function renderFormBody(schema, values, editable) {
      const V = values || {};
      if (editable) ensurePersonsDatalist();
      return schema.sections.map((s) => {
        const head = `<p class="mb-2 text-[11px] font-bold uppercase tracking-wider text-blue-300/90">${esc(s.label)}</p>`;
        if (s.type === 'note') return `<section class="mb-5"><div class="rounded-lg border border-white/10 bg-ink-900/60 p-4">${head}<p class="text-xs leading-relaxed text-slate-400">${esc(s.text)}</p></div></section>`;
        if (s.type === 'textarea') return `<section class="mb-5">${head}${formCellInput({ key: s.key, type: 'textarea' }, V[s.key], editable)}</section>`;
        if (s.type === 'kv') return `<section class="mb-5">${head}<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">${s.fields.map((f) => `<div><label class="mb-1 block text-[11px] font-medium text-slate-400">${esc(f.label)}</label>${formCellInput(f, V[f.key], editable)}</div>`).join('')}</div></section>`;
        // grid: repeatable table. Older reports stored single-suspect fields at the
        // top level (before this section became a grid) — seed one row from those
        // flat keys so legacy warrants still show their suspect.
        let rows = Array.isArray(V[s.id]) && V[s.id].length ? V[s.id] : null;
        if (!rows) { const seed = {}; let has = false; s.cols.forEach((col) => { if (V[col.key] != null && V[col.key] !== '') { seed[col.key] = V[col.key]; has = true; } }); rows = has ? [seed] : [{}]; }
        const rowHtml = (r) => `<tr>${s.cols.map((col) => `<td class="border-b border-r border-white/5 p-1.5 align-top">${formCellInput({ key: col.key, type: col.type, opts: col.opts }, r[col.key], editable)}</td>`).join('')}${editable ? '<td class="border-b border-white/5 p-1.5 text-center align-middle"><button aria-label="Remove row" class="grid-del text-slate-500 hover:text-rose-300" title="Remove row">✕</button></td>' : ''}</tr>`;
        return `<section class="mb-5">${head}
          <div class="overflow-x-auto rounded-lg border border-white/10"><table class="w-full text-left text-sm" data-grid="${s.id}">
            <thead><tr class="bg-ink-800 text-[10px] uppercase tracking-wider text-slate-400">${s.cols.map((col) => `<th class="border-b border-r border-white/5 px-2.5 py-2 font-semibold">${esc(col.label)}</th>`).join('')}${editable ? '<th class="border-b border-white/5 px-2 py-2"></th>' : ''}</tr></thead>
            <tbody>${rows.map(rowHtml).join('')}</tbody>
          </table></div>
          ${editable ? `<button class="grid-add mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 no-print" data-grid-add="${s.id}">+ Add Row</button>` : ''}
        </section>`;
      }).join('');
    }
    function readForm(node, schema) {
      const values = {};
      $$('[data-fkey]', node).forEach((f) => {
        // Skip inputs that live inside a grid (handled below).
        if (f.closest('[data-grid]')) return;
        values[f.dataset.fkey] = f.value;
      });
      // Checkbox-group fields → array of checked option values.
      $$('[data-checks]', node).forEach((grp) => {
        if (grp.closest('[data-grid]')) return;
        values[grp.dataset.checks] = $$('input[type="checkbox"]', grp).filter((c) => c.checked).map((c) => c.dataset.checkval);
      });
      schema.sections.filter((s) => s.type === 'grid').forEach((s) => {
        const tb = node.querySelector(`[data-grid="${s.id}"] tbody`);
        const rows = tb ? $$('tr', tb).map((tr) => {
          const obj = {}; let any = false;
          s.cols.forEach((col) => { const inp = tr.querySelector(`[data-fkey="${col.key}"]`); const v = inp ? inp.value.trim() : ''; obj[col.key] = v; if (v) any = true; });
          return any ? obj : null;
        }).filter(Boolean) : [];
        values[s.id] = rows;
      });
      return values;
    }
    function formToText(schema, values) {
      const V = values || {}; const lines = [];
      schema.sections.forEach((s) => {
        lines.push(s.label.toUpperCase());
        if (s.type === 'note') { lines.push(s.text); }
        else if (s.type === 'textarea') { lines.push(V[s.key] || '—'); }
        else if (s.type === 'kv') { s.fields.forEach((f) => { const raw = V[f.key]; const val = Array.isArray(raw) ? raw.join(', ') : (raw || ''); lines.push(`${f.label}: ${val || '—'}`); }); }
        else { const rows = Array.isArray(V[s.id]) ? V[s.id] : []; lines.push(s.cols.map((c) => c.label).join(' | ')); if (!rows.length) lines.push('—'); rows.forEach((r) => lines.push(s.cols.map((c) => r[c.key] || '').join(' | '))); }
        lines.push('');
      });
      return lines.join('\n');
    }
    // Attach grid add/remove-row delegation to a rendered form body (shared by the
    // Drive form viewer and the in-case Reports authoring flow).
    // When a person-linked field matches a known person who has registered
    // properties, show them as a non-printing hint under the field (helps fill
    // location/recipient lines on subpoenas, wiretaps, etc.).
    function showPersonPropsHint(inp) {
      if (!inp || !inp.parentElement) return;
      const old = inp.parentElement.querySelector(':scope > .person-props-hint'); if (old) old.remove();
      const val = (inp.value || '').trim().toLowerCase(); if (!val) return;
      const p = (typeof PERSONS !== 'undefined' ? PERSONS : []).find((x) => (x.name && x.name.toLowerCase() === val) || (x.alias && x.alias.toLowerCase() === val));
      const props = p && Array.isArray(p.properties) ? p.properties : [];
      if (!props.length) return;
      const hint = el('div', { class: 'person-props-hint no-print mt-1 rounded-md border border-blue-500/20 bg-blue-500/5 px-2.5 py-1.5 text-[11px] text-slate-300' });
      hint.innerHTML = `🏠 <span class="font-semibold text-blue-200">${esc(p.name)}</span> known properties: ` + props.map((pr) => `${esc(pr.address || '—')}${pr.type ? ' (' + esc(pr.type) + ')' : ''}`).join('; ');
      inp.parentElement.appendChild(hint);
    }
    function wireFormBody(body, schema) {
      if (!body) return;
      body.addEventListener('input', (e) => { const inp = e.target.closest('[data-person]'); if (inp) showPersonPropsHint(inp); });
      $$('[data-person]', body).forEach(showPersonPropsHint);
      body.addEventListener('click', (e) => {
        const add = e.target.closest('[data-grid-add]');
        if (add) {
          const sid = add.dataset.gridAdd; const sec = schema.sections.find((s) => s.id === sid);
          const tb = body.querySelector(`[data-grid="${sid}"] tbody`);
          const cellHtml = sec.cols.map((col) => `<td class="border-b border-r border-white/5 p-1.5 align-top">${formCellInput({ key: col.key, type: col.type, opts: col.opts }, '', true)}</td>`).join('');
          tb.insertAdjacentHTML('beforeend', `<tr>${cellHtml}<td class="border-b border-white/5 p-1.5 text-center align-middle"><button aria-label="Remove row" class="grid-del text-slate-500 hover:text-rose-300" title="Remove row">✕</button></td></tr>`);
          return;
        }
        const del = e.target.closest('.grid-del');
        if (del) { const tr = del.closest('tr'); const tb = tr.parentElement; if (tb.children.length > 1) tr.remove(); else $$('[data-fkey]', tr).forEach((i) => { i.value = ''; }); }
      });
    }
    function openFormDocument(doc, meta, schemaId) {
      const schema = FORM_SCHEMAS[schemaId];
      const c = doc.content || {};
      // Hydrate values: prefer saved form values; ignore legacy body text.
      const values = (c.view === 'form' && c.values) ? c.values : {};
      const canEdit = DB() && DB().canEdit();
      const canDel = DB() && DB().canDelete();
      const editable = canEdit;
      const node = el('div', { class:'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-start justify-between gap-3 no-print">
          <div class="flex items-center gap-3"><span class="text-2xl">📝</span><div><h3 class="text-base font-bold text-white">${esc(doc.name)}</h3><p class="text-[11px] text-slate-400">Fillable form${doc.folder ? ' · ' + esc(doc.folder) : ''}${doc.modified_label ? ' · ' + esc(doc.modified_label) : ''}${editable ? '' : ' · read-only'}</p></div></div>
          <button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div class="print-area max-h-[68vh] overflow-y-auto pr-1">
          <div class="mb-4 border-b border-white/10 pb-3"><h2 class="text-lg font-bold text-white">${esc(schema.title)}</h2><p class="text-[11px] text-slate-500">${esc(schema.subtitle)}</p></div>
          <div id="form-body">${renderFormBody(schema, values, editable)}</div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2 no-print">
          ${editable ? `<button id="d-save" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save</button>` : ''}
          <button id="d-print" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">🖨️ Print</button>
          <button id="d-hist" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">🕘 History</button>
          <button id="d-docx" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Export .docx</button>
          ${canDel ? `<button id="d-del" class="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:text-rose-300">Delete</button>` : ''}
        </div>`;
      const body = node.querySelector('#form-body');
      const back = () => closeModal();
      const draftKey = 'form:' + doc.id;
      node.querySelector('.close-x').onclick = () => requestCloseModal(true); // routes through the unsaved guard
      node.querySelector('#d-print').onclick = () => window.print();
      const fHist = node.querySelector('#d-hist'); if (fHist) fHist.onclick = () => openDocHistory(doc, meta);
      wireFormBody(body, schema);
      const saveBtn = node.querySelector('#d-save');
      let baseline = editable ? JSON.stringify(readForm(node, schema)) : null;
      const setSaveState = (txt, cls) => { const s = node.querySelector('#d-savestate'); if (s) { s.textContent = txt; s.className = 'self-center text-[11px] ' + (cls || 'text-slate-400'); } };
      if (editable) {
        saveBtn.insertAdjacentHTML('afterend', '<span id="d-savestate" class="self-center text-[11px] text-slate-400"></span>');
        // Unsaved-changes guard (× / Esc / browser unload all check this).
        Guard.set(() => JSON.stringify(readForm(node, schema)) !== baseline);
        // Local autosave: debounced stash for crash / accidental-close recovery.
        const autosave = debounce(() => { if (JSON.stringify(readForm(node, schema)) !== baseline) { Drafts.save(draftKey, readForm(node, schema)); setSaveState('Draft saved locally · ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); } }, 800);
        body.addEventListener('input', autosave);
        // Recovery: a newer local draft that differs from the saved copy → offer restore.
        const draft = Drafts.load(draftKey);
        if (draft && draft.data && JSON.stringify(draft.data) !== baseline) {
          const banner = el('div', { class: 'no-print mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100' });
          banner.innerHTML = `<span>↩️ Unsaved draft found from ${new Date(draft.at).toLocaleString('en-GB')}.</span><span class="flex gap-2"><button id="dr-restore" class="rounded-md bg-amber-500/80 px-2 py-0.5 font-semibold text-ink-950 transition hover:bg-amber-400">Restore</button><button id="dr-discard" class="rounded-md border border-white/15 px-2 py-0.5 font-semibold text-amber-100 transition hover:bg-white/10">Discard</button></span>`;
          body.parentElement.insertBefore(banner, body);
          banner.querySelector('#dr-restore').onclick = () => { body.innerHTML = renderFormBody(schema, draft.data, editable); $$('[data-person]', body).forEach(showPersonPropsHint); banner.remove(); setSaveState('Draft restored — review and Save', 'text-amber-300'); };
          banner.querySelector('#dr-discard').onclick = () => { Drafts.clear(draftKey); banner.remove(); };
        }
      }
      if (saveBtn) saveBtn.onclick = async () => {
        setSaveState('Saving…', 'text-slate-300');
        const content = { view: 'form', form: schemaId, values: readForm(node, schema) };
        const label = new Date().toLocaleDateString('en-GB');
        const res = await DB().update('documents', doc.id, { content, modified_label: label });
        if (res.error) { setSaveState('Save failed — retry', 'text-rose-300'); toast('Save failed: ' + res.error.message, 'danger'); return; }
        await captureDocVersion(doc.id, { name: doc.name, kind: doc.kind, content, modified_label: label });
        baseline = JSON.stringify(content.values); Drafts.clear(draftKey); Guard.clear();
        setSaveState('Saved ✓', 'text-emerald-300');
        toast(`"${doc.name}" saved`, 'success');
        await fetchDocuments();
        const fresh = DOCS.find((x) => x.id === doc.id); if (fresh) openFormDocument(fresh, meta, schemaId);
      };
      const delBtn = node.querySelector('#d-del');
      if (delBtn) delBtn.onclick = async () => {
        if (!(await uiConfirm('Delete \u201c' + doc.name + '\u201d? This removes the live document for everyone.', { confirmText: 'Delete' }))) return;
        const res = await DB().remove('documents', doc.id);
        if (res.error) { toast('Delete failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Document deleted', 'warn'); await fetchDocuments();
      };
      node.querySelector('#d-docx').onclick = () => {
        const vals = editable ? readForm(node, schema) : values;
        exportDocText(schema.title, formToText(schema, vals), safeName(doc.name) + '.docx');
        toast('Exported .docx', 'success');
      };
      openModal(node, { wide: true, dismissible: false, onClose: back });
    }

    /* ---- Wave 4: document version history (documents_versions) ----------------
     * Every successful save snapshots the saved state; any prior version can be
     * restored. Defensive: if the migration hasn't been applied yet, capture
     * silently no-ops and the History view shows a friendly message. */
    async function captureDocVersion(docId, snap) {
      if (!docId || !dbReady()) return;
      try { await DB().from('documents_versions').insert({ document_id: docId, name: snap.name, kind: snap.kind, content: snap.content, modified_label: snap.modified_label }); } catch (e) {}
    }
    function docSavedByName(id) {
      if (!id) return 'Unknown';
      const p = (typeof PROFILES !== 'undefined' ? PROFILES : []).find((x) => x.id === id);
      return p ? (p.display_name || 'Officer') : 'Officer';
    }
    // Reopen a doc in the right viewer (fillable form vs plain doc/sheet).
    function reopenDoc(doc, meta) { const fid = (typeof formSchemaIdFor === 'function') && formSchemaIdFor(doc); if (fid) return openFormDocument(doc, meta, fid); return openDocument(doc, meta); }
    async function openDocHistory(doc, meta) {
      if (!dbReady()) { toast('Sign-in required.', 'warn'); return; }
      const canEdit = DB() && DB().canEdit();
      let versions = [], unavailable = false;
      try { const r = await DB().from('documents_versions').select('*').eq('document_id', doc.id).order('saved_at', { ascending: false }); if (r.error) throw r.error; versions = r.data || []; }
      catch (e) { unavailable = true; }
      const node = el('div', { class: 'p-6' });
      const back = () => reopenDoc(doc, meta);
      const rowsHtml = versions.map((v, i) => {
        const when = esc(new Date(v.saved_at).toLocaleString('en-GB'));
        const latest = i === 0 ? ' <span class="text-[10px] font-semibold uppercase text-emerald-300">· latest</span>' : '';
        const btn = (canEdit && i !== 0) ? `<button class="ver-restore flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10" data-id="${v.id}">Restore</button>` : '';
        return `<div class="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-2.5"><div class="min-w-0"><p class="text-sm text-slate-200">${when}${latest}</p><p class="text-[11px] text-slate-500">saved by ${esc(docSavedByName(v.saved_by))}</p></div>${btn}</div>`;
      }).join('');
      const bodyHtml = unavailable
        ? '<p class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">Version history isn’t enabled yet (the documents_versions migration hasn’t been applied to this project).</p>'
        : (!versions.length
          ? '<p class="rounded-lg border border-white/5 bg-ink-900/60 p-6 text-center text-sm text-slate-500">No saved versions yet. Edits you save from now on are recorded here.</p>'
          : `<div class="max-h-[60vh] space-y-2 overflow-y-auto">${rowsHtml}</div>`);
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between gap-3"><div class="flex items-center gap-3"><button id="hist-back" class="text-slate-400 hover:text-white" title="Back to document">←</button><div><h3 class="text-base font-bold text-white">Version history</h3><p class="text-[11px] text-slate-400">${esc(doc.name)}</p></div></div><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        ${bodyHtml}`;
      node.querySelector('.close-x').onclick = back;
      node.querySelector('#hist-back').onclick = back;
      node.querySelectorAll('.ver-restore').forEach((b) => b.onclick = async () => {
        const v = versions.find((x) => x.id === b.dataset.id); if (!v) return;
        if (!(await uiConfirm('Restore this version? It becomes the current content and is added as a new history entry.', { danger: false, confirmText: 'Restore' }))) return;
        const label = new Date().toLocaleDateString('en-GB');
        const res = await DB().update('documents', doc.id, { content: v.content, modified_label: label });
        if (res.error) { toast('Restore failed: ' + res.error.message, 'danger'); return; }
        await captureDocVersion(doc.id, { name: doc.name, kind: doc.kind, content: v.content, modified_label: label });
        toast('Version restored', 'success');
        await fetchDocuments();
        reopenDoc(DOCS.find((x) => x.id === doc.id) || doc, meta);
      });
      openModal(node, { wide: true, dismissible: false, onClose: back });
    }

    // Open a single documents-table file as live, editable paperwork.
    function openDocument(doc, meta) {
      const formId = formSchemaIdFor(doc);
      if (formId) return openFormDocument(doc, meta, formId);
      const c = doc.content || {};
      const isMatrix = c.view === 'matrix';
      const kind = isMatrix ? 'matrix' : doc.kind;
      const canEdit = DB() && DB().canEdit();
      const canDel = DB() && DB().canDelete();
      const node = el('div', { class:'p-6' });
      const editable = canEdit && (kind === 'doc' || kind === 'sheet');
      const cols = Array.isArray(c.cols) ? c.cols : ['Date', 'Officer', 'Detail', 'Notes'];
      const rows = Array.isArray(c.rows) ? c.rows : [['', '', '', '']];
      let bodyHtml = '';

      if (kind === 'doc' || kind === 'pdf') {
        bodyHtml = !editable
          ? `<div class="doc-page max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-ink-900 p-5 font-sans text-sm leading-relaxed text-slate-200">${esc(c.body || '')}</div>`
          : `<textarea id="doc-body" class="h-[55vh] w-full resize-none rounded-lg border border-white/10 bg-ink-900 p-5 font-mono text-sm leading-relaxed text-slate-100 outline-none focus:border-badge-500">${esc(c.body || '')}</textarea>`;
      } else if (kind === 'sheet') {
        const ce = editable ? 'true' : 'false';
        bodyHtml = `
          <div class="max-h-[55vh] overflow-auto rounded-lg border border-white/10">
            <table class="w-full text-left text-sm" id="doc-sheet">
              <thead><tr class="bg-ink-800 text-[11px] uppercase tracking-wider text-slate-400">${cols.map((col)=>`<th class="border-b border-white/5 px-3 py-2 font-semibold">${esc(col)}</th>`).join('')}</tr></thead>
              <tbody class="divide-y divide-white/5">${rows.map((r)=>`<tr>${cols.map((_,ci)=>`<td contenteditable="${ce}" class="cell border-r border-white/5 px-3 py-2 text-slate-200 outline-none focus:bg-blue-500/10">${esc(r[ci]!=null?r[ci]:'')}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
          ${editable ? '<button id="add-row" class="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 no-print">+ Add Row</button>' : ''}`;
      } else if (kind === 'matrix') {
        const flagged = CI_MATRIX.filter((x)=>x.felonies>=8).length;
        bodyHtml = `
          <div class="mb-2 flex items-center justify-between"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">🚨 Confidential Informant Risk Matrix <span class="italic text-slate-500">(local preview — not saved)</span></p>${flagged?`<span class="rounded-md bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-300">${flagged} flagged · ≥8 felonies</span>`:''}</div>
          <div class="overflow-hidden rounded-lg border border-white/5"><table class="w-full text-left text-sm"><thead><tr class="bg-ink-800 text-[11px] uppercase tracking-wider text-slate-400"><th class="px-3 py-2 font-semibold">CI ID</th><th class="px-3 py-2 font-semibold">Handler</th><th class="px-3 py-2 font-semibold">Exclusive</th><th class="px-3 py-2 font-semibold">Agreement</th><th class="px-3 py-2 font-semibold">Violent Felonies</th></tr></thead>
          <tbody class="divide-y divide-white/5">${CI_MATRIX.map((x)=>{const al=x.felonies>=8;const ag=x.agreement==='Active'?'text-emerald-300':x.agreement==='Pending'?'text-amber-300':'text-slate-400';return `<tr class="${al?'bg-rose-500/5':''}"><td class="px-3 py-2 font-mono text-blue-300">${esc(x.id)}</td><td class="px-3 py-2 text-slate-200">${esc(x.handler)}</td><td class="px-3 py-2">${x.exclusive?'<span class="text-emerald-300">Yes</span>':'<span class="text-rose-300">Shared ⚠</span>'}</td><td class="px-3 py-2 ${ag}">${esc(x.agreement)}</td><td class="px-3 py-2 font-mono ${al?'font-bold text-rose-300':'text-slate-300'}">${x.felonies}${al?' 🚨':''}</td></tr>`;}).join('')}</tbody></table></div>
          <p class="mt-2 text-[11px] text-slate-500">Policy: max 6 CIs per handler; ineligible at ≥8 violent felony convictions.</p>`;
      } else if (kind === 'zip') {
        const items = Array.isArray(c.items) ? c.items : [];
        bodyHtml = `<p class="mb-2 text-xs text-slate-400">Archive contents (read-only):</p><div class="space-y-2">${items.map((it)=>`<div class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-2.5 text-sm text-slate-300"><span>🗄️</span>${esc(it)}</div>`).join('')}</div>`;
      }

      node.innerHTML = `
        <div class="mb-4 flex items-start justify-between gap-3 no-print">
          <div class="flex items-center gap-3"><span class="text-2xl">${fileIcon(kind)}</span><div><h3 class="text-base font-bold text-white">${esc(doc.name)}</h3><p class="text-[11px] text-slate-400">${esc(doc.folder || 'Document')}${doc.modified_label?' · '+esc(doc.modified_label):''}${editable?'':' · read-only'}</p></div></div>
          <button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        <div class="print-area">${bodyHtml}</div>
        <div class="mt-4 flex flex-wrap gap-2 no-print">
          ${editable ? `<button id="d-save" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save</button>` : ''}
          <button id="d-print" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">🖨️ Print</button>
          ${(kind==='doc'||kind==='sheet') ? `<button id="d-hist" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">🕘 History</button>` : ''}
          ${kind==='sheet' ? `<button id="d-csv" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Export .csv</button>` : ''}
          ${kind==='doc'||kind==='pdf'||kind==='matrix' ? `<button id="d-docx" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Export .docx</button>` : ''}
          ${canDel && !isMatrix ? `<button id="d-del" class="ml-auto rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:text-rose-300">Delete</button>` : ''}
        </div>`;
      const back = () => closeModal();
      node.querySelector('.close-x').onclick = back;
      node.querySelector('#d-print') && (node.querySelector('#d-print').onclick = () => window.print());
      const histBtn = node.querySelector('#d-hist'); if (histBtn) histBtn.onclick = () => openDocHistory(doc, meta);

      // Sheet helpers
      const readSheet = () => ({ cols: cols.slice(), rows: $$('#doc-sheet tbody tr', node).map((tr) => $$('.cell', tr).map((td) => td.textContent.trim())) });
      const addRow = node.querySelector('#add-row');
      if (addRow) addRow.onclick = () => {
        const tb = node.querySelector('#doc-sheet tbody');
        tb.insertAdjacentHTML('beforeend', `<tr>${cols.map(()=>`<td contenteditable="true" class="cell border-r border-white/5 px-3 py-2 text-slate-200 outline-none focus:bg-blue-500/10"></td>`).join('')}</tr>`);
      };

      // Save → documents table
      const saveBtn = node.querySelector('#d-save');
      if (saveBtn) saveBtn.onclick = async () => {
        const content = kind === 'doc' ? { body: node.querySelector('#doc-body').value } : readSheet();
        const label = new Date().toLocaleDateString('en-GB');
        const res = await DB().update('documents', doc.id, { content, modified_label: label });
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        await captureDocVersion(doc.id, { name: doc.name, kind: doc.kind, content, modified_label: label });
        toast(`"${doc.name}" saved`, 'success');
        await fetchDocuments();
        const fresh = DOCS.find((x) => x.id === doc.id); if (fresh) openDocument(fresh, meta);
      };
      // Delete
      const delBtn = node.querySelector('#d-del');
      if (delBtn) delBtn.onclick = async () => {
        if (!(await uiConfirm('Delete \u201c' + doc.name + '\u201d? This removes the live document for everyone.', { confirmText: 'Delete' }))) return;
        const res = await DB().remove('documents', doc.id);
        if (res.error) { toast('Delete failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Document deleted', 'warn'); await fetchDocuments();
      };
      // Exports
      const docxBtn = node.querySelector('#d-docx');
      if (docxBtn) docxBtn.onclick = () => {
        if (kind === 'matrix') {
          const paras = [{text:'Confidential Informant Risk Matrix', style:'title'}].concat(
            CI_MATRIX.map((x)=>({ text:`${x.id} — ${x.handler} — ${x.exclusive?'Exclusive':'Shared'} — ${x.agreement} — ${x.felonies} violent felonies${x.felonies>=8?' (FLAGGED)':''}`, style:'normal' })));
          exportDocxParas('CI Risk Matrix', paras, safeName(doc.name) + '.docx');
        } else {
          const body = kind === 'doc' && node.querySelector('#doc-body') ? node.querySelector('#doc-body').value : (c.body || '');
          exportDocText(doc.name.replace(/\.[a-z]+$/i,''), body, safeName(doc.name) + '.docx');
        }
        toast('Exported .docx', 'success');
      };
      const csvBtn = node.querySelector('#d-csv');
      if (csvBtn) csvBtn.onclick = () => { const s = readSheet(); downloadCsv(safeName(doc.name) + '.csv', s.cols, s.rows); toast('Exported .csv', 'success'); };

      openModal(node, { wide: true, dismissible: false, onClose: back });
    }
    function exportDocxParas(title, paras, filename) { downloadDocx(title, paras, filename); }


    /* ---- SOPs view (Reference tab) --------------------------------------------
       Standard Operating Procedures live in the documents table (folder 'SOPs')
       so they get versioning/search for free. Every active member can read;
       create/edit is command staff — gated here for UX and enforced server-side
       by the documents RLS folder guard. */
    const SOP_FOLDER = 'SOPs';
    const sopTitle = (d) => String(d.name || '').replace(/\.(docx?|pdf|sheet)$/i, '');
    // Render plain doc text as a readable article: blank-line-separated blocks,
    // short ALL-CAPS / colon-terminated lines become section headings. All escaped.
    function sopArticle(body, docTitle) {
      // Safe mini-Markdown: escape first, then transform. Handles \r\n (Drive
      // exports), # headings, **bold**, > notes, -/1. lists, Markdown tables
      // (|:-:| separators), and bare pipe-delimited data blocks (rosters).
      const norm = String(body || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/^_{4,}\s*$/gm, '');
      const blocks = norm.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
      if (!blocks.length) return '<p class="text-slate-500">No content.</p>';
      // Roster stats collected while rendering; tiles are derived from the SAME
      // cells the tables show, so they can never disagree with the document.
      const sections = []; let curSec = null;
      const tally = (rows) => {
        const members = rows.filter((r) => r.filter(Boolean).length >= 2);
        const active = members.filter((r) => r.some((c) => c.trim().toLowerCase() === 'active')).length;
        if (curSec) sections.push({ sec: curSec, n: members.length, active });
      };
      const inline = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
      const cell = (v) => {
        const t = v.trim(), l = t.toLowerCase();
        if (l === 'active') return '<span class="sop-chip sop-chip-on">ACTIVE</span>';
        if (l === 'inactive' || l === 'loa' || l === 'suspended' || l === 'tba') return '<span class="sop-chip sop-chip-off">' + esc(t.toUpperCase()) + '</span>';
        return inline(t);
      };
      const isSep = (l) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes('-');
      const tableHtml = (rows, hasHead) => {
        const width = Math.max.apply(null, rows.map((r) => r.length));
        // Numeric column headed Strike/Points renders as number + proportional bar.
        let barCol = -1, barMax = 0;
        if (hasHead) {
          barCol = rows[0].findIndex((h) => /strike|points?$/i.test(h));
          if (barCol >= 0) { rows.slice(1).forEach((r) => { const v = parseFloat(r[barCol]); if (isFinite(v)) barMax = Math.max(barMax, v); }); if (!barMax) barCol = -1; }
        }
        const td = (r, i) => {
          if (i === barCol && r !== rows[0]) { const v = parseFloat(r[i]); if (isFinite(v)) { const pct = Math.max(0, Math.min(100, Math.round(v / barMax * 100))); return '<td><span class="sop-barwrap"><span class="sop-bar" style="width:' + pct + '%"></span></span><span class="sop-barnum">' + v + '</span></td>'; } }
          return '<td>' + (r[i] ? cell(r[i]) : '<span class="sop-empty">-</span>') + '</td>';
        };
        const tr = (r, tag) => tag === 'th'
          ? '<tr>' + Array.from({ length: width }, (_, i) => '<th>' + (r[i] ? cell(r[i]) : '<span class="sop-empty">-</span>') + '</th>').join('') + '</tr>'
          : '<tr>' + Array.from({ length: width }, (_, i) => td(r, i)).join('') + '</tr>';
        // A row with one non-empty bold cell is a group header (e.g. **HVPU Command**).
        const bodyRows = rows.slice(hasHead ? 1 : 0).map((r) => {
          const filled = r.filter(Boolean);
          if (filled.length === 1 && /^\*\*[^*]+\*\*$/.test(filled[0])) return '<tr><td class="sop-group" colspan="' + width + '">' + esc(filled[0].replace(/\*\*/g, '')) + '</td></tr>';
          return tr(r, 'td');
        }).join('');
        return '<div class="sop-tablewrap"><table class="sop-table">' + (hasHead ? tr(rows[0], 'th') : '') + bodyRows + '</table></div>';
      };
      const splitRow = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const rendered = blocks.map((b) => {
        const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return '';
        // Markdown heading / quote blocks.
        if (/^#{1,6}\s/.test(lines[0]) && lines.length === 1) { curSec = lines[0].replace(/^#{1,6}\s+/, ''); return '<h3>' + inline(curSec) + '</h3>'; }
        if (lines.every((l) => /^>\s?/.test(l))) return '<blockquote class="sop-note">' + inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' ')) + '</blockquote>';
        // Lists.
        if (lines.length > 1 && lines.every((l) => /^([-*•]|\d+[.)])\s/.test(l))) {
          const ord = /^\d/.test(lines[0]);
          return '<' + (ord ? 'ol' : 'ul') + ' class="sop-list">' + lines.map((l) => '<li>' + inline(l.replace(/^([-*•]|\d+[.)])\s+/, '')) + '</li>').join('') + '</' + (ord ? 'ol' : 'ul') + '>';
        }
        // Tables: Markdown (with separator row) or bare pipe data.
        const piped = lines.filter((l) => l.includes('|'));
        const sepIdx = lines.findIndex(isSep);
        if (sepIdx === 1 && piped.length >= 2) {
          const rows = lines.filter((l, i) => i !== sepIdx && !isSep(l)).map(splitRow);
          tally(rows.slice(1));
          return tableHtml(rows, true);
        }
        const tabular = piped.length >= 2 || (piped.length === 1 && piped[0].split('|').length >= 4);
        if (tabular) {
          const head = !lines[0].includes('|') && !/^#/.test(lines[0]) ? lines.shift() : null;
          if (head) curSec = head.replace(/:$/, '');
          const rows = lines.filter((l) => !isSep(l)).map(splitRow);
          tally(rows);
          return (head ? '<h3>' + inline(head.replace(/:$/, '')) + '</h3>' : '') + tableHtml(rows, false);
        }
        // Heading heuristics + mixed blocks (heading line then prose).
        const out = [];
        let para = [];
        const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
        for (const l of lines) {
          const md = /^#{1,6}\s/.test(l);
          const caps = l.length <= 64 && ((l === l.toUpperCase() && /[A-Z]/.test(l)) || /:$/.test(l)) && lines.length > 1 === false;
          if (md) { flush(); out.push('<h3>' + inline(l.replace(/^#{1,6}\s+/, '')) + '</h3>'); }
          else para.push(l);
        }
        flush();
        if (out.length === 1 && lines.length === 1) {
          const t = lines[0];
          if (t.length <= 64 && ((t === t.toUpperCase() && /[A-Z]/.test(t)) || /:$/.test(t)) && !t.includes('|')) { curSec = t.replace(/:$/, ''); return '<h3>' + inline(curSec) + '</h3>'; }
        }
        return out.join('');
      }).join('');
      const isRoster = /roster/i.test(String(docTitle || '')) && sections.length >= 2;
      const tiles = isRoster ? '<div class="sop-tiles">' + sections.map((s) =>
        '<div class="sop-tile"><p class="sop-tile-n">' + s.n + '</p><p class="sop-tile-a">' + s.active + ' ACTIVE</p><p class="sop-tile-l">' + esc(s.sec) + '</p></div>').join('') + '</div>' : '';
      return tiles + rendered;
    }
    function onEnterSops() {
      if (typeof fetchDocuments === 'function' && dbReady()) fetchDocuments().then(refreshSopSurfaces); else renderSops();
    }
    function renderSops() {
      const grid = $('#sop-grid'); if (!grid) return;
      if (!dbReady()) { grid.innerHTML = '<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">Sign in to read division SOPs.</div>'; return; }
      const canManage = typeof canReassign === 'function' && canReassign();
      const nb = $('#sop-new'); if (nb) { nb.classList.toggle('hidden', !canManage); if (!nb.dataset.wired) { nb.dataset.wired = '1'; nb.onclick = () => openSopEditor(null); } }
      const sops = (typeof DOCS !== 'undefined' ? DOCS : []).filter((d) => d.folder === SOP_FOLDER).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      if (!sops.length) { grid.innerHTML = '<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400"><span class="t-readout">NO SOPS PUBLISHED // POLICY QUEUE EMPTY.</span>' + (canManage ? ' Use “+ New SOP”.' : '') + '</div>'; return; }
      grid.innerHTML = '';
      const lib = (typeof DOCS !== 'undefined' ? DOCS : []).filter((x) => x.folder === 'Resources').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      sops.concat(lib).forEach((d, i) => grid.appendChild(sopDocCard(d, i, canManage)));
    }
    // Documents surface where their subject lives, not where they were uploaded:
    // rosters (folder 'Personnel') on the Personnel tab, gang dossiers (folder
    // 'Gang Intel') on the Gangs tab. Same reader/editor everywhere; the folder
    // stays command-write-only via the documents RLS folder guard.
    const SOP_CARD_TAG = { 'Resources': 'LIBRARY', 'Personnel': 'ROSTER', 'Gang Intel': 'GANG INTEL' };
    function sopDocCard(d, i, canManage) {
      const card = el('div', { class: 'person-card cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-5' });
      card.style.setProperty('--i', String(i));
      const body = (d.content && d.content.body) || '';
      card.innerHTML = `
        <p class="text-sm font-semibold text-white">${esc(sopTitle(d))}</p>
        <p class="mt-1 line-clamp-3 text-xs text-slate-400">${esc(body.slice(0, 200)) || 'No content yet.'}</p>
        <p class="t-readout mt-3 text-[10px] uppercase text-slate-500">${SOP_CARD_TAG[d.folder] || 'SOP'} // ${esc(d.modified_label || 'undated')}</p>`;
      card.onclick = () => openSopReader(d, canManage);
      return card;
    }
    function renderDocShelf(gridId, headId, folder) {
      const grid = $('#' + gridId); if (!grid) return;
      const head = headId ? $('#' + headId) : null;
      const docs = (typeof DOCS !== 'undefined' && dbReady() ? DOCS : []).filter((d) => d.folder === folder).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      if (head) head.classList.toggle('hidden', !docs.length);
      grid.classList.toggle('hidden', !docs.length);
      grid.innerHTML = '';
      const canManage = typeof canReassign === 'function' && canReassign();
      docs.forEach((d, i) => grid.appendChild(sopDocCard(d, i, canManage)));
    }
    function renderPersonnelDocs() { renderDocShelf('personnel-docs', 'personnel-docs-head', 'Personnel'); }
    function renderGangDocs() { renderDocShelf('gang-docs', 'gang-docs-head', 'Gang Intel'); }
    function refreshSopSurfaces() { renderSops(); renderPersonnelDocs(); renderGangDocs(); }
    function openSopReader(d, canManage) {
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between gap-3"><h3 class="min-w-0 truncate text-lg font-bold text-white">${esc(sopTitle(d))}</h3><button aria-label="Close" class="close-x flex-shrink-0 text-2xl leading-none text-slate-400 hover:text-white">&times;</button></div>
        <p class="t-readout mb-3 text-[10px] uppercase tracking-widest text-slate-500">${{ 'Resources': 'Reference library document', 'Personnel': 'Division roster', 'Gang Intel': 'Gang intelligence document' }[d.folder] || 'Standard operating procedure'} // ${esc(d.modified_label || 'undated')}${(d.content && d.content.sync && d.content.sync.source === 'gdrive') ? ' // SYNCED FROM GOOGLE DRIVE' : ''}</p>
        <div class="sop-prose max-h-[65vh] overflow-y-auto rounded-lg border border-white/5 bg-ink-900 p-6">${sopArticle(d.content && d.content.body, sopTitle(d))}</div>
        ${canManage ? '<div class="mt-4 flex gap-2"><button id="sop-edit" class="flex-1 rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10">Edit</button><button id="sop-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button></div>' : ''}`;
      node.querySelector('.close-x').onclick = closeModal;
      const ed = node.querySelector('#sop-edit'); if (ed) ed.onclick = () => { closeModal(); openSopEditor(d); };
      const dl = node.querySelector('#sop-del'); if (dl) dl.onclick = async () => {
        if (!(await uiConfirm('Delete SOP “' + d.name + '”? Restorable via Undo.', { confirmText: 'Delete' }))) return;
        closeModal(); await deleteWithUndo('documents', d, { label: 'SOP “' + d.name + '”', noConfirm: true, after: () => { if (typeof fetchDocuments === 'function') fetchDocuments(); } });
      };
      openModal(node, { wide: true });
    }
    /* ---- Structured SOP editor ------------------------------------------------
       Rosters live as pipe/Markdown text inside content.body. Editing that raw
       text is hostile, so the editor parses the body into blocks (headings,
       tables, prose), presents labeled inputs per cell, and serializes back to
       the exact text format sopArticle renders. The parser mirrors sopArticle's
       block heuristics; changing one side means re-checking the round-trip. */
    const SOP_STATUS_OPTS = ['Active', 'Semi-Active', 'LOA', 'Inactive', 'Suspended', 'TBA', 'N/A'];
    const sopIsSep = (l) => /^\|?[\s:|-]+\|?$/.test(l) && l.includes('-');
    const sopSplitRow = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    function sopParseBlocks(body) {
      const norm = String(body || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/^_{4,}\s*$/gm, '');
      const out = [];
      const mkRow = (cells) => {
        const filled = cells.filter(Boolean);
        if (filled.length === 1 && /^\*\*[^*]+\*\*$/.test(filled[0])) return { g: true, text: filled[0].replace(/\*\*/g, '') };
        return { g: false, cells: cells };
      };
      norm.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).forEach((b) => {
        const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) return;
        const md = lines.length === 1 && lines[0].match(/^(#{1,6})\s+(.*)$/);
        if (md) { out.push({ t: 'h', level: md[1].length, text: md[2] }); return; }
        const piped = lines.filter((l) => l.includes('|'));
        const sepIdx = lines.findIndex(sopIsSep);
        if (sepIdx === 1 && piped.length >= 2) {
          const rows = lines.filter((l, i) => i !== sepIdx && !sopIsSep(l)).map(sopSplitRow);
          out.push({ t: 'tbl', head: rows[0], sep: lines[sepIdx], title: null, rows: rows.slice(1).map(mkRow) });
          return;
        }
        if (piped.length >= 2 || (piped.length === 1 && piped[0].split('|').length >= 4)) {
          const ls = lines.slice();
          const title = !ls[0].includes('|') && !/^#/.test(ls[0]) ? ls.shift() : null;
          out.push({ t: 'tbl', head: null, sep: null, title: title, rows: ls.filter((l) => !sopIsSep(l)).map(sopSplitRow).map(mkRow) });
          return;
        }
        if (lines.length === 1 && lines[0].length <= 64 && !lines[0].includes('|') &&
            ((lines[0] === lines[0].toUpperCase() && /[A-Z]/.test(lines[0])) || /:$/.test(lines[0]))) {
          out.push({ t: 'h', level: 0, text: lines[0] }); return;
        }
        out.push({ t: 'p', raw: b });
      });
      return out;
    }
    function sopSerializeBlocks(blocks) {
      const clean = (c) => String(c == null ? '' : c).trim();
      return blocks.map((b) => {
        if (b.t === 'h') return b.level ? '#'.repeat(b.level) + ' ' + b.text.trim() : b.text.trim();
        if (b.t === 'p') return b.raw;
        if (b.head) {
          const width = b.head.length;
          const line = (cs) => '| ' + Array.from({ length: width }, (_, i) => clean(cs[i])).join(' | ') + ' |';
          const sep = b.sep || ('|' + Array.from({ length: width }, () => ' :-: ').join('|') + '|');
          return [line(b.head), sep].concat(b.rows.map((r) => line(r.g ? ['**' + r.text.trim() + '**'] : r.cells))).join('\n');
        }
        // Bare pipe tables keep their ragged style: trailing empties dropped.
        const rowLine = (r) => {
          const cs = (r.g ? ['**' + r.text.trim() + '**'] : r.cells).map(clean);
          while (cs.length > 1 && !cs[cs.length - 1]) cs.pop();
          return cs.join(' | ');
        };
        return (b.title ? b.title + '\n' : '') + b.rows.map(rowLine).join('\n');
      }).filter(Boolean).join('\n\n');
    }
    // Which column holds a member status: named header first, else the column
    // where most filled values belong to the status vocabulary (headerless rosters).
    function sopStatusCol(b) {
      if (b.head) return b.head.findIndex((h) => /status/i.test(h));
      const rows = b.rows.filter((r) => !r.g);
      const width = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
      const vocab = SOP_STATUS_OPTS.map((s) => s.toLowerCase());
      for (let i = 0; i < width; i++) {
        const vals = rows.map((r) => (r.cells[i] || '').trim().toLowerCase()).filter(Boolean);
        if (vals.length >= 2 && vals.filter((v) => vocab.indexOf(v) >= 0).length / vals.length >= 0.6) return i;
      }
      return -1;
    }
    function sopFormEditor(host, model) {
      host.innerHTML = '';
      const rerender = () => sopFormEditor(host, model);
      model.forEach((b) => {
        if (b.t === 'h') {
          const wrap = el('div', { class: 'mb-3' }, '<p class="sop-fe-col">SECTION HEADING</p>');
          const inp = el('input', { class: 'sop-fe-head' });
          inp.value = b.text; inp.oninput = () => { b.text = inp.value; };
          wrap.appendChild(inp); host.appendChild(wrap); return;
        }
        if (b.t === 'p') {
          const wrap = el('div', { class: 'mb-3' }, '<p class="sop-fe-col">TEXT</p>');
          const ta = el('textarea', { class: 'sop-fe-text', rows: String(Math.min(8, b.raw.split('\n').length + 1)) });
          ta.value = b.raw; ta.oninput = () => { b.raw = ta.value; };
          wrap.appendChild(ta); host.appendChild(wrap); return;
        }
        const width = b.head ? b.head.length : Math.max(2, b.rows.filter((r) => !r.g).reduce((m, r) => Math.max(m, r.cells.length), 0));
        const statusCol = sopStatusCol(b);
        const numCol = b.head ? b.head.findIndex((h) => /strike|points?$/i.test(h)) : -1;
        const box = el('div', { class: 'sop-fe-tbl' });
        if (b.title != null) {
          const ti = el('input', { class: 'sop-fe-head' });
          ti.value = b.title; ti.placeholder = 'Section heading';
          ti.oninput = () => { b.title = ti.value; };
          box.appendChild(ti);
        }
        const grid = el('div', { class: 'sop-fe-grid' });
        grid.style.gridTemplateColumns = 'repeat(' + width + ', minmax(110px, 1fr)) 28px';
        for (let i = 0; i < width; i++) {
          if (b.head) {
            const hi = el('input', { class: 'sop-fe-colhead' });
            hi.value = b.head[i] || ''; hi.oninput = () => { b.head[i] = hi.value; };
            grid.appendChild(hi);
          } else grid.appendChild(el('p', { class: 'sop-fe-col' }, 'COL ' + (i + 1)));
        }
        grid.appendChild(el('span'));
        b.rows.forEach((r, ri) => {
          if (r.g) {
            const gi = el('input', { class: 'sop-fe-groupin' });
            gi.style.gridColumn = '1 / span ' + width;
            gi.value = r.text; gi.placeholder = 'Group header';
            gi.oninput = () => { r.text = gi.value; };
            grid.appendChild(gi);
          } else {
            while (r.cells.length < width) r.cells.push('');
            for (let i = 0; i < width; i++) {
              const cur = (r.cells[i] || '').trim();
              if (i === statusCol) {
                const sel = el('select', {});
                const opts = SOP_STATUS_OPTS.slice();
                if (cur && opts.map((o) => o.toLowerCase()).indexOf(cur.toLowerCase()) < 0) opts.unshift(cur);
                [''].concat(opts).forEach((o) => { const op = el('option', { value: o }, esc(o || '—')); sel.appendChild(op); });
                sel.value = cur && opts.map((o) => o.toLowerCase()).indexOf(cur.toLowerCase()) >= 0
                  ? opts[opts.map((o) => o.toLowerCase()).indexOf(cur.toLowerCase())] : cur;
                sel.onchange = () => { r.cells[i] = sel.value; };
                grid.appendChild(sel);
              } else {
                const ci = el('input', i === numCol ? { type: 'number', min: '0' } : {});
                ci.value = r.cells[i] || '';
                if (b.head) ci.placeholder = b.head[i] || '';
                ci.oninput = () => { r.cells[i] = ci.value; };
                grid.appendChild(ci);
              }
            }
          }
          const del = el('button', { class: 'sop-fe-del', type: 'button', 'aria-label': 'Remove row' }, '&times;');
          del.onclick = () => { b.rows.splice(ri, 1); rerender(); };
          grid.appendChild(del);
        });
        const scroll = el('div', { class: 'sop-fe-scroll' }); scroll.appendChild(grid); box.appendChild(scroll);
        const bar = el('div', { class: 'sop-fe-bar' });
        const addRow = el('button', { class: 'sop-fe-add', type: 'button' }, '+ Row');
        addRow.onclick = () => { b.rows.push({ g: false, cells: Array.from({ length: width }, () => '') }); rerender(); };
        bar.appendChild(addRow);
        if (b.head) {
          const addGrp = el('button', { class: 'sop-fe-add', type: 'button' }, '+ Group header');
          addGrp.onclick = () => { b.rows.push({ g: true, text: '' }); rerender(); };
          bar.appendChild(addGrp);
        }
        box.appendChild(bar); host.appendChild(box);
      });
      if (!model.length) host.appendChild(el('p', { class: 'sop-fe-col' }, 'NO CONTENT PARSED // SWITCH TO RAW TEXT.'));
    }
    function openSopEditor(record) {
      if (!(typeof canReassign === 'function' && canReassign())) { toast('Command staff only.', 'warn'); return; }
      const d = record || {};
      const body0 = (d.content && d.content.body) || '';
      let model = sopParseBlocks(body0);
      const hasTables = model.some((b) => b.t === 'tbl');
      let mode = hasTables ? 'form' : 'raw';
      const synced = !!(d.content && d.content.sync && d.content.sync.source === 'gdrive');
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between gap-3">
          <h3 class="text-lg font-bold text-white">${record ? 'Edit' : 'New'} SOP</h3>
          <div class="flex flex-shrink-0 items-center gap-3">
            ${hasTables ? '<button id="sop-mode" type="button" class="rounded border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10">Raw text</button>' : ''}
            <button aria-label="Close" class="close-x text-2xl leading-none text-slate-400 hover:text-white">&times;</button>
          </div>
        </div>
        ${synced ? '<p class="t-readout mb-3 text-[10px] uppercase tracking-widest text-amber-400/80">SYNCED FROM GOOGLE DRIVE // THE NEXT DRIVE EDIT OVERWRITES PORTAL CHANGES</p>' : ''}
        <label class="mb-1 block text-xs font-semibold text-slate-400">Title *</label>
        <input id="sop-name" value="${esc(d.name || '')}" class="mb-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Use of Force Policy" />
        <div id="sop-form" class="sop-fe ${mode === 'form' ? '' : 'hidden'}"></div>
        <div id="sop-rawwrap" class="${mode === 'raw' ? '' : 'hidden'}">
          <label class="mb-1 block text-xs font-semibold text-slate-400">Procedure text *</label>
          <textarea id="sop-body" rows="12" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"></textarea>
        </div>
        <button id="sop-save" class="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Publish SOP'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      const formHost = node.querySelector('#sop-form');
      const ta = node.querySelector('#sop-body');
      if (mode === 'form') sopFormEditor(formHost, model); else ta.value = body0;
      const modeBtn = node.querySelector('#sop-mode');
      if (modeBtn) modeBtn.onclick = () => {
        if (mode === 'form') { ta.value = sopSerializeBlocks(model); mode = 'raw'; modeBtn.textContent = 'Form editor'; }
        else { model = sopParseBlocks(ta.value); mode = 'form'; modeBtn.textContent = 'Raw text'; sopFormEditor(formHost, model); }
        formHost.classList.toggle('hidden', mode !== 'form');
        node.querySelector('#sop-rawwrap').classList.toggle('hidden', mode !== 'raw');
      };
      node.querySelector('#sop-save').onclick = async () => {
        const name = node.querySelector('#sop-name').value.trim();
        const body = mode === 'form' ? sopSerializeBlocks(model) : ta.value;
        if (!name || !body.trim()) { toast('Title and procedure text are required.', 'warn'); return; }
        // Merge into existing content so Drive-sync metadata survives portal edits.
        const content = Object.assign({}, d.content || {}, { body: body });
        const payload = { folder: (record && record.folder) || SOP_FOLDER, name: name, kind: 'doc', content: content, modified_label: new Date().toLocaleDateString('en-GB') };
        const res = record && record.id ? await DB().update('documents', record.id, payload) : await DB().insert('documents', payload);
        if (res && res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Document updated' : 'Document published', 'success');
        if (typeof fetchDocuments === 'function') fetchDocuments().then(refreshSopSurfaces);
      };
      openModal(node, { wide: true });
    }

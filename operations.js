/* operations.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Operations / Task Forces: group related cases under one umbrella (a multi-case
   gang takedown, a joint op, etc.) with a status rollup across the linked cases. */
"use strict";

    // ---- state ------------------------------------------------------------
    let operationsCache = [];
    let opsCasesCache = [];   // lightweight case rows for rollups + linking
    let opDetailId = null;    // null = list view; else the open operation's id
    let opPendingOpen = null; // set by gotoOperation() to deep-link into a detail
    const OP_STATUSES = ['open', 'active', 'cold', 'closed'];
    const OP_SEG_COLOR = { open: 'bg-amber-400', active: 'bg-emerald-400', cold: 'bg-blue-400', closed: 'bg-slate-500' };
    const opStatusTint = (s) => s === 'closed' ? 'bg-slate-500/20 text-slate-300' : 'bg-emerald-500/15 text-emerald-300';

    async function ensureOperations() {
      try { operationsCache = await DB().list('operations', { order: 'created_at', ascending: false }); }
      catch (e) { operationsCache = []; }
      return operationsCache;
    }
    async function fetchOpsCases() {
      try { opsCasesCache = await DB().list('cases', { select: 'id,case_number,title,status,bureau,operation_id,lead_detective_id,updated_at' }); }
      catch (e) { opsCasesCache = []; }
      return opsCasesCache;
    }
    const opCases = (opId) => opsCasesCache.filter((c) => c.operation_id === opId);

    async function onEnterOperations() {
      const body = $('#ops-body'); if (!body) return;
      if (!dbReady()) { body.innerHTML = '<p class="text-sm text-slate-400">Sign in to load operations.</p>'; return; }
      if (typeof skeletonCards === 'function') skeletonCards(body, 6); else body.innerHTML = '<p class="text-sm text-slate-400">Loading…</p>';
      await Promise.all([ensureOperations(), fetchOpsCases()]);
      opDetailId = opPendingOpen; opPendingOpen = null;
      renderOperations();
    }

    // Deep-link from elsewhere (e.g. a case header) straight into an operation.
    function gotoOperation(id) {
      opPendingOpen = id;
      if (typeof navigate === 'function') navigate('operations'); else onEnterOperations();
    }
    window.gotoOperation = gotoOperation;

    // ---- rollup bar: proportional colored segments by case status ----------
    function opRollup(cs) {
      if (!cs.length) return '<div class="h-1.5 rounded-full bg-white/5"></div>';
      const segs = OP_STATUSES.map((st) => {
        const n = cs.filter((c) => c.status === st).length;
        return n ? `<span class="${OP_SEG_COLOR[st]}" style="width:${(n / cs.length) * 100}%" title="${n} ${st}"></span>` : '';
      }).join('');
      return `<div class="flex h-1.5 overflow-hidden rounded-full bg-white/5">${segs}</div>`;
    }

    function renderOperations() {
      const body = $('#ops-body'); if (!body) return;
      if (opDetailId) return renderOperationDetail(opDetailId);
      const canEdit = DB() && DB().canEdit();
      const cards = operationsCache.map((op) => {
        const cs = opCases(op.id);
        return `<div class="op-card cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-5 transition hover:border-blue-500/30 hover:bg-white/5" data-id="${op.id}">
            <div class="flex items-start justify-between gap-2">
              <p class="min-w-0 truncate text-sm font-semibold text-white">${escapeHTML(op.name || 'Untitled operation')}</p>
              <span class="flex-shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${opStatusTint(op.status)}">${escapeHTML(op.status || 'active')}</span>
            </div>
            <p class="mt-2 line-clamp-2 text-xs text-slate-400">${escapeHTML(op.description || 'No description.')}</p>
            <div class="mt-3">${opRollup(cs)}</div>
            <p class="mt-2 text-[11px] text-slate-500">${cs.length} case${cs.length === 1 ? '' : 's'} linked</p>
          </div>`;
      }).join('');
      body.innerHTML = `
        <div class="mb-4 flex items-center justify-between gap-3">
          <p class="text-sm text-slate-400">Group related cases into a task force. Each operation rolls up the status of its cases.</p>
          ${canEdit ? '<button id="op-new" class="flex-shrink-0 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">+ New Operation</button>' : ''}
        </div>
        ${operationsCache.length ? `<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">${cards}</div>`
          : `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">No operations yet.${canEdit ? ' Create one to bundle related cases.' : ''}</div>`}`;
      const nb = $('#op-new'); if (nb) nb.onclick = () => openOperationModal(null);
      $$('.op-card', body).forEach((c) => c.onclick = () => { opDetailId = c.dataset.id; renderOperations(); });
    }

    function renderOperationDetail(id) {
      const body = $('#ops-body'); if (!body) return;
      const op = operationsCache.find((o) => o.id === id);
      if (!op) { opDetailId = null; return renderOperations(); }
      const canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const cs = opCases(id);
      const unlinked = opsCasesCache.filter((c) => !c.operation_id);
      const counts = OP_STATUSES.map((st) => `${cs.filter((c) => c.status === st).length} ${st}`).join(' · ');
      const caseRow = (c) => `<div class="flex items-center gap-3 rounded-xl border border-white/5 bg-ink-900 px-4 py-3">
          <button class="op-open min-w-0 flex-1 text-left" data-id="${c.id}">
            <p class="truncate font-mono text-xs font-semibold text-blue-300">${escapeHTML(String(c.case_number || '').replace('-', ' · '))}</p>
            <p class="truncate text-sm text-white">${escapeHTML(c.title || 'Untitled case')}</p>
          </button>
          <span class="flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${caseStatusTint(c.status)}">${escapeHTML(c.status || '')}</span>
          ${canEdit ? `<button class="op-unlink flex-shrink-0 text-slate-500 transition hover:text-rose-300" data-id="${c.id}" title="Remove from this operation">✕</button>` : ''}
        </div>`;
      body.innerHTML = `
        <button id="op-back" class="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-300 transition hover:text-blue-200">← All operations</button>
        <div class="mb-4 rounded-2xl border border-white/5 bg-ink-900/60 p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2"><h3 class="truncate text-xl font-bold text-white">${escapeHTML(op.name || 'Untitled operation')}</h3><span class="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${opStatusTint(op.status)}">${escapeHTML(op.status || 'active')}</span></div>
              <p class="mt-1 text-sm text-slate-400">${escapeHTML(op.description || 'No description.')}</p>
            </div>
            ${canEdit ? `<div class="flex flex-shrink-0 gap-2"><button id="op-edit" class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10">Edit</button>${canDel ? '<button id="op-del" class="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20">Delete</button>' : ''}</div>` : ''}
          </div>
          <div class="mt-4">${opRollup(cs)}</div>
          <p class="mt-2 text-[11px] text-slate-500">${cs.length} case${cs.length === 1 ? '' : 's'}${cs.length ? ' — ' + counts : ''}</p>
        </div>
        ${canEdit ? `<div class="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/5 bg-ink-900/60 p-4">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Link a case</span>
          <select id="op-link-sel" class="min-w-[14rem] flex-1 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
            <option value="">— pick an unlinked case —</option>
            ${unlinked.map((c) => `<option value="${c.id}">${escapeHTML(String(c.case_number || '') + ' · ' + (c.title || ''))}</option>`).join('')}
          </select>
          <button id="op-link" class="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15">Link</button>
        </div>` : ''}
        <h4 class="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-400">Linked cases (${cs.length})</h4>
        <div class="space-y-2">${cs.length ? cs.map(caseRow).join('') : '<p class="text-sm text-slate-500">No cases linked yet.' + (canEdit ? ' Use “Link a case” above.' : '') + '</p>'}</div>`;
      $('#op-back').onclick = () => { opDetailId = null; renderOperations(); };
      $$('.op-open', body).forEach((b) => b.onclick = () => { if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(b.dataset.id); });
      const eb = $('#op-edit'); if (eb) eb.onclick = () => openOperationModal(op);
      const db = $('#op-del'); if (db) db.onclick = async () => {
        if (!(await uiConfirm('Delete operation “' + (op.name || '') + '”? Cases stay, but are unlinked from it.', { confirmText: 'Delete operation' }))) return;
        const res = await DB().remove('operations', op.id);
        if (res && res.error) { toast('Delete failed: ' + res.error.message, 'danger'); return; }
        toast('Operation deleted', 'warn');
        opsCasesCache.forEach((c) => { if (c.operation_id === op.id) c.operation_id = null; });
        operationsCache = operationsCache.filter((o) => o.id !== op.id);
        opDetailId = null; renderOperations();
      };
      const linkBtn = $('#op-link'); if (linkBtn) linkBtn.onclick = async () => {
        const sel = $('#op-link-sel'), caseId = sel.value; if (!caseId) { toast('Pick a case to link.', 'warn'); return; }
        const res = await DB().update('cases', caseId, { operation_id: id });
        if (res && res.error) { toast('Link failed: ' + res.error.message, 'danger'); return; }
        const c = opsCasesCache.find((x) => x.id === caseId); if (c) c.operation_id = id;
        toast('Case linked', 'success'); renderOperations();
      };
      $$('.op-unlink', body).forEach((b) => b.onclick = async () => {
        const res = await DB().update('cases', b.dataset.id, { operation_id: null });
        if (res && res.error) { toast('Unlink failed: ' + res.error.message, 'danger'); return; }
        const c = opsCasesCache.find((x) => x.id === b.dataset.id); if (c) c.operation_id = null;
        toast('Case unlinked', 'info'); renderOperations();
      });
    }

    function openOperationModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const o = record || {};
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Operation</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(o.name || '')}" placeholder="e.g. Operation Green Sweep — 73rd Saints" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label><select data-k="status" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="active"${(o.status || 'active') === 'active' ? ' selected' : ''}>active</option><option value="closed"${o.status === 'closed' ? ' selected' : ''}>closed</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Description</label><textarea data-k="description" rows="4" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Scope, objective, participating bureaus…">${escapeHTML(o.description || '')}</textarea></div>
        </div>
        <div class="modal-actions"><button id="op-save" class="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create operation'}</button></div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#op-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Give the operation a name.', 'warn'); return; }
        const res = record && record.id ? await DB().update('operations', record.id, payload) : await DB().insert('operations', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Operation updated' : 'Operation created', 'success');
        await ensureOperations(); renderOperations();
      };
      openModal(node);
    }

    // Route hook is resolved via window[...] by the router in core.js.
    window.onEnterOperations = onEnterOperations;

/* ballistics.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 7. BALLISTICS ============================================================ */
    let benchType = Store.get('benchType', 'street');
    function renderBenchTabs() {
      $$('.bench-tab').forEach((b) => {
        const on = b.dataset.bench === benchType;
        b.className = `bench-tab rounded-md px-4 py-2 text-xs font-semibold transition ${on ? 'bg-gradient-to-r from-badge-500 to-blue-700 text-white shadow-glow' : 'text-slate-300 hover:text-white'}`;
      });
    }
    function onEnterBallistics() { if (dbReady()) { fetchBenches(); fetchFootprints(); } else { renderBenches(); renderBallisticLog(); } }
    async function fetchBenches() { if (!dbReady()) { renderBenches(); return; } try { BENCHES_CACHE = await DB().list('ballistics_benches', { order: 'name', ascending: true }); renderBenches(); } catch (e) { $('#bench-list').innerHTML = '<p class="text-sm text-rose-300">Load error: ' + escapeHTML(e.message || String(e)) + '</p>'; } }
    async function fetchFootprints() { if (!dbReady()) { renderBallisticLog(); return; } try { FOOTPRINTS = await DB().list('ballistic_footprints', { order: 'created_at', ascending: false }); renderBallisticLog(); } catch (e) {} }
    function renderBenches() {
      renderBenchTabs();
      const wrap = $('#bench-list'); if (!wrap) return;
      const canEdit = DB() && DB().canEdit();
      const addBtn = $('#bench-new'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Live bench records require sign-in.</p>'; return; }
      const list = BENCHES_CACHE.filter((b) => b.bench_type === benchType);
      if (!list.length) { wrap.innerHTML = `<p class="text-sm text-slate-500">No ${benchType === 'street' ? 'street-gang' : 'organized-crime'} benches logged.${canEdit ? ' Use “+ Bench”.' : ''}</p>`; return; }
      wrap.innerHTML = '';
      list.forEach((b) => {
        const tierTint = /high/i.test(b.tier || '') ? 'border-rose-500/30 bg-rose-500/5 text-rose-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-300';
        const heatTint = b.heat === 'Active' ? 'bg-rose-500/10 text-rose-300' : b.heat === 'Raid Pending' ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300';
        const caseNo = caseNumById(b.case_id);
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-6' });
        card.innerHTML = `
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h4 class="text-base font-semibold text-white">${escapeHTML(b.name)}</h4><p class="mt-1 text-xs text-slate-400">Linked investigation: ${caseNo ? `<span class="font-mono text-blue-300">${escapeHTML(caseNo)}</span>` : '<span class="text-slate-500">none</span>'}</p></div>
            <div class="flex items-center gap-2">${b.tier ? `<span class="rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${tierTint}">${escapeHTML(b.tier)}-Tier</span>` : ''}${b.heat ? `<span class="rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase ${heatTint}">${escapeHTML(b.heat)}</span>` : ''}${canEdit ? '<button class="b-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}</div>
          </div>
          <div class="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div><p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Manufacturing Outputs</p><div class="flex flex-wrap gap-2">${(b.outputs || []).map((o) => `<span class="rounded-full border border-white/10 bg-ink-850 px-3 py-1 text-xs text-slate-200">${escapeHTML(o)}</span>`).join('') || '<span class="text-xs text-slate-500">—</span>'}</div></div>
            <div><p class="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Component Tracing</p><div class="space-y-1.5">${(b.components || []).map((c) => `<div class="flex items-center gap-2 text-xs text-slate-300"><span class="h-1.5 w-1.5 rounded-full bg-blue-400"></span>${escapeHTML(c)}</div>`).join('') || '<span class="text-xs text-slate-500">—</span>'}</div></div>
          </div>`;
        const eb = card.querySelector('.b-edit'); if (eb) eb.addEventListener('click', () => openBenchModal(b));
        wrap.appendChild(card);
      });
    }
    function renderBallisticLog() {
      const wrap = $('#ballistic-log'); if (!wrap) return;
      const canEdit = DB() && DB().canEdit();
      const addBtn = $('#footprint-new'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { wrap.innerHTML = '<p class="text-sm text-slate-500">Sign in to view footprints.</p>'; return; }
      if (!FOOTPRINTS.length) { wrap.innerHTML = `<p class="text-sm text-slate-500">No footprints logged.${canEdit ? ' Use “+ Footprint”.' : ''}</p>`; return; }
      wrap.innerHTML = '';
      FOOTPRINTS.forEach((l) => {
        const gang = GANGS.find((g) => g.id === l.gang_id);
        const caseNo = caseNumById(l.case_id);
        const card = el('div', { class: 'rounded-xl border border-white/10 bg-ink-900 p-3' });
        card.innerHTML = `<div class="flex items-start justify-between gap-2"><p class="font-mono text-xs text-violet-300">${escapeHTML(l.signature)}</p>${canEdit ? '<button class="f-edit text-[11px] text-slate-400 hover:text-white">edit</button>' : ''}</div><p class="mt-1 text-sm text-white">${escapeHTML(l.weapon || '—')}</p><div class="mt-1.5 flex items-center justify-between text-[11px]"><span class="text-slate-400">${gang ? escapeHTML(gang.name) : '—'}</span><span class="font-mono text-blue-300">${caseNo ? escapeHTML(caseNo) : ''}</span></div>`;
        const eb = card.querySelector('.f-edit'); if (eb) eb.addEventListener('click', () => openFootprintModal(l));
        wrap.appendChild(card);
      });
    }
    function openBenchModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const b = record || {};
      const node = el('div', { class: 'p-6' });
      const caseOpts = ['<option value="">— none —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === b.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Weapon Bench</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(b.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Bench Type</label><select data-k="bench_type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="street" ${b.bench_type === 'street' ? 'selected' : ''}>Street Gang</option><option value="organized" ${b.bench_type === 'organized' ? 'selected' : ''}>Organized Crime</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Tier</label><input data-k="tier" list="tier-list" value="${escapeHTML(b.tier || (record ? '' : 'Low'))}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /><datalist id="tier-list"><option value="Low"><option value="High"></datalist></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Heat</label><input data-k="heat" list="heat-list" value="${escapeHTML(b.heat || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /><datalist id="heat-list"><option value="Active"><option value="Surveillance"><option value="Raid Pending"></datalist></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Outputs <span class="text-slate-500">(one per line)</span></label><textarea data-arr="outputs" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML((b.outputs || []).join('\n'))}</textarea></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Components <span class="text-slate-500">(one per line)</span></label><textarea data-arr="components" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML((b.components || []).join('\n'))}</textarea></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="b-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create bench'}</button>
          ${record && DB().canDelete() ? '<button id="b-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#b-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        $$('[data-arr]', node).forEach((f) => payload[f.dataset.arr] = f.value.split('\n').map((s) => s.trim()).filter(Boolean));
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        if (!payload.case_id) payload.case_id = null;
        const res = record && record.id ? await DB().update('ballistics_benches', record.id, payload) : await DB().insert('ballistics_benches', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Bench updated' : 'Bench created', 'success'); fetchBenches();
      };
      const bd = node.querySelector('#b-del'); if (bd) bd.onclick = async () => { if (!confirm('Delete bench?')) return; const r = await DB().remove('ballistics_benches', record.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Bench deleted', 'warn'); fetchBenches(); };
      openModal(node, { wide: true });
    }
    function openFootprintModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const l = record || {};
      const node = el('div', { class: 'p-6' });
      const gangOpts = ['<option value="">— none —</option>'].concat(GANGS.map((g) => `<option value="${g.id}" ${g.id === l.gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      const caseOpts = ['<option value="">— none —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === l.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Ballistic Footprint</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Signature *</label><input data-k="signature" value="${escapeHTML(l.signature || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" placeholder="BLSTC-77-A · 9mm striations" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Weapon</label><input data-k="weapon" value="${escapeHTML(l.weapon || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Gang</label><select data-k="gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          </div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="f-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save' : 'Log footprint'}</button>
          ${record && DB().canDelete() ? '<button id="f-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#f-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.signature) { toast('Signature is required.', 'warn'); return; }
        if (!payload.gang_id) payload.gang_id = null; if (!payload.case_id) payload.case_id = null;
        const res = record && record.id ? await DB().update('ballistic_footprints', record.id, payload) : await DB().insert('ballistic_footprints', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Footprint updated' : 'Footprint logged', 'success'); fetchFootprints();
      };
      const fd = node.querySelector('#f-del'); if (fd) fd.onclick = async () => { if (!confirm('Delete footprint?')) return; const r = await DB().remove('ballistic_footprints', record.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Footprint deleted', 'warn'); fetchFootprints(); };
      openModal(node);
    }


/* narcotics.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 6. NARCOTICS ============================================================ */
    const densTint = (d) => d==='High' ? 'text-rose-300 bg-rose-500/10' : d==='Medium' ? 'text-amber-300 bg-amber-500/10' : 'text-emerald-300 bg-emerald-500/10';
    function renderDrugs() {
      const wrap = $('#drug-registry'); if (!wrap) return; wrap.innerHTML = '';
      const canEdit = DB() && DB().canEdit();
      const addBtn = $('#narc-new'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { wrap.innerHTML = '<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">Live narcotics registry requires sign-in.</div>'; $('#narc-count').textContent = '0'; $('#narc-hotspots').textContent = '0'; return; }
      if (!DRUGS.length) { wrap.innerHTML = `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">No narcotics on file.${canEdit ? ' Use “+ New Narcotic”.' : ''}</div>`; $('#narc-count').textContent = '0'; $('#narc-hotspots').textContent = '0'; return; }
      let hot = 0;
      DRUGS.forEach((d, i) => {
        hot += d.hotspots.length;
        const det = el('details', { class:'group overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60' });
        if (i === 0) det.setAttribute('open','');
        det.innerHTML = `
          <summary class="flex flex-wrap items-center gap-4 px-6 py-4">
            <svg class="chev h-4 w-4 flex-shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            <span class="text-2xl">${esc(d.icon)}</span>
            <div class="min-w-0"><h3 class="text-base font-semibold text-white">${esc(d.name)}</h3><p class="text-xs text-slate-400">${esc(d.cls)}</p></div>
            <div class="ml-auto flex items-center gap-4 text-right">
              <div><p class="text-[10px] uppercase tracking-wider text-slate-500">Street</p><p class="font-mono text-sm font-bold text-emerald-300">${fmtUSD(d.street)}</p></div>
              <div class="hidden sm:block"><p class="text-[10px] uppercase tracking-wider text-slate-500">Popularity</p><p class="font-mono text-sm font-bold text-blue-300">${d.pop}</p></div>
            </div>
          </summary>
          <div class="drawer-body"><div><div class="grid grid-cols-1 gap-6 border-t border-white/5 px-6 py-5 lg:grid-cols-2">
            <div>
              <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Chemical Precursors — adjust purity</p>
              <div class="space-y-3" data-drug="${i}">
                ${d.precursors.map((p,pi)=>`<div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">${esc(p.n)}</span><span class="font-mono text-slate-400 prc-val" data-pi="${pi}">${p.p}%</span></div><input type="range" min="0" max="100" value="${p.p}" data-pi="${pi}" class="prc w-full" /></div>`).join('')}
              </div>
              <div class="mt-4 flex items-center justify-between rounded-lg border border-white/10 bg-ink-850 p-3"><span class="text-xs font-semibold text-slate-300">Batch Purity → Adj. Street Value</span><span class="font-mono text-sm font-bold text-emerald-300 batch-out">—</span></div>
            </div>
            <div>
              <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Pricing Matrix</p>
              <div class="space-y-3">
                <div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">Street Price</span><span class="font-mono text-emerald-300">${fmtUSD(d.street)}</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full bg-emerald-500" style="width:100%"></div></div></div>
                <div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">Wholesale</span><span class="font-mono text-blue-300">${fmtUSD(d.wholesale)}</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full bg-blue-500" style="width:${Math.round(d.wholesale/d.street*100)}%"></div></div></div>
                <div><div class="mb-1 flex justify-between text-xs"><span class="text-slate-300">Popularity Index</span><span class="font-mono text-violet-300">${d.pop}/100</span></div><div class="h-2 w-full overflow-hidden rounded-full bg-ink-800"><div class="h-full bg-violet-500" style="width:${d.pop}%"></div></div></div>
              </div>
              <p class="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Geographic Selling Hotspots</p>
              <div class="space-y-2">
                ${d.hotspots.map((h)=>`<div class="flex items-center justify-between rounded-lg border border-white/5 bg-ink-850 px-3 py-2 text-sm"><span class="text-slate-200">${esc(h.area)}</span><span class="flex items-center gap-2"><span class="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${densTint(h.d)}">${esc(h.d)}</span>${h.case?`<span class="font-mono text-[11px] text-blue-300">${esc(h.case)}</span>`:'<span class="text-[11px] text-slate-500">unlinked</span>'}</span></div>`).join('')||'<p class="text-xs text-slate-500">No hotspots logged.</p>'}
              </div>
              ${canEdit ? `<div class="mt-4 text-right"><button class="narc-edit rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10" data-id="${d.id}">Edit narcotic</button></div>` : ''}
            </div>
          </div></div></div>`;
        wrap.appendChild(det);
        const eb = det.querySelector('.narc-edit'); if (eb) eb.addEventListener('click', () => openNarcoticModal(DRUGS.find((x) => x.id === eb.dataset.id)));
        // purity sliders (what-if calc; not persisted)
        const baseStreet = d.street;
        const recompute = () => {
          const vals = $$('.prc', det).map((s) => Number(s.value));
          const avg = vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
          det.querySelector('.batch-out').textContent = `${Math.round(avg)}% · ${fmtUSD(baseStreet * avg/100)}`;
        };
        $$('.prc', det).forEach((s) => s.addEventListener('input', () => { det.querySelector(`.prc-val[data-pi="${s.dataset.pi}"]`).textContent = s.value + '%'; recompute(); }));
        recompute();
      });
      $('#narc-count').textContent = DRUGS.length;
      $('#narc-hotspots').textContent = hot;
    }

    function narcsNotice() { /* handled in renderDrugs */ }
    function onEnterNarcotics() { if (dbReady()) fetchDrugs(); else renderDrugs(); }
    async function fetchDrugs() {
      if (!dbReady()) { renderDrugs(); return; }
      try {
        const [narc, prec, hot] = await Promise.all([
          DB().list('narcotics', { order: 'name', ascending: true }),
          DB().list('narcotic_precursors', {}),
          DB().list('narcotic_hotspots', {})
        ]);
        const caseNum = (id) => { const c = casesCache.find((x) => x.id === id); return c ? c.case_number : null; };
        DRUGS = narc.map((n) => ({
          id: n.id, name: n.name, cls: n.classification || '', icon: n.icon || '💊',
          pop: n.popularity || 0, street: Number(n.street_price) || 0, wholesale: Number(n.wholesale_price) || 0,
          precursors: prec.filter((p) => p.narcotic_id === n.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((p) => ({ n: p.name, p: p.default_purity || 0 })),
          hotspots: hot.filter((h) => h.narcotic_id === n.id).map((h) => ({ area: h.area, d: cap(h.density), case: caseNum(h.case_id) })),
          hotspotsRaw: hot.filter((h) => h.narcotic_id === n.id)
        }));
        renderDrugs();
      } catch (e) { const w = $('#drug-registry'); if (w) w.innerHTML = '<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-rose-300">Could not load narcotics: ' + escapeHTML(e.message || String(e)) + '</div>'; }
    }
    function openNarcoticModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const isEdit = !!(record && record.id);
      const node = el('div', { class: 'p-6' });
      const caseOpts = (sel) => ['<option value="">— no case —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      const precRow = (p) => `<div class="prec-row grid grid-cols-12 gap-2"><input class="pn col-span-8 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white" placeholder="Precursor" value="${escapeHTML(p ? p.n : '')}" /><input type="number" class="pp col-span-3 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white" placeholder="%" value="${p ? p.p : 0}" /><button aria-label="Remove precursor" class="prx col-span-1 rounded bg-white/5 text-xs text-rose-300 hover:bg-rose-500/10">✕</button></div>`;
      const hotRow = (h) => `<div class="hot-row grid grid-cols-12 gap-2"><input class="ha col-span-5 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white" placeholder="Area" value="${escapeHTML(h ? h.area : '')}" /><select class="hd col-span-3 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white">${['low','medium','high'].map((d)=>`<option value="${d}" ${h && (h.density||'')===d?'selected':''}>${cap(d)}</option>`).join('')}</select><select class="hc col-span-3 rounded border border-white/10 bg-ink-850 px-2 py-1 text-xs text-white">${caseOpts(h ? h.case_id : '')}</select><button aria-label="Remove hotspot" class="hrx col-span-1 rounded bg-white/5 text-xs text-rose-300 hover:bg-rose-500/10">✕</button></div>`;
      const d = record || {};
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${isEdit ? 'Edit' : 'New'} Narcotic</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(d.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Icon</label><input data-k="icon" value="${escapeHTML(d.icon || '💊')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="sm:col-span-3"><label class="mb-1 block text-xs font-semibold text-slate-400">Classification</label><input data-k="classification" value="${escapeHTML(d.cls || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Popularity</label><input type="number" data-k="popularity" value="${d.pop || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Street $</label><input type="number" data-k="street_price" value="${d.street || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Wholesale $</label><input type="number" data-k="wholesale_price" value="${d.wholesale || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <div class="mt-4"><div class="mb-2 flex items-center justify-between"><label class="text-xs font-semibold text-slate-400">Precursors (name + default purity %)</label><button id="prec-add" class="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Precursor</button></div><div id="precs" class="space-y-2">${(d.precursors || []).map(precRow).join('')}</div></div>
        <div class="mt-4"><div class="mb-2 flex items-center justify-between"><label class="text-xs font-semibold text-slate-400">Hotspots (area · density · case)</label><button id="hot-add" class="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10">+ Hotspot</button></div><div id="hots" class="space-y-2">${(d.hotspotsRaw || []).map(hotRow).join('')}</div></div>
        <div class="mt-5 flex gap-2">
          <button id="n-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${isEdit ? 'Save changes' : 'Create narcotic'}</button>
          ${isEdit && DB().canDelete() ? '<button id="n-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      const bind = () => { $$('.prx', node).forEach((b) => b.onclick = () => b.closest('.prec-row').remove()); $$('.hrx', node).forEach((b) => b.onclick = () => b.closest('.hot-row').remove()); };
      bind();
      node.querySelector('#prec-add').onclick = () => { node.querySelector('#precs').insertAdjacentHTML('beforeend', precRow(null)); bind(); };
      node.querySelector('#hot-add').onclick = () => { node.querySelector('#hots').insertAdjacentHTML('beforeend', hotRow(null)); bind(); };
      node.querySelector('#n-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.type === 'number' ? (Number(f.value) || 0) : f.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        let nid = record && record.id;
        let res = nid ? await DB().update('narcotics', nid, payload) : await DB().insert('narcotics', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        if (!nid) nid = res.data && res.data[0] && res.data[0].id;
        if (nid) {
          // replace children
          await DB().from('narcotic_precursors').delete().eq('narcotic_id', nid);
          await DB().from('narcotic_hotspots').delete().eq('narcotic_id', nid);
          const precs = $$('.prec-row', node).map((r, i) => ({ narcotic_id: nid, name: $('.pn', r).value.trim(), default_purity: Number($('.pp', r).value) || 0, sort_order: i })).filter((p) => p.name);
          const hots = $$('.hot-row', node).map((r) => ({ narcotic_id: nid, area: $('.ha', r).value.trim(), density: $('.hd', r).value, case_id: $('.hc', r).value || null })).filter((h) => h.area);
          if (precs.length) await DB().from('narcotic_precursors').insert(precs);
          if (hots.length) await DB().from('narcotic_hotspots').insert(hots);
        }
        closeModal(); toast(isEdit ? 'Narcotic updated' : 'Narcotic created', 'success'); fetchDrugs();
      };
      const nd = node.querySelector('#n-del'); if (nd) nd.onclick = async () => { if (!(await uiConfirm('Delete ' + record.name + '?', { confirmText: 'Delete' }))) return; const r = await DB().remove('narcotics', record.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; } closeModal(); toast('Narcotic deleted', 'warn'); fetchDrugs(); };
      openModal(node, { wide: true });
    }


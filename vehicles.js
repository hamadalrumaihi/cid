/* vehicles.js — Wave 4 intelligence additions, sharing the global lexical scope
   with the other app *.js files (load order in index.html; see AGENTS.md).
   Three tools live here:
   1. Vehicle / plate registry — plates as first-class intel records.
   2. Cross-reference engine — flags phones, registry plates and persons that
      surface in two or more cases' reports (all inputs are RLS-scoped, so the
      alerts only ever reflect cases the viewer can access).
   3. BOLO board — persons flagged bolo=true, with warrant context. */
"use strict";

    let VEHICLES = [];
    let vehicleFilter = '', boloFilter = '';
    const vhOwnerName = (id) => { const p = (typeof PERSONS !== 'undefined' ? PERSONS : []).find((x) => x.id === id); return p ? p.name : null; };
    const vhGangName = (id) => { const g = (typeof GANGS !== 'undefined' ? GANGS : []).find((x) => x.id === id); return g ? g.name : null; };
    function vehiclesNotice(m) { const g = $('#vehicle-grid'); if (g) g.innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function onEnterVehicles() {
      if (!dbReady()) { vehiclesNotice('Live vehicle records require sign-in.'); const cb = $('#crossref-box'); if (cb) cb.innerHTML = ''; return; }
      fetchVehicles().then(() => renderCrossref());
    }
    async function fetchVehicles() {
      if (!dbReady()) return;
      try { VEHICLES = await DB().list('vehicles', { order: 'updated_at', ascending: false }); renderVehicles(); }
      catch (e) { vehiclesNotice('Could not load vehicles: ' + escapeHTML(e.message || String(e))); }
    }
    function renderVehicles() {
      const grid = $('#vehicle-grid'); if (!grid) return;
      const canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const nb = $('#vehicle-new'); if (nb) nb.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { vehiclesNotice('Live vehicle records require sign-in.'); return; }
      const fi = $('#vehicle-filter'); if (fi) fi.classList.toggle('hidden', !VEHICLES.length);
      if (!VEHICLES.length) { vehiclesNotice('NO VEHICLES ON FILE // REGISTRY EMPTY.' + (canEdit ? ' Use “+ New Vehicle” to log the first plate.' : '')); return; }
      const q = vehicleFilter.trim().toLowerCase();
      const rows = !q ? VEHICLES : VEHICLES.filter((v) => [v.plate, v.model, v.color, v.notes, vhOwnerName(v.owner_id), vhGangName(v.gang_id)].some((s) => (s || '').toLowerCase().includes(q)));
      if (!rows.length) { vehiclesNotice('No vehicles match “' + escapeHTML(vehicleFilter.trim()) + '”.'); return; }
      grid.innerHTML = '';
      rows.forEach((v) => {
        const owner = vhOwnerName(v.owner_id), gang = vhGangName(v.gang_id);
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-5' });
        card.innerHTML = `
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="inline-block rounded-md border border-white/15 bg-ink-800 px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-white">${escapeHTML(v.plate)}</p>
              <p class="mt-1.5 text-sm font-semibold text-slate-200">${escapeHTML(v.model || 'Unknown model')}${v.color ? ` <span class="text-slate-500">· ${escapeHTML(v.color)}</span>` : ''}</p>
            </div>
            <div class="flex flex-shrink-0 items-center gap-2">
              ${(typeof watchBtnHtml === 'function' && DB() && DB().me) ? watchBtnHtml('vehicle', v.id, v.plate, { compact: true }) : ''}
              ${canEdit ? '<button class="vh-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
              ${canDel ? '<button class="vh-del rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10" aria-label="Delete vehicle">✕</button>' : ''}
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
            ${owner ? `<span class="rounded-md bg-blue-500/10 px-2 py-1 text-blue-300">👤 ${escapeHTML(owner)}</span>` : '<span class="rounded-md bg-white/5 px-2 py-1 text-slate-500">owner unknown</span>'}
            ${gang ? `<span class="rounded-md bg-violet-500/10 px-2 py-1 text-violet-300">🚩 ${escapeHTML(gang)}</span>` : ''}
          </div>
          ${v.notes ? `<p class="mt-3 text-xs text-slate-400">${escapeHTML(v.notes)}</p>` : ''}`;
        const eb = card.querySelector('.vh-edit'); if (eb) eb.onclick = () => openVehicleModal(v);
        const db = card.querySelector('.vh-del'); if (db) db.onclick = async () => {
          if (!(await uiConfirm(`Delete vehicle ${v.plate}? Restorable via Undo.`, { confirmText: 'Delete' }))) return;
          await deleteWithUndo('vehicles', v, { label: 'Vehicle ' + v.plate, noConfirm: true, after: fetchVehicles });
        };
        grid.appendChild(card);
      });
    }
    function openVehicleModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const v = record || {};
      const persons = (typeof PERSONS !== 'undefined' ? PERSONS : []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      const gangsList = (typeof GANGS !== 'undefined' ? GANGS : []);
      // Preserve existing FK links even if PERSONS/GANGS haven't loaded / failed —
      // otherwise the select falls back to blank and an unrelated save nulls the link.
      const ownerKnown = v.owner_id && persons.some((p) => p.id === v.owner_id);
      const gangKnown = v.gang_id && gangsList.some((g) => g.id === v.gang_id);
      const ownerOpts = ['<option value="">— unknown —</option>']
        .concat(v.owner_id && !ownerKnown ? [`<option value="${escapeHTML(v.owner_id)}" selected>(current owner — loading…)</option>`] : [])
        .concat(persons.map((p) => `<option value="${p.id}" ${p.id === v.owner_id ? 'selected' : ''}>${escapeHTML(p.name)}</option>`)).join('');
      const gangOpts = ['<option value="">— none —</option>']
        .concat(v.gang_id && !gangKnown ? [`<option value="${escapeHTML(v.gang_id)}" selected>(current gang — loading…)</option>`] : [])
        .concat(gangsList.map((g) => `<option value="${g.id}" ${g.id === v.gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Vehicle</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Plate *</label><input data-k="plate" value="${escapeHTML(v.plate || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm uppercase tracking-widest text-white outline-none focus:border-badge-500" /></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Model</label><input data-k="model" value="${escapeHTML(v.model || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Color</label><input data-k="color" value="${escapeHTML(v.color || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Registered Owner</label><select data-k="owner_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${ownerOpts}</select></div>
          </div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Gang Association</label><select data-k="gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="2" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(v.notes || '')}</textarea></div>
        </div>
        <div class="mt-5"><button id="vh-save" class="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Register vehicle'}</button></div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#vh-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.plate) { toast('Plate is required.', 'warn'); return; }
        payload.plate = payload.plate.toUpperCase();
        if (!payload.owner_id) payload.owner_id = null;
        if (!payload.gang_id) payload.gang_id = null;
        const res = record && record.id ? await DB().update('vehicles', record.id, payload) : await DB().insert('vehicles', payload);
        if (res.error) { toast(/duplicate|unique/i.test(res.error.message) ? 'That plate is already registered.' : 'Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Vehicle updated' : 'Vehicle registered', 'success'); fetchVehicles();
      };
      openModal(node);
    }

    /* ---- Cross-reference engine -------------------------------------------
       Scans every report the viewer can see (RLS-scoped) and raises an alert
       when the same phone number, registered plate, or person appears in two
       or more different cases. */
    async function renderCrossref() {
      const box = $('#crossref-box'); if (!box) return;
      if (!dbReady()) { box.innerHTML = ''; return; }
      box.innerHTML = '<p class="text-sm text-slate-500">Scanning for cross-case matches…</p>';
      let reports = [], links = [], scanFailed = false;
      try { reports = await DB().list('reports', {}); } catch (e) { reports = []; scanFailed = true; }
      try { links = await DB().list('case_intel_links', {}); } catch (e) { links = []; scanFailed = true; }
      // A failed scan must not masquerade as an authoritative "no matches" — that's
      // a dangerous false negative for a deconfliction tool.
      if (scanFailed) { box.innerHTML = '<div class="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-amber-200">⚠ Could not scan for cross-case matches (connection issue). <button class="cx-retry underline">Retry</button></div>'; const rb = box.querySelector('.cx-retry'); if (rb) rb.onclick = () => renderCrossref(); return; }
      const caseNum = (id) => (typeof caseNumById === 'function' && caseNumById(id)) || 'a case';
      // Flatten each case's report fields to one searchable text blob.
      const textByCase = {};
      reports.forEach((r) => { if (r.case_id) textByCase[r.case_id] = (textByCase[r.case_id] || '') + ' ' + JSON.stringify(r.fields || {}); });
      const caseIds = Object.keys(textByCase);
      const alerts = [];
      // Phones: (###) ###-#### appearing in 2+ cases.
      const phoneCases = {};
      caseIds.forEach((cid) => {
        const m = textByCase[cid].match(/\(\d{3}\)\s?\d{3}[- ]?\d{4}/g) || [];
        new Set(m).forEach((ph) => (phoneCases[ph] = phoneCases[ph] || new Set()).add(cid));
      });
      Object.keys(phoneCases).forEach((ph) => { const s = [...phoneCases[ph]]; if (s.length >= 2) alerts.push({ icon: '📞', label: ph, kind: 'Phone number', cases: s }); });
      // Registered plates mentioned in 2+ cases' reports.
      VEHICLES.forEach((v) => {
        if (!v.plate || v.plate.length < 5) return;
        const re = new RegExp('\\b' + v.plate.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        const hits = caseIds.filter((cid) => re.test(textByCase[cid].toUpperCase()));
        if (hits.length >= 2) alerts.push({ icon: '🚗', label: v.plate + (vhOwnerName(v.owner_id) ? ' — ' + vhOwnerName(v.owner_id) : ''), kind: 'Registered plate', cases: hits });
      });
      // Persons linked (Intel tab) to 2+ cases.
      const personCases = {};
      links.filter((l) => l.kind === 'person').forEach((l) => (personCases[l.ref_id] = personCases[l.ref_id] || new Set()).add(l.case_id));
      Object.keys(personCases).forEach((pid) => {
        const s = [...personCases[pid]]; if (s.length < 2) return;
        const p = (typeof PERSONS !== 'undefined' ? PERSONS : []).find((x) => x.id === pid);
        alerts.push({ icon: '👤', label: p ? p.name : 'Linked person', kind: 'Person in multiple cases', cases: s });
      });
      if (!alerts.length) { box.innerHTML = '<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5 text-sm text-slate-500">NO CROSS-CASE MATCHES // SCAN COMPLETE. Alerts appear here when the same phone, plate, or person surfaces in two or more cases.</div>'; return; }
      box.innerHTML = `<p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">⚡ Cross-reference alerts (${alerts.length})</p>
        <div class="space-y-2">${alerts.map((a) => `
          <div class="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <p class="text-sm font-semibold text-white">${a.icon} ${escapeHTML(a.label)} <span class="ml-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-400">${escapeHTML(a.kind)}</span></p>
            <p class="mt-1 text-xs text-slate-300">Appears in ${a.cases.length} cases: ${a.cases.map((cid) => `<span class="font-mono text-blue-300">${escapeHTML(caseNum(cid))}</span>`).join(' · ')}</p>
          </div>`).join('')}</div>`;
    }

    /* ---- BOLO board ---------------------------------------------------------
       Persons flagged bolo=true, enriched with any warrant status found on the
       viewer's accessible arrest warrants. */
    function onEnterBolo() {
      const grid = $('#bolo-grid'); if (!grid) return;
      if (!dbReady()) { grid.innerHTML = '<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">Sign in to view the BOLO board.</div>'; return; }
      const go = () => renderBolo();
      if (typeof fetchPersons === 'function') fetchPersons().then(go).catch(go); else go();
    }
    async function renderBolo() {
      const grid = $('#bolo-grid'); if (!grid) return;
      const canEdit = DB() && DB().canEdit();
      const allBolo = (typeof PERSONS !== 'undefined' ? PERSONS : []).filter((p) => p.bolo);
      const fi = $('#bolo-filter'); if (fi) fi.classList.toggle('hidden', !allBolo.length);
      if (!allBolo.length) { grid.innerHTML = '<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">NO ACTIVE BOLOS // SECTOR QUIET. Flag a person via Persons → Edit → “Active BOLO”.</div>'; return; }
      const bq = boloFilter.trim().toLowerCase();
      const people = !bq ? allBolo : allBolo.filter((p) => [p.name, p.alias, p.status, vhGangName(p.gang_id)].some((s) => (s || '').toLowerCase().includes(bq)));
      if (!people.length) { grid.innerHTML = '<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">No BOLOs match “' + escapeHTML(boloFilter.trim()) + '”.</div>'; return; }
      // Warrant context: latest warrant status per named suspect (RLS-scoped).
      let warrants = [];
      try { warrants = (await DB().list('reports', {})).filter((r) => r.template === 'arrest_warrant'); } catch (e) {}
      // Oldest → newest so the latest warrant's status wins the per-name lookup.
      warrants.sort((a, b) => new Date(a.updated_at || a.created_at || 0) - new Date(b.updated_at || b.created_at || 0));
      // Object.create(null): a suspect named e.g. "Constructor" must not collide with
      // Object.prototype members on the name-keyed lookup below.
      const wStatus = Object.create(null);
      warrants.forEach((r) => {
        const st = (r.fields && r.fields._warrant_status) || 'draft';
        const names = [];
        if (r.fields && Array.isArray(r.fields.suspects)) r.fields.suspects.forEach((s) => { if (s && s.full_name) names.push(s.full_name); });
        if (r.fields && r.fields.full_name) names.push(r.fields.full_name);
        names.forEach((n) => { wStatus[n.toLowerCase()] = st; });
      });
      const wTint = { draft: 'bg-white/5 text-slate-400', signed: 'bg-blue-500/15 text-blue-300', executed: 'bg-amber-500/15 text-amber-300', returned: 'bg-emerald-500/15 text-emerald-300' };
      grid.innerHTML = '';
      people.forEach((p) => {
        const gang = p.gang_id ? vhGangName(p.gang_id) : null;
        const ws = wStatus[(p.name || '').toLowerCase()];
        const mug = p.mugshot_url && typeof safeUrl === 'function' ? safeUrl(p.mugshot_url) : '';
        const card = el('div', { class: 'overflow-hidden rounded-2xl border border-rose-500/20 bg-ink-900/60' });
        card.innerHTML = `
          <div class="flex items-center justify-between bg-rose-500/10 px-4 py-2"><span class="text-[11px] font-bold uppercase tracking-widest text-rose-300">⚠ Be on the lookout</span>${ws ? `<span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${wTint[ws] || wTint.draft}">warrant: ${escapeHTML(ws)}</span>` : ''}</div>
          <div class="flex gap-4 p-4">
            ${mug ? `<img src="${escapeHTML(mug)}" alt="" class="h-20 w-20 flex-shrink-0 rounded-lg object-cover" />` : '<div class="grid h-20 w-20 flex-shrink-0 place-items-center rounded-lg bg-ink-800 text-3xl">👤</div>'}
            <div class="min-w-0 flex-1">
              <p class="truncate text-base font-bold text-white">${escapeHTML(p.name)}</p>
              ${p.alias ? `<p class="text-xs text-slate-400">“${escapeHTML(p.alias)}”</p>` : ''}
              <div class="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                <span class="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">${escapeHTML(p.status || 'Suspect')}</span>
                ${gang ? `<span class="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">🚩 ${escapeHTML(gang)}</span>` : ''}
                ${p.ccw ? '<span class="rounded bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-300" title="May be armed — exercise caution">ARMED RISK</span>' : ''}
                ${p.felony_count ? `<span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">${p.felony_count} felonies</span>` : ''}
              </div>
            </div>
          </div>
          <div class="flex gap-2 border-t border-white/5 px-4 py-2.5">
            <button class="bolo-profile rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10">🔎 Profile</button>
            ${canEdit ? '<button class="bolo-clear rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10">Clear BOLO</button>' : ''}
          </div>`;
        const pf = card.querySelector('.bolo-profile'); if (pf) pf.onclick = () => { if (typeof openIntelProfile === 'function') openIntelProfile('person', p.id); };
        const cl = card.querySelector('.bolo-clear'); if (cl) cl.onclick = async () => {
          if (!(await uiConfirm('Clear the BOLO on ' + (p.name || 'this person') + '?', { confirmText: 'Clear' }))) return;
          const res = await DB().update('persons', p.id, { bolo: false });
          if (res.error) { toast('Update failed: ' + res.error.message, 'danger'); return; }
          toast('BOLO cleared', 'info'); if (typeof fetchPersons === 'function') await fetchPersons(); renderBolo();
        };
        grid.appendChild(card);
      });
    }

    // Self-wiring (this file loads before app.js's DOMContentLoaded init).
    document.addEventListener('DOMContentLoaded', () => {
      const nb = $('#vehicle-new'); if (nb) nb.addEventListener('click', () => openVehicleModal(null));
      const vf = $('#vehicle-filter'); if (vf) vf.addEventListener('input', () => { vehicleFilter = vf.value; renderVehicles(); });
      // renderBolo refetches the reports table, so debounce to avoid a full download
      // per keystroke and the stale-repaint race from out-of-order responses.
      const bf = $('#bolo-filter'); if (bf) bf.addEventListener('input', (typeof debounce === 'function' ? debounce(() => { boloFilter = bf.value; renderBolo(); }, 200) : () => { boloFilter = bf.value; renderBolo(); }));
    });

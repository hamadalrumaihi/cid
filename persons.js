/* persons.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 11. V3 — SHARED STATE ============================================================ */
    const uid = (p) => p + Math.random().toString(36).slice(2, 8);
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const bureauOf = (caseId) => { const m = (caseId || '').match(/^([A-Z]+)-/) || (caseId || '').match(/\[(\w+)\]/); const b = m && Object.values(BUREAUS).find((x) => x.prefix === m[1] || x.name === m[1]); return b ? b.name : (m ? m[1] : '—'); };

    const RANKS = ['Leadership', 'Enforcer', 'Soldier', 'Associate', 'CI'];
    const PROP_TYPES = ['Stash House', 'Front Business', 'Vehicle', 'Safehouse', 'Warehouse'];
    const PLACE_TYPES = ['Drug Lab', 'Stash House', 'Dead Drop', 'Front Business', 'Chop Shop'];
    const RICO_PREDICATES = ['Drug Trafficking', 'Extortion', 'Money Laundering', 'Witness Tampering', 'Murder-for-Hire', 'Illegal Firearms Trafficking', 'Bribery', 'Obstruction of Justice', 'Kidnapping', 'Loan Sharking', 'Robbery'];

    // Gangs are now Supabase-backed; GANGS is a read cache used by gang/place/media/rico pickers.
    let GANGS = [];
    let PERSONS = [];   // Supabase-sourced cache of persons for link pickers

    let PLACES = [];   // Supabase-backed cache (see Places module)

    // Reports are now Supabase-backed (table `reports`); fetched per-case on demand.

    // RICO is now Supabase-backed (rico_cases + predicate_acts); fetched per-case on demand.

    const REPORT_TEMPLATES = [
      { id:'incident', name:'Initial Incident Report', icon:'📄', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'bureau',label:'Bureau',type:'auto'}, {key:'detective',label:'Reporting Detective',type:'auto'},
        {key:'datetime',label:'Date of Incident',type:'date'}, {key:'location',label:'Location',type:'text'},
        {key:'classification',label:'Offense Classification',type:'select',opts:['Trafficking','Weapons','Narcotics Manufacture','Homicide','Robbery','Other']},
        {key:'narrative',label:'Incident Narrative',type:'textarea'} ] },
      { id:'arrest', name:'Arrest / Booking Report', icon:'🔗', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'detective',label:'Arresting Detective',type:'auto'},
        {key:'suspect',label:'Suspect Name',type:'text'}, {key:'charges',label:'Charges',type:'textarea'},
        {key:'miranda',label:'Miranda Advised',type:'select',opts:['Yes','No','Waived']}, {key:'datetime',label:'Date of Arrest',type:'date'} ] },
      { id:'warrant', name:'Search Warrant Affidavit', icon:'📜', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'affiant',label:'Affiant',type:'auto'},
        {key:'premises',label:'Premises to be Searched',type:'text'}, {key:'probable',label:'Statement of Probable Cause',type:'textarea'},
        {key:'items',label:'Items Sought',type:'textarea'} ] },
      { id:'surveillance', name:'Surveillance Log', icon:'🛰️', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'detective',label:'Observing Detective',type:'auto'},
        {key:'target',label:'Target / Subject',type:'text'}, {key:'datetime',label:'Date',type:'date'}, {key:'observations',label:'Observations',type:'textarea'} ] },
      { id:'rico_summary', name:'RICO Predicate Summary', icon:'⚖️', sections:[
        {key:'caseId',label:'Case Number',type:'auto'}, {key:'enterprise',label:'Enterprise',type:'text'},
        {key:'pattern',label:'Pattern Summary',type:'textarea'} ] },
    ];
    const tplById = (id) => REPORT_TEMPLATES.find((t) => t.id === id);
    function autoVal(key, caseId) {
      const c = casesCache.find((x) => x.id === caseId);
      if (key === 'caseId') return c ? c.case_number : caseId;
      if (key === 'bureau') return c ? c.bureau : '—';
      if (key === 'detective' || key === 'affiant') { const me = DB() && DB().me; return me ? (me.display_name + (me.badge_number ? ' · ' + me.badge_number : '')) : 'CID Detective'; }
      if (key === 'datetime') return todayISO();
      return '';
    }

    /* ============================================================ 11A. PERSONS (Supabase) ============================================================ */
    const RANK_SUGGEST = ['Leadership', 'Lieutenant', 'Enforcer', 'Soldier', 'Associate', 'CI'];
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const threatTint = (t) => t === 'high' ? 'text-rose-300 bg-rose-500/10 border-rose-500/20' : t === 'medium' ? 'text-amber-300 bg-amber-500/10 border-amber-500/20' : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
    const gangNameById = (id) => { const g = GANGS.find((x) => x.id === id); return g ? g.name : null; };

    function personsNotice(m) { $('#persons-grid').innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function onEnterPersons() { if (dbReady()) fetchPersons(); else personsNotice('Live person records require sign-in.'); }
    async function fetchPersons() {
      if (!dbReady()) { personsNotice('Live person records require sign-in.'); return; }
      $('#persons-live').classList.remove('hidden'); $('#persons-live').classList.add('inline-flex');
      try { PERSONS = await DB().list('persons', { order: 'updated_at', ascending: false }); renderPersons(); }
      catch (e) { personsNotice('Could not load persons: ' + escapeHTML(e.message || String(e))); }
    }
    function renderPersons() {
      const grid = $('#persons-grid'); if (!grid) return;
      const q = ($('#person-search') ? $('#person-search').value : '').trim().toLowerCase();
      const items = PERSONS.filter((p) => !q || JSON.stringify(p).toLowerCase().includes(q));
      $('#person-new').classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) { personsNotice(PERSONS.length ? 'No persons match your filter.' : 'No persons on file.' + (DB() && DB().canEdit() ? ' Use “+ New Person”.' : '')); return; }
      grid.innerHTML = '';
      items.forEach((p) => {
        const flag = (p.felony_count || 0) >= 8;
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-5' });
        card.innerHTML = `
          <div class="flex items-start gap-3">
            ${p.mugshot_url ? `<img src="${escapeHTML(p.mugshot_url)}" class="h-14 w-14 flex-shrink-0 rounded-lg object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="hidden h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-xl">👤</div>` : `<div class="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-xl">👤</div>`}
            <div class="min-w-0 flex-1"><p class="truncate font-semibold text-white">${escapeHTML(p.name)}${flag ? ' <span title="≥8 violent felonies">🚨</span>' : ''}</p><p class="text-xs text-slate-400">${p.alias ? '“' + escapeHTML(p.alias) + '” · ' : ''}${escapeHTML(p.status || '')}</p>
              <p class="mt-1 text-[11px] text-slate-500">${p.gang_id ? '🚩 ' + escapeHTML(gangNameById(p.gang_id) || 'Gang') + ' · ' : ''}CCW ${p.ccw ? 'Yes' : 'No'} · VCH ${p.vch || 0} · Felonies ${p.felony_count || 0}</p></div>
            ${DB() && DB().canEdit() ? '<button class="p-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
          </div>
          ${p.notes ? `<p class="mt-3 line-clamp-2 text-xs text-slate-400">${escapeHTML(p.notes)}</p>` : ''}`;
        const eb = card.querySelector('.p-edit'); if (eb) eb.onclick = () => openPersonModal(p);
        grid.appendChild(card);
      });
    }
    function openPersonModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const p = record || {};
      const node = el('div', { class: 'p-6' });
      const gangOpts = ['<option value="">— no gang —</option>'].concat(GANGS.map((g) => `<option value="${g.id}" ${g.id === p.gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Person</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(p.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Alias</label><input data-k="alias" value="${escapeHTML(p.alias || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Gang</label><select data-k="gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label><input data-k="status" value="${escapeHTML(p.status || 'Person of Interest')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">CCW</label><select data-k="ccw" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="false" ${!p.ccw ? 'selected' : ''}>No</option><option value="true" ${p.ccw ? 'selected' : ''}>Yes</option></select></div>
          <div class="grid grid-cols-2 gap-3"><div><label class="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input type="number" data-k="vch" value="${p.vch || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div><div><label class="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input type="number" data-k="felony_count" value="${p.felony_count || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input data-k="mugshot_url" value="${escapeHTML(p.mugshot_url || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(p.notes || '')}</textarea></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="p-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create person'}</button>
          ${record && DB().canDelete() ? '<button id="p-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#p-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        payload.ccw = payload.ccw === 'true'; payload.vch = Number(payload.vch) || 0; payload.felony_count = Number(payload.felony_count) || 0;
        if (!payload.gang_id) payload.gang_id = null;
        const res = record && record.id ? await DB().update('persons', record.id, payload) : await DB().insert('persons', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Person updated' : 'Person created', 'success'); fetchPersons();
      };
      const pd = node.querySelector('#p-del'); if (pd) pd.onclick = async () => {
        if (!confirm('Delete person “' + p.name + '”?')) return;
        const r = await DB().remove('persons', p.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; }
        closeModal(); toast('Person deleted', 'warn'); fetchPersons();
      };
      openModal(node, { wide: true });
    }


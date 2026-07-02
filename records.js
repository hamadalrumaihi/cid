/* records.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 12. LIVE CID RECORDS (Supabase) ============================================================ */
    /* Reconciled (Wave 0): records now ride the MAIN Supabase client (window.CIDDB
       via DB()) and the app's single sign-in, instead of a separate client +
       Discord/email auth. cid_records is locked behind active-member RLS — see
       supabase/migrations/*_cid_records_lock.sql (applied together with this code). */
    const REC_FIELDS = [
      { key:'name', label:'Name', req:true }, { key:'callsign', label:'Callsign' },
      { key:'case_number', label:'Case Number' }, { key:'bureau', label:'Bureau', type:'select', opts:['','LSPD','BCSO','SAHP','JTF'] },
      { key:'gang', label:'Gang / Affiliation' }, { key:'status', label:'Status', type:'select', opts:['Open','Cold','Closed','Wanted'] },
      { key:'charges', label:'Charges', type:'textarea' }, { key:'officer', label:'Assigned Officer' },
      { key:'last_seen', label:'Last Seen' }, { key:'mugshot_url', label:'Mugshot URL' },
      { key:'notes', label:'Notes', type:'textarea' },
    ];
    let recCache = [];       // last fetched records
    let recChannel = null;

    function statusTintRec(s) {
      return s === 'Wanted' ? 'bg-rose-500/15 text-rose-300' : s === 'Open' ? 'bg-blue-500/15 text-blue-300'
           : s === 'Cold' ? 'bg-slate-500/20 text-slate-300' : 'bg-emerald-500/15 text-emerald-300';
    }

    function initRecords() {
      // Wire the static controls regardless of config so the tab never looks dead.
      $('#rec-refresh').addEventListener('click', fetchRecords);
      $('#rec-new').addEventListener('click', () => openRecordModal(null));
      $('#rec-search').addEventListener('input', renderRecords);

      if (!dbReady()) {
        $('#rec-notice').classList.remove('hidden');
        $('#rec-notice').innerHTML = window.supabase
          ? '⚙️ Live records are not configured yet. Add your Supabase <b>anon/publishable key</b> in the <code>window.CID_SUPABASE</code> block, then reload.'
          : '⚠️ The Supabase client library failed to load (offline?). Live records are unavailable; the rest of the portal works normally.';
        renderAuthBar();
        return;
      }

      renderAuthBar();
      // Read/write require an active, signed-in member (RLS-enforced). Fetch once a
      // session exists and refetch on any auth change, mirroring the app sign-in.
      DB().getSession().then((s) => { if (s) fetchRecords(); else renderRecords(); });
      DB().onAuth((s) => { renderAuthBar(); if (s) fetchRecords(); else { recCache = []; renderRecords(); } });
      // Raw auth events fire before auth.js populates DB().me (async profile fetch),
      // so the first renderAuthBar() above runs with me === null and hides the create
      // UI. Re-render once the profile has actually loaded (chain the shared hook).
      if (window.CIDApp) { const prev = window.CIDApp.onAuthed; window.CIDApp.onAuthed = function (p, s) { if (typeof prev === 'function') prev(p, s); renderAuthBar(); renderRecords(); }; }

      // Realtime: re-fetch on any change so all open clients stay in sync.
      if (DB().client) {
        recChannel = DB().client.channel('cid_records_live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'cid_records' }, fetchRecords)
          .subscribe((st) => { $('#rec-live-dot').classList.toggle('hidden', st !== 'SUBSCRIBED'); $('#rec-live-dot').classList.toggle('inline-flex', st === 'SUBSCRIBED'); });
      }
    }

    function renderAuthBar() {
      const bar = $('#rec-auth'); if (!bar) return;
      if (!dbReady()) { bar.innerHTML = '<span class="text-xs text-slate-500">offline / unconfigured</span>'; return; }
      const me = DB().me;
      if (me) {
        bar.innerHTML = `<span class="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">👤 ${esc(me.display_name || 'Signed in')}</span>`;
        $('#rec-new').classList.toggle('hidden', !DB().canEdit());
      } else {
        bar.innerHTML = '<span class="text-xs text-slate-500">Sign in to the portal to view and manage records.</span>';
        $('#rec-new').classList.add('hidden');
      }
    }

    async function fetchRecords() {
      if (!dbReady()) return;
      const { data, error } = await DB().from('cid_records').select('*').order('updated_at', { ascending:false });
      if (error) { $('#rec-notice').classList.remove('hidden'); $('#rec-notice').innerHTML = '⚠️ Could not load records: ' + esc(error.message); return; }
      $('#rec-notice').classList.add('hidden');
      recCache = data || [];
      renderRecords();
    }

    function renderRecords() {
      const grid = $('#rec-grid'); if (!grid) return;
      if (!dbReady()) { grid.innerHTML = ''; return; }
      const q = ($('#rec-search') ? $('#rec-search').value : '').trim().toLowerCase();
      const canEdit = !!(DB() && DB().canEdit());
      const items = recCache.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q));
      if (!items.length) { grid.innerHTML = `<p class="text-sm text-slate-500">${recCache.length ? 'No records match your filter.' : 'No records yet.' + (canEdit ? ' Use “+ New Record”.' : ' Sign in as an active member to add the first one.')}</p>`; return; }
      grid.innerHTML = '';
      items.forEach((r) => {
        const card = el('div', { class:'overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60' });
        card.innerHTML = `
          <div class="flex gap-4 p-5">
            ${r.mugshot_url ? `<img src="${esc(r.mugshot_url)}" alt="" class="h-16 w-16 flex-shrink-0 rounded-lg object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="hidden h-16 w-16 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-2xl">👤</div>` : `<div class="grid h-16 w-16 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-2xl">👤</div>`}
            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0"><p class="truncate font-semibold text-white">${esc(r.name)}</p><p class="text-xs text-slate-400">${esc(r.callsign || '—')}${r.bureau ? ' · ' + esc(r.bureau) : ''}</p></div>
                <span class="flex-shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTintRec(r.status)}">${esc(r.status || '—')}</span>
              </div>
              ${r.case_number ? `<p class="mt-1 font-mono text-[11px] text-blue-300">${esc(r.case_number)}</p>` : ''}
              ${r.gang ? `<p class="mt-1 text-xs text-violet-300">🚩 ${esc(r.gang)}</p>` : ''}
              ${r.charges ? `<p class="mt-2 line-clamp-3 text-xs text-slate-300">${esc(r.charges)}</p>` : ''}
            </div>
          </div>
          <div class="flex items-center justify-between border-t border-white/5 px-5 py-2.5 text-[11px] text-slate-500">
            <span>${r.officer ? esc(r.officer) : 'Unassigned'}${r.last_seen ? ' · last seen ' + esc(r.last_seen) : ''}</span>
            ${canEdit ? `<button class="rec-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>` : ''}
          </div>`;
        const eb = card.querySelector('.rec-edit'); if (eb) eb.onclick = () => openRecordModal(r);
        grid.appendChild(card);
      });
    }

    function openRecordModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign in as an active member to add or edit records.', 'warn'); return; }
      const r = record || {};
      const node = el('div', { class:'p-6' });
      const field = (f) => {
        const v = r[f.key] != null ? r[f.key] : (f.key === 'status' ? 'Open' : '');
        const req = f.req ? ' <span class="text-rose-400" aria-hidden="true">*</span>' : '';
        if (f.type === 'textarea') return `<div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">${f.label}${req}</label><textarea data-k="${f.key}" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${esc(v)}</textarea></div>`;
        if (f.type === 'select') return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${f.label}${req}</label><select data-k="${f.key}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${f.opts.map((o)=>`<option ${o===v?'selected':''}>${o}</option>`).join('')}</select></div>`;
        return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">${f.label}${req}</label><input data-k="${f.key}" value="${esc(v)}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>`;
      };
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Record</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">${REC_FIELDS.map(field).join('')}</div>
        <button id="rec-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create record'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#rec-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((el2) => payload[el2.dataset.k] = el2.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        let res;
        if (record && record.id) res = await DB().update('cid_records', record.id, payload);
        else { payload.created_by = DB().me && DB().me.id; res = await DB().insert('cid_records', payload); }
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        // RLS lets only the record's creator (or command) UPDATE. A blocked update
        // returns zero rows with no error — surface that instead of a false success.
        if (record && record.id && res.data && res.data.length === 0) { toast('You can only edit records you created.', 'warn'); return; }
        closeModal(); toast(record ? 'Record updated' : 'Record created', 'success');
        fetchRecords(); // realtime will also fire, but refetch guarantees immediate update
      };
      openModal(node, { wide: true });
    }

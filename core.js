/* core.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";


    /* ============================================================ 1. DATA MODELS ============================================================ */

    const BUREAUS = {
      LSB: { name: 'Los Santos Bureau', prefix: 'LSB', dept: 'LSPD' },
      BCB: { name: 'Blaine County Bureau', prefix: 'BCB', dept: 'BCSO' },
      SAB: { name: 'State Bureau', prefix: 'SAB', dept: 'SAHP' },
    };
    // Case numbers are typed manually by the detective (format BUREAU-NUMBER,
    // e.g. SAB-900023), validated + uniqueness-enforced at the UI and DB. No
    // auto-generation (removed in the 2026-06-17 patch).
    // Map a reporting department to its bureau key / ticket rename prefix
    const DEPT_ROUTING = {
      LSPD: { bureau: 'LSB', rename: 'losangeles' },
      BCSO: { bureau: 'BCB', rename: 'blaine' },
      SAHP: { bureau: 'SAB', rename: 'state' },
    };

    // Raid compensation brackets (the "given" percentage), then sub-split
    const BRACKETS = [
      { min: 1000000,  max: 2499999,  pct: 60, label: '$1.00M – $2.49M' },
      { min: 2500000,  max: 7499999,  pct: 50, label: '$2.50M – $7.49M' },
      { min: 7500000,  max: 14999999, pct: 40, label: '$7.50M – $14.99M' },
      { min: 15000000, max: 24999999, pct: 30, label: '$15.0M – $24.99M' },
      { min: 25000000, max: Infinity, pct: 20, label: '$25.0M +' },
    ];
    const COMP_SPLIT = { 'Primary Detective': 0.5, 'Supporting Units': 0.3, 'Confidential Informants': 0.2 };

    /* ---- Narcotics registry ---- */
    // Narcotics are now Supabase-backed; DRUGS is a normalized read cache (see fetchDrugs).
    let DRUGS = [];

    /* ---- Weapon benches ---- */
    // Ballistics now Supabase-backed; caches populated by fetchBenches/fetchFootprints.
    let BENCHES_CACHE = [];
    let FOOTPRINTS = [];

    /* ---- Personnel ---- */
    // Personnel/media/commendations are Supabase-backed caches (see fetch* in modules).
    let COMMENDATIONS = [];
    let MEDIA = [];
    let mediaFilter = 'all';

    /* ---- M.O. detector dictionary (config) — matching runs against live mo_profiles ---- */
    const MO_DICT = {
      names:    ['tre', 'marcus', 'dion', 'lena', 'omar', 'reyes', 'ghost', 'switch'],
      entry:    ['lockpick', 'lockpicked', 'thermite', 'breach', 'breached', 'crowbar', 'kicked', 'drilled', 'cut the lock'],
      vehicles: ['black cid suv', 'unmarked burrito', 'burrito', 'black suv', 'sandking', 'motorcycle', 'getaway sedan', 'unmarked'],
      weapons:  ['class 2 ap pistol', 'ap pistol', 'class 3', 'rifle', 'smg', 'switch', 'auto-sear', 'shotgun', '9mm', '5.56'],
    };


    /* ---- Drive ---- */
    /* ---- CID General "Drive" — folder presentation config; files live in the documents table ---- */
    const FOLDER_META = [
      { name: 'Joint Task Force Cases', star: 2, accent: 'amber' },
      { name: 'Blaine County Bureau Cases', star: 1, accent: 'emerald' },
      { name: 'Los Santos Bureau Cases', star: 1, accent: 'blue' },
      { name: 'State Bureau Cases', star: 1, accent: 'violet' },
      { name: 'Archives', star: 0, accent: 'slate' },
      { name: 'Case assignment Help??!?', star: 0, accent: 'rose' },
      { name: 'Confidential Informant', star: 0, accent: 'amber' },
      { name: 'Dirty $- Tracker', star: 0, accent: 'emerald' },
      { name: 'Forms', star: 0, accent: 'blue' },
      { name: 'Resources', star: 0, accent: 'slate' },
      { name: 'SOP/Training', star: 0, accent: 'violet' },
    ];
    // Bureau code → its Drive "…Cases" folder. These folders list the bureau's cases;
    // each case opens to its own files (auto-seeded from the Forms templates on creation).
    const BUREAU_FOLDER = { LSB: 'Los Santos Bureau Cases', BCB: 'Blaine County Bureau Cases', SAB: 'State Bureau Cases', JTF: 'Joint Task Force Cases' };
    const isBureauFolder = (name) => Object.keys(BUREAU_FOLDER).some((k) => BUREAU_FOLDER[k] === name);
    let DOCS = []; // Supabase-backed cache of the documents library
    // Confidential Informant risk matrix — alert flag when violent felonies >= 8 (live read-only view)
    const CI_MATRIX = [
      { id: 'CI-0093', handler: 'Sr. Det. Hale', exclusive: true, agreement: 'Active', felonies: 4 },
      { id: 'CI-0088', handler: 'Det. Och', exclusive: true, agreement: 'Active', felonies: 7 },
      { id: 'CI-0071', handler: 'Det. Reyes', exclusive: false, agreement: 'Pending', felonies: 9 },
      { id: 'CI-0066', handler: 'Det. Voss', exclusive: true, agreement: 'Expired', felonies: 2 },
    ];

    /* ---- Fillable CID forms ----
     * Structured schemas for the standard paperwork. A `documents` row becomes a
     * fillable form when content.view==='form' OR its name matches a schema below.
     * Section types: 'kv' (label/field rows), 'grid' (repeatable table), 'textarea', 'note'.
     * Field types: text | date | money | select (opts) | textarea. Saved as content.values. */
    const FORM_DEPT_OPTS = ['', 'LSPD', 'BCSO', 'SAHP'];
    const FORM_BUREAU_OPTS = ['', 'Los Santos Bureau', 'Blaine County Bureau', 'State Bureau', 'Joint Task Force'];
    const FORM_SCHEMAS = {
      'cid_investigative_report': {
        title: 'CID Investigative Report',
        subtitle: 'Criminal Investigations Department — Major Crimes Bureau — FOR OFFICIAL USE ONLY',
        sections: [
          { id: 'details', label: 'Case / Report Details', type: 'kv', fields: [
            { key: 'case_number', label: 'Case Number', type: 'text' },
            { key: 'report_type', label: 'Report Type', type: 'select', opts: ['Initial', 'Supplemental', 'Follow-up'] },
            { key: 'filed_at', label: 'Date / Time Filed', type: 'text' },
          ] },
          { id: 'detective', label: 'Detective Information', type: 'kv', fields: [
            { key: 'det_name', label: 'Name', type: 'text' },
            { key: 'det_rank', label: 'Rank', type: 'text' },
            { key: 'det_callsign', label: 'Callsign', type: 'text' },
            { key: 'det_dept', label: 'Department', type: 'select', opts: FORM_DEPT_OPTS },
          ] },
          { id: 'subjects', label: 'Suspect / Witness Information', type: 'grid', cols: [
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'phone', label: 'Phone', type: 'text' },
            { key: 'dob', label: 'DOB', type: 'text' },
          ] },
          { id: 'rights', label: 'Rights Advisement', type: 'kv', fields: [
            { key: 'rights_admin', label: 'Article 31 / Miranda Administered', type: 'select', opts: ['', 'Yes', 'No'] },
            { key: 'rights_dt', label: 'Date / Time', type: 'text' },
            { key: 'rights_waived', label: 'Rights Waived?', type: 'select', opts: ['', 'Yes', 'No'] },
            { key: 'rights_witness', label: 'Rights Witness', type: 'text' },
          ] },
          { id: 'incident', label: 'Incident Details', type: 'kv', fields: [
            { key: 'inc_type', label: 'Type of Incident', type: 'text' },
            { key: 'inc_dt', label: 'Date / Time of Incident', type: 'text' },
            { key: 'inc_loc', label: 'Location of Incident', type: 'text' },
            { key: 'inc_parties', label: 'Involved Parties', type: 'text' },
            { key: 'inc_class', label: 'MCB Classification', type: 'text' },
          ] },
          { id: 'narrative', label: 'Narrative / Statement', type: 'textarea', key: 'narrative' },
          { id: 'evidence', label: 'Evidence / Property', type: 'kv', fields: [
            { key: 'ev_items', label: 'Item(s)', type: 'text' },
            { key: 'ev_collected_by', label: 'Collected by', type: 'text' },
            { key: 'ev_files', label: 'Files', type: 'text' },
          ] },
          { id: 'remarks', label: 'Detective Remarks', type: 'textarea', key: 'remarks' },
          { id: 'actions', label: 'Investigative Actions', type: 'grid', cols: [
            { key: 'action', label: 'Action Taken', type: 'text' },
          ] },
          { id: 'understanding', label: 'Statement of Understanding', type: 'note', text: 'By completing this report, I understand that I am strictly prohibited from disclosing any information, reports, or materials pertaining to Criminal Investigation Division (CID) matters, whether ongoing, past, or closed, as doing so may jeopardize the integrity of investigative processes, compromise the rights and safety of individuals involved, and undermine the mission of CID. I further acknowledge that any unauthorized disclosure of such information may result in disciplinary, administrative, or criminal consequences under applicable laws and regulations.' },
        ],
      },
      'raid_seizure': {
        title: 'Raid Seizure Value Distribution & Allocation Form',
        subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
        sections: [
          { id: 'case', label: 'Case Information', type: 'kv', fields: [
            { key: 'bureau', label: 'Bureau', type: 'select', opts: FORM_BUREAU_OPTS },
            { key: 'case_number', label: 'Case #', type: 'text' },
            { key: 'operation', label: 'Operation Name', type: 'text' },
            { key: 'seizure_date', label: 'Date of Seizure', type: 'text' },
            { key: 'seizure_loc', label: 'Location of Seizure', type: 'text' },
          ] },
          { id: 'inventory', label: 'Seizure Inventory & Valuation', type: 'grid', cols: [
            { key: 'item', label: 'Item', type: 'text' },
            { key: 'qty', label: 'Quantity', type: 'text' },
            { key: 'unit_value', label: 'Unit Street Value', type: 'money' },
            { key: 'total_value', label: 'Total Street Value', type: 'money' },
          ] },
          { id: 'distribution', label: 'Authorized Director Distribution', type: 'kv', fields: [
            { key: 'net_value', label: 'Total Net Seizure Value ($)', type: 'money' },
            { key: 'lead_amount', label: 'Amount to Lead Detective ($)', type: 'money' },
            { key: 'division_amount', label: 'Amount to Division', type: 'money' },
            { key: 'other_alloc', label: 'Other Allocations (if any)', type: 'text' },
            { key: 'dir_sig', label: 'Director Signature', type: 'text' },
            { key: 'dist_date', label: 'Date', type: 'text' },
          ] },
          { id: 'lead_alloc', label: 'Lead Detective Allocation', type: 'grid', cols: [
            { key: 'recipient_type', label: 'Recipient Type', type: 'text' },
            { key: 'recipient', label: 'Recipient Name / Identifier', type: 'text' },
            { key: 'allocation', label: 'Allocation ($)', type: 'money' },
          ] },
          { id: 'final', label: 'Final Authorization', type: 'kv', fields: [
            { key: 'final_dir_sig', label: 'Director Signature', type: 'text' },
            { key: 'final_lead_sig', label: 'Lead Detective Signature', type: 'text' },
          ] },
        ],
      },
      'uc_operation': {
        title: 'Undercover Operation Activity Report',
        subtitle: 'Criminal Investigations Department — FOR OFFICIAL USE ONLY',
        sections: [
          { id: 'report', label: 'Report Information', type: 'kv', fields: [
            { key: 'report_type', label: 'Report Type', type: 'select', opts: ['Initial', 'Supplemental', 'Final'] },
            { key: 'submitted', label: 'Date Submitted', type: 'text' },
            { key: 'uc_officer', label: 'UC Officer Name', type: 'text' },
            { key: 'bureau', label: 'Bureau', type: 'select', opts: FORM_BUREAU_OPTS },
            { key: 'op_code', label: 'Operation Code / Case ID', type: 'text' },
          ] },
          { id: 'overview', label: 'Operation Overview', type: 'kv', fields: [
            { key: 'activity_dates', label: 'Date(s) of UC Activity', type: 'text' },
            { key: 'objective', label: 'Primary Objective', type: 'text' },
          ] },
          { id: 'summary', label: 'Summary of Activities', type: 'textarea', key: 'summary' },
          { id: 'contacts', label: 'Contacts & Interactions', type: 'grid', cols: [
            { key: 'individual', label: 'Individuals Met or Observed', type: 'text' },
            { key: 'nature', label: 'Nature of Interaction', type: 'text' },
            { key: 'key_actions', label: 'Key Conversations / Actions', type: 'text' },
          ] },
          { id: 'intel', label: 'Intelligence & Evidence', type: 'grid', cols: [
            { key: 'item', label: 'Items Observed or Discussed', type: 'text' },
            { key: 'description', label: 'Description of Evidence / Intelligence', type: 'text' },
          ] },
          { id: 'media', label: 'Photos / Recordings Captured (attach references)', type: 'textarea', key: 'media_refs' },
          { id: 'assessment', label: 'Operational Assessment', type: 'kv', fields: [
            { key: 'threat_level', label: 'Threat Level', type: 'select', opts: ['', 'Low', 'Medium', 'High', 'Critical'] },
            { key: 'cover_status', label: 'UC Cover Status', type: 'select', opts: ['', 'Intact', 'At Risk', 'Compromised', 'Withdrawn'] },
          ] },
          { id: 'notes', label: 'Additional Notes', type: 'textarea', key: 'notes' },
          { id: 'approval', label: 'Review & Approval', type: 'kv', fields: [
            { key: 'uc_sig', label: 'UC Officer Signature', type: 'text' },
            { key: 'lead_sig', label: 'Unit Lead Signature', type: 'text' },
          ] },
        ],
      },
    };
    // Map a documents row → its form schema id (by explicit content.form, or by name).
    const FORM_NAME_MAP = {
      'cid investigative report': 'cid_investigative_report',
      'raid seizure value distribution & allocation form': 'raid_seizure',
      'uc operation activity report': 'uc_operation',
      'undercover operation activity report': 'uc_operation',
    };
    function formSchemaIdFor(doc) {
      if (!doc) return null;
      if (doc.content && doc.content.view === 'form' && doc.content.form && FORM_SCHEMAS[doc.content.form]) return doc.content.form;
      const base = String(doc.name || '').replace(/\.[a-z0-9]+$/i, '').trim().toLowerCase();
      return FORM_NAME_MAP[base] || null;
    }

    /* ============================================================ 2. UTILITIES ============================================================ */
    const $  = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const el = (tag, attrs = {}, html = '') => {
      const n = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') n.className = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v);
      });
      if (html) n.innerHTML = html;
      return n;
    };
    const fmtUSD = (n) => '$' + Math.round(n).toLocaleString('en-US');
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const escapeHTML = esc;   // alias: feature files use escapeHTML; both share one scope
    const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;
    // Debounce: collapse rapid input/sync bursts into one call (perf, #10).
    const debounce = (fn, ms = 200) => { let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms); }; };

    function toast(message, type = 'info') {
      const colors = { info:'border-blue-500/30 bg-blue-500/10 text-blue-200', success:'border-emerald-500/30 bg-emerald-500/10 text-emerald-200', warn:'border-amber-500/30 bg-amber-500/10 text-amber-200', danger:'border-rose-500/30 bg-rose-500/10 text-rose-200' };
      const icons = { info:'ℹ️', success:'✅', warn:'⚠️', danger:'🚨' };
      const t = el('div', { class: `flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-glow backdrop-blur-xl ${colors[type] || colors.info}` }, `<span>${icons[type] || icons.info}</span><span>${esc(message)}</span>`);
      t.style.animation = 'popIn .25s cubic-bezier(.16,.84,.44,1) both';
      $('#toast-root').appendChild(t);
      setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; setTimeout(() => t.remove(), 300); }, 3400);
    }

    const Store = {
      KEY: 'cid-portal-v3', OLD: 'cid-portal-v2', _d: null,
      _load() {
        if (this._d) return this._d;
        try {
          this._d = JSON.parse(localStorage.getItem(this.KEY));
          if (!this._d) { // one-time migration from v2
            const old = JSON.parse(localStorage.getItem(this.OLD) || 'null');
            this._d = old || {};
            if (old) localStorage.setItem(this.KEY, JSON.stringify(this._d));
          }
        } catch (e) { this._d = {}; }
        return this._d;
      },
      get(k, f = null) { const v = this._load()[k]; return v === undefined ? f : v; },
      set(k, v) { const d = this._load(); d[k] = v; try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) {} },
    };

    /* ============================================================ BULK IMPORT (CSV / JSON) ============================================================
     * One-time per-module importer. Accepts a JSON array of objects, or CSV with
     * a header row; maps to an allow-listed column set, coerces types, batch-inserts
     * via Supabase (RLS still applies), and reports inserted/skipped counts. */
    function parseCSVText(text) {
      const rows = []; let i = 0, field = '', row = [], inQ = false;
      while (i < text.length) {
        const c = text[i];
        if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
        else if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
        i++;
      }
      if (field.length || row.length) { row.push(field); rows.push(row); }
      const clean = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
      if (clean.length < 2) return [];
      const headers = clean[0].map((h) => h.trim());
      return clean.slice(1).map((r) => { const o = {}; headers.forEach((h, idx) => { o[h] = r[idx] !== undefined ? r[idx] : ''; }); return o; });
    }
    function importRows(rawText, cfg) {
      const t = (rawText || '').trim();
      if (!t) return { rows: [], skipped: 0, error: 'Nothing to import.' };
      let raw;
      if (t[0] === '[' || t[0] === '{') {
        try { raw = JSON.parse(t); } catch (e) { return { rows: [], skipped: 0, error: 'Invalid JSON: ' + e.message }; }
        if (!Array.isArray(raw)) raw = [raw];
      } else raw = parseCSVText(t);
      const num = cfg.num || [], bool = cfg.bool || [], lower = cfg.lower || [], upper = cfg.upper || [];
      let skipped = 0; const rows = [];
      raw.forEach((src) => {
        if (!src || typeof src !== 'object') { skipped++; return; }
        const o = {};
        cfg.allow.forEach((k) => {
          if (src[k] === undefined || src[k] === null) return;
          let v = src[k];
          if (typeof v === 'string') v = v.trim();
          if (v === '') return;
          if (num.includes(k)) { v = Number(String(v).replace(/[^0-9.\-]/g, '')); if (isNaN(v)) return; }
          else if (bool.includes(k)) v = /^(1|true|yes|y)$/i.test(String(v));
          else if (lower.includes(k)) v = String(v).toLowerCase();
          else if (upper.includes(k)) v = String(v).toUpperCase();
          o[k] = v;
        });
        if (cfg.coerce) { const r = cfg.coerce(o, src); if (r === null) { skipped++; return; } }
        if ((cfg.required || []).some((k) => o[k] === undefined || o[k] === '')) { skipped++; return; }
        rows.push(o);
      });
      return { rows, skipped, error: null };
    }
    function openImportModal(cfg) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      const cols = cfg.allow.map((k) => k + ((cfg.required || []).includes(k) ? '*' : '')).join(', ');
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Import ${esc(cfg.label)}</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-2 text-xs text-slate-400">Paste a <b>JSON array</b> of objects or <b>CSV</b> with a header row, or pick a <b>.csv / .xlsx</b> file. Columns (<span class="text-rose-300">*</span> required): <span class="font-mono text-blue-300">${esc(cols)}</span></p>
        <input id="imp-file" type="file" accept=".csv,.json,.xlsx,.xls,text/csv,application/json" class="mb-2 block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white" />
        <textarea id="imp-text" rows="9" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-badge-500" placeholder='[{"key":"value"}]   — or —   col1,col2&#10;val1,val2'></textarea>
        <div id="imp-msg" class="mt-2 text-xs text-slate-400"></div>
        <button id="imp-go" class="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Import</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      const ta = node.querySelector('#imp-text'), msg = node.querySelector('#imp-msg');
      node.querySelector('#imp-file').onchange = (e) => {
        const f = e.target.files[0]; if (!f) return;
        const isXlsx = /\.(xlsx|xls)$/i.test(f.name);
        if (isXlsx) {
          if (!window.XLSX) { msg.innerHTML = '<span class="text-rose-300">Excel library unavailable (offline). Use CSV/JSON.</span>'; return; }
          const rd = new FileReader();
          rd.onload = () => { try { const wb = window.XLSX.read(rd.result, { type: 'array' }); ta.value = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); msg.textContent = 'Loaded sheet "' + wb.SheetNames[0] + '" — review then Import.'; } catch (err) { msg.innerHTML = '<span class="text-rose-300">Could not read workbook.</span>'; } };
          rd.readAsArrayBuffer(f);
        } else { const rd = new FileReader(); rd.onload = () => { ta.value = rd.result; }; rd.readAsText(f); }
      };
      node.querySelector('#imp-go').onclick = async () => {
        const { rows, skipped, error } = importRows(ta.value, cfg);
        if (error) { msg.innerHTML = '<span class="text-rose-300">' + esc(error) + '</span>'; return; }
        if (!rows.length) { msg.innerHTML = '<span class="text-amber-300">No valid rows found' + (skipped ? ' (' + skipped + ' skipped)' : '') + '.</span>'; return; }
        msg.textContent = 'Importing ' + rows.length + ' row(s)…';
        const res = await DB().insert(cfg.table, rows);
        if (res.error) { msg.innerHTML = '<span class="text-rose-300">Import failed: ' + esc(res.error.message) + '</span>'; return; }
        closeModal();
        toast('Imported ' + rows.length + ' ' + cfg.label + (skipped ? ' · ' + skipped + ' skipped' : ''), 'success');
        if (typeof cfg.after === 'function') cfg.after();
      };
      openModal(node);
    }
    // Inject an "⇪ Import" button next to a module's primary "+ New" action; visibility mirrors it.
    function wireImport(anchorSel, cfg) {
      const a = $(anchorSel); if (!a) return null;
      const btn = el('button', { class: 'imp-btn rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10' }, '⇪ Import');
      btn.addEventListener('click', () => openImportModal(cfg));
      a.parentNode.insertBefore(btn, a);
      const sync = () => btn.classList.toggle('hidden', a.classList.contains('hidden') || !(DB() && DB().canEdit()));
      sync();
      try { new MutationObserver(sync).observe(a, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
      return btn;
    }
    function wireAllImports() {
      const I = [
        ['#case-new',      { table:'cases',                label:'cases',         allow:['case_number','title','bureau','status','summary','area'], required:['case_number'], upper:['bureau'], lower:['status'], after:fetchCases }],
        ['#person-new',    { table:'persons',              label:'persons',       allow:['name','alias','dob','ccw','vch','felony_count','status','notes'], required:['name'], bool:['ccw'], num:['vch','felony_count'], after:fetchPersons }],
        ['#add-gang',      { table:'gangs',                label:'gangs',         allow:['name','colors','threat_level','notes'], required:['name'], lower:['threat_level'], after:fetchGangs }],
        ['#narc-new',      { table:'narcotics',            label:'narcotics',     allow:['name','classification','icon','popularity','street_price','wholesale_price'], required:['name'], num:['popularity','street_price','wholesale_price'], after:fetchDrugs }],
        ['#add-place',     { table:'places',               label:'places',        allow:['name','type','area','notes'], required:['name','type'], lower:['type'], after:fetchPlaces }],
        ['#bench-new',     { table:'ballistics_benches',   label:'benches',       allow:['bench_type','name','tier','heat'], required:['bench_type','name'], lower:['bench_type'], after:fetchBenches }],
        ['#footprint-new', { table:'ballistic_footprints', label:'footprints',    allow:['signature','weapon'], required:['signature'], after:fetchFootprints }],
        ['#new-tracker',   { table:'trackers',             label:'trackers',      allow:['tracker_code','target','duration_hours'], required:['tracker_code','target'], num:['duration_hours'], after:fetchTrackers }],
        ['#new-ticket-btn',{ table:'tickets',              label:'tickets',       allow:['ticket_code','source','description','reported_dept'], required:['ticket_code'], after:fetchTickets }],
        ['#add-commend',   { table:'commendations',        label:'commendations', allow:['title','recipient_name','note','icon','tint'], required:['title'], after:fetchCommendations }],
        ['#add-media',     { table:'media',                label:'media',         allow:['title','type','external_url','kind'], required:['title','type'], lower:['type'], after:fetchMedia }],
      ];
      I.forEach(([sel, cfg]) => wireImport(sel, cfg));
    }

    /* ============================================================ 3. ROUTER / SHELL ============================================================ */
    const PAGE_META = {
      command:    { title: 'Central Command', sub: 'Case assignment & operational hub' },
      cases:      { title: 'Case Files', sub: 'Live case records, evidence & chain-of-custody' },
      persons:    { title: 'Persons', sub: 'Suspects & persons of interest (live)' },
      narcotics:  { title: 'Narcotics Intelligence', sub: 'Drug processing & market analytics' },
      ballistics: { title: 'Ballistics & Logistics', sub: 'Weapon benches & component tracing' },
      personnel:  { title: 'Personnel & Roster', sub: 'Commendations & media intake vault' },
      modus:      { title: 'M.O. Detector', sub: 'Tactical profiling & cross-reference' },
      gangs:      { title: 'Gangs & Turf', sub: 'Organizations, ranks, properties & territory' },
      places:     { title: 'Criminal Places', sub: 'Locations & production processes' },
      reports:    { title: 'Report Generation', sub: 'Template-driven reports & supplemental chains' },
      rico:       { title: 'RICO Builder', sub: 'Enterprise & predicate-act element tracker' },
      drive:      { title: 'CID General', sub: 'Shared investigative drive' },
      records:    { title: 'CID Records', sub: 'Live shared records (Supabase)' },
      announce:   { title: 'Announcements', sub: 'Division-wide notices from command staff' },
      'case-files': { title: 'Case Files — Attachments', sub: 'Files uploaded per case (FiveManage + Supabase)' },
      heatmap:    { title: 'Commander Heatmap', sub: 'Gang turf, places, raids & case concentration by area' },
      shifts:     { title: 'Weekly Shift Reports', sub: 'Detective activity rolled up to bureau leadership' },
      audit:      { title: 'Audit Log', sub: 'Division-wide action history (Bureau Lead and above)' },
    };

    function navigate(tab) {
      if (!PAGE_META[tab]) tab = 'command';
      $$('.view').forEach((v) => v.classList.remove('active'));
      const view = $('#view-' + tab); if (view) view.classList.add('active');
      $$('.nav-link').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('active', on); on ? b.setAttribute('aria-current','page') : b.removeAttribute('aria-current'); });
      $$('.bnav-link').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
      const m = PAGE_META[tab]; if (m) { $('#page-title').textContent = m.title; $('#page-subtitle').textContent = m.sub; }
      if (location.hash !== '#' + tab) { try { history.replaceState(null, '', '#' + tab); } catch (e) {} }
      Store.set('tab', tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      closeDrawer();
      if (tab === 'cases' && typeof onEnterCases === 'function') onEnterCases();
      if (tab === 'persons' && typeof onEnterPersons === 'function') onEnterPersons();
      if (tab === 'gangs' && typeof onEnterGangs === 'function') onEnterGangs();
      if (tab === 'narcotics' && typeof onEnterNarcotics === 'function') onEnterNarcotics();
      if (tab === 'places' && typeof onEnterPlaces === 'function') onEnterPlaces();
      if (tab === 'ballistics' && typeof onEnterBallistics === 'function') onEnterBallistics();
      if (tab === 'reports' && typeof renderReportChain === 'function') renderReportChain();
      if (tab === 'rico' && typeof renderRico === 'function') renderRico();
      if (tab === 'command' && typeof onEnterCommand === 'function') onEnterCommand();
      if (tab === 'personnel' && typeof onEnterPersonnel === 'function') onEnterPersonnel();
      if (tab === 'modus' && typeof onEnterModus === 'function') onEnterModus();
      if (tab === 'drive' && typeof onEnterDrive === 'function') onEnterDrive();
      if (tab === 'announce' && typeof onEnterAnnounce === 'function') onEnterAnnounce();
      if (tab === 'case-files' && typeof onEnterCaseFiles === 'function') onEnterCaseFiles();
      if (tab === 'heatmap' && typeof onEnterHeatmap === 'function') onEnterHeatmap();
      if (tab === 'shifts' && typeof onEnterShifts === 'function') onEnterShifts();
      if (tab === 'audit' && typeof onEnterAudit === 'function') onEnterAudit();
    }
    $$('.nav-link, .bnav-link').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.tab)));

    function openDrawer() { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebar-backdrop').classList.remove('hidden'); document.body.classList.add('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','true'); }
    function closeDrawer() { if (isDesktop()) return; $('#sidebar').classList.add('-translate-x-full'); $('#sidebar-backdrop').classList.add('hidden'); document.body.classList.remove('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','false'); }
    function wireDrawer() {
      $('#menu-toggle').addEventListener('click', openDrawer);
      $('#menu-close').addEventListener('click', closeDrawer);
      $('#sidebar-backdrop').addEventListener('click', closeDrawer);
      window.matchMedia('(min-width: 1024px)').addEventListener('change', (e) => {
        if (e.matches) { $('#sidebar').classList.remove('-translate-x-full'); $('#sidebar-backdrop').classList.add('hidden'); document.body.classList.remove('overflow-hidden','lg:overflow-auto'); $('#menu-toggle').setAttribute('aria-expanded','false'); }
        else { $('#sidebar').classList.add('-translate-x-full'); }
      });
    }
    function applyCollapse(c) {
      document.body.classList.toggle('nav-collapsed', c);
      const b = $('#collapse-toggle'); b.setAttribute('aria-pressed', String(c)); b.setAttribute('aria-label', c ? 'Expand sidebar' : 'Collapse sidebar');
      $('#collapse-icon').innerHTML = c ? '<path d="m9 18 6-6-6-6"/>' : '<path d="m15 18-6-6 6-6"/>';
      Store.set('collapsed', c);
    }
    function wireCollapse() { applyCollapse(Store.get('collapsed', false)); $('#collapse-toggle').addEventListener('click', () => applyCollapse(!document.body.classList.contains('nav-collapsed'))); }

    /* ============================================================ 4. MODAL ENGINE (focus-trapped) ============================================================ */
    let lastFocused = null;
    function openModal(node, { wide = false } = {}) {
      closeModal(); lastFocused = document.activeElement;
      const backdrop = el('div', { class: 'modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm' });
      const card = el('div', { class: `modal-card relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-ink-850 shadow-glow`, role:'dialog', 'aria-modal':'true', tabindex:'-1' });
      card.appendChild(node); backdrop.appendChild(card);
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
      $('#modal-root').appendChild(backdrop); document.body.classList.add('overflow-hidden');
      document.addEventListener('keydown', modalKey);
      (focusable(card)[0] || card).focus();
    }
    function focusable(c) { return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', c).filter((n) => n.offsetParent !== null); }
    function modalKey(e) {
      if (e.key === 'Escape') return closeModal();
      if (e.key !== 'Tab') return;
      const card = $('.modal-card'); if (!card) return; const f = focusable(card); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function closeModal() {
      $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', modalKey);
      if ($('#sidebar').classList.contains('-translate-x-full') || isDesktop()) document.body.classList.remove('overflow-hidden');
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus(); lastFocused = null;
    }


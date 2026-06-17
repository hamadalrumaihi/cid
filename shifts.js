/* shifts.js — Weekly shift reports (#5). Detectives file one report per week
   (cases worked, arrests, evidence, notes); RLS rolls them up to the author's
   bureau leadership + command/director. Classic script, shared global scope. */
"use strict";

    let SHIFTS = [];
    function mondayOf(d) { d = new Date(d); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); }

    async function fetchShifts() {
      if (!dbReady()) { renderShifts(); return; }
      try { SHIFTS = await DB().list('shift_reports', { order: 'week_start', ascending: false }); } catch (e) { SHIFTS = []; }
      renderShifts();
    }
    function onEnterShifts() { if (dbReady()) fetchShifts(); else renderShifts(); }

    function renderShifts() {
      const list = $('#shift-list'); if (!list) return;
      const btn = $('#shift-new'); if (btn) { btn.classList.toggle('hidden', !(DB() && DB().canEdit())); btn.onclick = () => openShiftModal(null); }
      if (!dbReady()) { list.innerHTML = '<p class="text-sm text-slate-500">Sign in to log and view weekly shift reports.</p>'; return; }
      if (!SHIFTS.length) { list.innerHTML = '<p class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-500">No shift reports yet. Use “+ This week’s report”.</p>'; return; }
      const me = DB().me;
      list.innerHTML = SHIFTS.map((s) => { const mine = me && s.author_id === me.id; return `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div><span class="font-mono text-sm font-semibold text-blue-300">${esc(s.bureau)}</span> · <span class="text-sm text-white">${esc(s.author_name || 'Officer')}</span> <span class="ml-1 text-[11px] text-slate-500">week of ${esc(s.week_start)}</span>${mine ? ' <span class="ml-1 rounded bg-blue-500/15 px-1.5 text-[9px] font-semibold uppercase text-blue-300">you</span>' : ''}</div>
          ${mine ? `<button class="sh-edit rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10" data-id="${esc(s.id)}">Edit</button>` : ''}
        </div>
        <div class="mt-2 flex flex-wrap gap-3 text-xs text-slate-300"><span>📁 ${esc(String(s.cases_worked || '—'))}</span><span>🚓 ${s.arrests} arrest${s.arrests === 1 ? '' : 's'}</span><span>🔬 ${s.evidence_count} evidence</span></div>
        ${s.notes ? `<p class="mt-2 whitespace-pre-wrap text-xs text-slate-400">${esc(s.notes)}</p>` : ''}
      </div>`; }).join('');
      list.querySelectorAll('.sh-edit').forEach((b) => b.onclick = () => openShiftModal(SHIFTS.find((x) => x.id === b.dataset.id)));
    }

    function openShiftModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const me = DB().me, s = record || {};
      const node = el('div', { class: 'p-6' });
      const inp = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500';
      const lbl = 'mb-1 block text-xs font-semibold text-slate-400';
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Weekly Report</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="${lbl}">Week starting (Mon)</label><input data-k="week_start" type="date" value="${esc(s.week_start || mondayOf(new Date()))}" class="${inp}" /></div>
          <div><label class="${lbl}">Arrests</label><input data-k="arrests" type="number" min="0" value="${s.arrests != null ? s.arrests : 0}" class="${inp}" /></div>
          <div class="sm:col-span-2"><label class="${lbl}">Cases worked</label><input data-k="cases_worked" value="${esc(s.cases_worked || '')}" placeholder="SAB-900001, SAB-900007 …" class="${inp}" /></div>
          <div><label class="${lbl}">Evidence collected (#)</label><input data-k="evidence_count" type="number" min="0" value="${s.evidence_count != null ? s.evidence_count : 0}" class="${inp}" /></div>
          <div class="sm:col-span-2"><label class="${lbl}">Notes</label><textarea data-k="notes" rows="4" class="${inp}">${esc(s.notes || '')}</textarea></div>
        </div>
        <button id="shift-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Submit report'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#shift-save').onclick = async () => {
        const p = {}; $$('[data-k]', node).forEach((f) => p[f.dataset.k] = f.value.trim());
        if (!p.week_start) { toast('Week is required.', 'warn'); return; }
        p.arrests = Number(p.arrests) || 0; p.evidence_count = Number(p.evidence_count) || 0;
        p.bureau = me.division || 'JTF'; p.author_name = me.display_name;
        const res = record && record.id ? await DB().update('shift_reports', record.id, p) : await DB().insert('shift_reports', p);
        if (res.error) { const dup = /duplicate|unique|already exists|23505/i.test(res.error.message || ''); toast(dup ? 'You already filed a report for that week — edit it instead.' : 'Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Shift report saved', 'success'); fetchShifts();
      };
      openModal(node, { wide: true });
    }

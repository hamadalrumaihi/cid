/* intel.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).

   Wave 2: unified intel profiles. A right-anchored slide-over (openModal {slide})
   that rolls up everything linked to a person or gang — cases, gang memberships,
   media, evidence, turf, places, ballistic footprints — with click-through into
   case detail and between person/gang profiles. All queries are RLS-scoped, so a
   linked case in another bureau surfaces as "access restricted" rather than 404. */
"use strict";

    const ipUniq = (arr) => [...new Set(arr)];
    const IP_MEDIA_ICON = { photo: '🖼️', video: '🎞️', document: '📄', audio: '🎧' };

    function ipSection(title, count, inner) {
      return `<div><div class="mb-2 flex items-center justify-between"><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">${title}</p><span class="text-[11px] text-slate-500">${count}</span></div>${inner}</div>`;
    }
    const ipListOrEmpty = (arr, fmt) => arr.length ? `<div class="space-y-1.5">${arr.map(fmt).join('')}</div>` : '<p class="text-xs text-slate-500">None on file.</p>';
    function ipFact(label, valHtml) {
      return `<div class="rounded-lg bg-ink-900 px-3 py-2"><p class="text-[10px] uppercase tracking-wider text-slate-500">${label}</p><p class="text-sm font-semibold text-white">${valHtml}</p></div>`;
    }
    // A linked case the viewer can see → clickable; cross-bureau → muted note.
    function ipCaseChip(cid) {
      const c = (typeof casesCache !== 'undefined' ? casesCache : []).find((x) => x.id === cid);
      return c
        ? `<button class="ip-case block w-full rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5" data-id="${c.id}"><span class="font-mono text-blue-300">${escapeHTML(c.case_number)}</span> · ${escapeHTML(c.title || '')} <span class="text-slate-500">· ${escapeHTML(c.status || '')}</span></button>`
        : '<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-500">Linked case — access restricted (other bureau).</div>';
    }
    const ipCaseTag = (cid) => { const n = (typeof caseNumById === 'function') ? caseNumById(cid) : null; return n ? `<button class="ip-case flex-shrink-0 font-mono text-[11px] text-blue-300 hover:text-blue-200" data-id="${cid}">${escapeHTML(n)}</button>` : ''; };
    function ipMediaItem(m) {
      return `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm"><div class="flex items-center justify-between gap-2"><span class="truncate text-slate-200">${IP_MEDIA_ICON[m.type] || '📎'} ${escapeHTML(m.title || m.kind || 'Media')}</span>${m.external_url ? `<a href="${escapeHTML(m.external_url)}" target="_blank" rel="noopener" class="flex-shrink-0 text-[11px] text-blue-300 hover:text-blue-200">open ↗</a>` : ''}</div>${ipCaseTag(m.case_id) ? `<div class="mt-1">${ipCaseTag(m.case_id)}</div>` : ''}</div>`;
    }
    function ipEvItem(e) {
      return `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm"><div class="flex items-center justify-between gap-2"><span class="truncate text-slate-200">${escapeHTML(e.item_code || e.type || 'Item')}${e.description ? ' <span class="text-slate-500">' + escapeHTML(e.description) + '</span>' : ''}</span>${ipCaseTag(e.case_id)}</div></div>`;
    }

    function wireProfileLinks(node) {
      $$('.ip-case', node).forEach((b) => b.onclick = () => { closeModal(); if (typeof navigate === 'function') navigate('cases'); setTimeout(() => { if (typeof openCaseDetail === 'function') openCaseDetail(b.dataset.id); }, 120); });
      $$('.ip-gang', node).forEach((b) => b.onclick = () => openIntelProfile('gang', b.dataset.id));
      $$('.ip-person', node).forEach((b) => b.onclick = () => openIntelProfile('person', b.dataset.id));
    }

    async function openIntelProfile(type, id) {
      if (!dbReady()) { toast('Sign in to view intel profiles.', 'warn'); return; }
      const node = el('div', { class: 'flex h-full flex-col' });
      node.innerHTML = `
        <div class="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-ink-850 px-6 py-4">
          <div class="min-w-0"><p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Intel profile</p><h3 id="ip-title" class="truncate text-xl font-bold text-white">Loading…</h3><p id="ip-sub" class="text-xs text-slate-400"></p></div>
          <div class="flex flex-shrink-0 items-center gap-2">
            <button id="ip-network" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10" title="View in relationship network">🕸 Network</button>
            <button class="close-x text-2xl leading-none text-slate-400 hover:text-white">&times;</button>
          </div>
        </div>
        <div id="ip-body" class="flex-1 space-y-6 px-6 py-5"><p class="text-sm text-slate-500">Building rollup…</p></div>`;
      node.querySelector('.close-x').onclick = closeModal;
      const ipn = node.querySelector('#ip-network'); if (ipn) ipn.onclick = () => { closeModal(); if (typeof openIntelGraph === 'function') openIntelGraph(type, id); };
      openModal(node, { slide: true });
      try {
        if (type === 'person') await buildPersonProfile(id, node);
        else if (type === 'gang') await buildGangProfile(id, node);
        else throw new Error('Unknown profile type');
      } catch (e) {
        const b = node.querySelector('#ip-body'); if (b) b.innerHTML = `<p class="text-sm text-rose-300">Could not build profile: ${escapeHTML(e.message || String(e))}</p>`;
      }
    }

    async function buildPersonProfile(id, node) {
      let person = (typeof PERSONS !== 'undefined' ? PERSONS : []).find((p) => p.id === id);
      if (!person) { const r = await DB().list('persons', { eq: { id } }); person = r[0]; }
      if (!person) throw new Error('Person not found');
      const sel = (tbl, col) => DB().from(tbl).select('*').eq(col, id).then((r) => r.data || []).catch(() => []);
      const [members, media] = await Promise.all([sel('gang_members', 'person_id'), sel('media', 'person_id')]);
      const direct = await DB().from('case_intel_links').select('case_id').eq('kind', 'person').eq('ref_id', id).then((r) => r.data || []).catch(() => []);
      const caseIds = ipUniq([...members.map((m) => m.case_id), ...media.map((m) => m.case_id), ...direct.map((d) => d.case_id)].filter(Boolean));
      let evidence = [];
      if (caseIds.length) evidence = await DB().from('evidence').select('*').in('case_id', caseIds).then((r) => r.data || []).catch(() => []);

      node.querySelector('#ip-title').textContent = '👤 ' + (person.name || 'Person');
      node.querySelector('#ip-sub').textContent = [person.alias ? '“' + person.alias + '”' : '', person.status || ''].filter(Boolean).join(' · ');
      const gname = person.gang_id && typeof gangNameById === 'function' ? gangNameById(person.gang_id) : null;
      const facts = `<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        ${ipFact('Gang', gname ? `<button class="ip-gang text-blue-300 hover:text-blue-200" data-id="${person.gang_id}">${escapeHTML(gname)}</button>` : '—')}
        ${ipFact('CCW', person.ccw ? 'Yes' : 'No')}
        ${ipFact('VCH', String(person.vch || 0))}
        ${ipFact('Felonies', String(person.felony_count || 0))}
      </div>${person.notes ? `<p class="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-sm text-slate-300">${escapeHTML(person.notes)}</p>` : ''}`;
      const memItem = (m) => `<div class="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm"><span class="min-w-0 truncate text-slate-200">🚩 ${m.gang_id ? `<button class="ip-gang text-blue-300 hover:text-blue-200" data-id="${m.gang_id}">${escapeHTML((typeof gangNameById === 'function' && gangNameById(m.gang_id)) || 'Gang')}</button>` : 'Gang'} <span class="text-slate-500">· ${escapeHTML(m.rank || m.status || 'member')}</span></span>${ipCaseTag(m.case_id)}</div>`;
      const props = Array.isArray(person.properties) ? person.properties : [];
      const propItem = (pr) => `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">🏠 ${escapeHTML(pr.address || '—')}${pr.type ? ` <span class="text-slate-500">· ${escapeHTML(pr.type)}</span>` : ''}${pr.notes ? `<br><span class="text-[11px] text-slate-400">${escapeHTML(pr.notes)}</span>` : ''}</div>`;
      node.querySelector('#ip-body').innerHTML = facts + [
        ipSection('Linked cases', caseIds.length, ipListOrEmpty(caseIds, ipCaseChip)),
        ipSection('Known properties', props.length, ipListOrEmpty(props, propItem)),
        ipSection('Gang memberships', members.length, ipListOrEmpty(members, memItem)),
        ipSection('Media', media.length, ipListOrEmpty(media, ipMediaItem)),
        ipSection('Evidence (in linked cases)', evidence.length, ipListOrEmpty(evidence, ipEvItem)),
      ].join('');
      wireProfileLinks(node);
    }

    async function buildGangProfile(id, node) {
      let gang = (typeof GANGS !== 'undefined' ? GANGS : []).find((g) => g.id === id);
      if (!gang) { const r = await DB().list('gangs', { eq: { id } }); gang = r[0]; }
      if (!gang) throw new Error('Gang not found');
      const sel = (tbl, col, val) => DB().from(tbl).select('*').eq(col, val).then((r) => r.data || []).catch(() => []);
      const [members, turf, places, footprints, media] = await Promise.all([
        sel('gang_members', 'gang_id', id), sel('gang_turf', 'gang_id', id), sel('places', 'controlling_gang_id', id),
        sel('ballistic_footprints', 'gang_id', id), sel('media', 'gang_id', id),
      ]);
      const direct = await DB().from('case_intel_links').select('case_id').eq('kind', 'gang').eq('ref_id', id).then((r) => r.data || []).catch(() => []);
      const caseIds = ipUniq([...members.map((m) => m.case_id), ...places.map((p) => p.case_id), ...footprints.map((f) => f.case_id), ...media.map((m) => m.case_id), ...direct.map((d) => d.case_id)].filter(Boolean));
      let evidence = [];
      if (caseIds.length) evidence = await DB().from('evidence').select('*').in('case_id', caseIds).then((r) => r.data || []).catch(() => []);

      node.querySelector('#ip-title').textContent = '🚩 ' + (gang.name || 'Gang');
      node.querySelector('#ip-sub').textContent = [gang.colors ? 'Colors: ' + gang.colors : '', (gang.threat_level || '') + ' threat'].filter(Boolean).join(' · ');
      const facts = `<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        ${ipFact('Members', String(members.length))}
        ${ipFact('Turf blocks', String(turf.length))}
        ${ipFact('Properties', String(places.length))}
        ${ipFact('Linked cases', String(caseIds.length))}
      </div>${gang.notes ? `<p class="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-sm text-slate-300">${escapeHTML(gang.notes)}</p>` : ''}`;
      const memItem = (m) => `<div class="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm"><span class="min-w-0 truncate text-slate-200">${escapeHTML(m.name)} <span class="text-slate-500">· ${escapeHTML(m.rank || m.status || 'member')}</span></span><span class="flex flex-shrink-0 items-center gap-2">${ipCaseTag(m.case_id)}${m.person_id ? `<button class="ip-person text-[11px] text-blue-300 hover:text-blue-200" data-id="${m.person_id}">profile →</button>` : ''}</span></div>`;
      const turfItem = (t) => `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">${escapeHTML(t.block || '—')}${t.hotspot_area ? ' <span class="text-slate-500">· ' + escapeHTML(t.hotspot_area) + '</span>' : ''}${t.density ? ' <span class="text-slate-500">· ' + escapeHTML(t.density) + '</span>' : ''}</div>`;
      const placeItem = (p) => `<div class="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm"><span class="min-w-0 truncate text-slate-200">📍 ${escapeHTML(p.name)} <span class="text-slate-500">· ${escapeHTML(p.type || '')}</span></span>${ipCaseTag(p.case_id)}</div>`;
      const fpItem = (f) => `<div class="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm"><span class="min-w-0 truncate text-slate-200">🧬 ${escapeHTML(f.signature || '—')}${f.weapon ? ' <span class="text-slate-500">· ' + escapeHTML(f.weapon) + '</span>' : ''}</span>${ipCaseTag(f.case_id)}</div>`;
      node.querySelector('#ip-body').innerHTML = facts + [
        ipSection('Linked cases', caseIds.length, ipListOrEmpty(caseIds, ipCaseChip)),
        ipSection('Roster', members.length, ipListOrEmpty(members, memItem)),
        ipSection('Turf', turf.length, ipListOrEmpty(turf, turfItem)),
        ipSection('Properties', places.length, ipListOrEmpty(places, placeItem)),
        ipSection('Ballistic footprints', footprints.length, ipListOrEmpty(footprints, fpItem)),
        ipSection('Media', media.length, ipListOrEmpty(media, ipMediaItem)),
        ipSection('Evidence (in linked cases)', evidence.length, ipListOrEmpty(evidence, ipEvItem)),
      ].join('');
      wireProfileLinks(node);
    }

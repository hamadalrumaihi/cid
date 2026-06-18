/* heatmap.js — Commander Heatmap (#4). Aggregates LIVE data by area: case
   concentration (cases.area), gang turf (gang_turf.hotspot_area/block), criminal
   places (places.area), and raid sites (raid_compensations → case.area). Bureau
   isolation is automatic: casesCache and raid_compensations are already RLS-scoped
   to cases the viewer can access, so case/raid concentration only reflects those.
   Shared intel (places, gang turf) is division-wide by design. Classic script,
   shared global scope. */
"use strict";

    let HM = { places: [], turf: [], raids: [] };

    async function fetchHeatmap() {
      if (!dbReady()) { renderHeatmap(); return; }
      try {
        const [places, turf, raids] = await Promise.all([
          DB().list('places', {}).catch(() => []),
          DB().list('gang_turf', {}).catch(() => []),
          DB().list('raid_compensations', {}).catch(() => []),
        ]);
        HM = { places, turf, raids };
      } catch (e) {}
      renderHeatmap();
    }
    function onEnterHeatmap() { if (dbReady()) fetchHeatmap(); else renderHeatmap(); }

    function renderHeatmap() {
      const grid = $('#hm-grid'), notice = $('#hm-notice'), legend = $('#hm-legend'); if (!grid) return;
      if (!dbReady()) { if (notice) { notice.classList.remove('hidden'); notice.textContent = 'Sign in to view the Commander Heatmap.'; } grid.innerHTML = ''; if (legend) legend.textContent = ''; return; }
      if (notice) notice.classList.add('hidden');
      // Defensive: strip a trailing ".0" on bare numbers (e.g. legacy imports where
      // a postal/area like "21" came through as "21.0") before grouping/display.
      const norm = (s) => String(s || '').replace(/(\d)\.0\b/g, '$1').trim();
      const areas = {};
      const bump = (area, key) => { const a = norm(area); if (!a) return; (areas[a] = areas[a] || { cases: 0, places: 0, turf: 0, raids: 0 })[key] += 1; };
      const cases = (typeof casesCache !== 'undefined' ? casesCache : []);
      const caseArea = {};
      cases.forEach((c) => { caseArea[c.id] = norm(c.area); if (norm(c.area)) bump(c.area, 'cases'); });
      HM.places.forEach((p) => bump(p.area, 'places'));
      HM.turf.forEach((t) => bump(t.hotspot_area || t.block, 'turf'));
      HM.raids.forEach((r) => { const a = caseArea[r.case_id]; if (a) bump(a, 'raids'); });
      const rows = Object.keys(areas).map((a) => { const v = areas[a]; return { area: a, cases: v.cases, places: v.places, turf: v.turf, raids: v.raids, score: v.cases * 3 + v.raids * 3 + v.turf * 2 + v.places }; }).sort((x, y) => y.score - x.score);
      const max = rows.reduce((m, r) => Math.max(m, r.score), 0) || 1;
      if (!rows.length) { grid.innerHTML = '<p class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-500">No area data yet. Add an <b>Area</b> to cases, places, or gang turf to populate the heatmap.</p>'; if (legend) legend.textContent = ''; return; }
      const lvl = (pct) => pct >= 75 ? 'lvl3' : pct >= 50 ? 'lvl2' : pct >= 25 ? 'lvl1' : '';
      grid.innerHTML = rows.map((r) => { const pct = Math.round(r.score / max * 100); return `<div class="hm-tile ${lvl(pct)}">
        <div class="flex items-center justify-between"><h4 class="text-base font-bold text-white">${esc(r.area)}</h4><span class="font-mono text-lg font-bold text-white">${pct}</span></div>
        <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-900"><div class="hm-bar" style="width:${pct}%"></div></div>
        <div class="mt-3 grid grid-cols-2 gap-1 text-[11px] text-slate-300">
          <span>📂 ${r.cases} case${r.cases === 1 ? '' : 's'}</span><span>💥 ${r.raids} raid${r.raids === 1 ? '' : 's'}</span>
          <span>🚩 ${r.turf} turf</span><span>📍 ${r.places} place${r.places === 1 ? '' : 's'}</span>
        </div></div>`; }).join('');
      if (legend) legend.innerHTML = `Intensity = cases×3 + raids×3 + turf×2 + places. Scoped to cases you can access (bureau + JTF + grants). ${rows.length} area${rows.length === 1 ? '' : 's'}.`;
    }

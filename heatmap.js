/* heatmap.js — Commander Heatmap (#4). Aggregates LIVE data by area: case
   concentration (cases.area), gang turf (gang_turf.hotspot_area/block), criminal
   places (places.area), and raid sites (raid_compensations → case.area). Bureau
   isolation is automatic: casesCache and raid_compensations are already RLS-scoped
   to cases the viewer can access, so case/raid concentration only reflects those.
   Shared intel (places, gang turf) is division-wide by design. Classic script,
   shared global scope.

   Wave 3 upgrades: toggleable layers (cases / raids / turf / places) that re-weight
   the intensity live, and a created_at time-range slider that windows the data. */
"use strict";

    let HM = { places: [], turf: [], raids: [] };

    // Layer weights drive the intensity score; toggling a layer off drops it from
    // both the score and the per-tile breakdown.
    const HM_LAYER_META = [
      { key: 'cases',  icon: '📂', label: 'Cases',  w: 3 },
      { key: 'raids',  icon: '💥', label: 'Raids',  w: 3 },
      { key: 'turf',   icon: '🚩', label: 'Turf',   w: 2 },
      { key: 'places', icon: '📍', label: 'Places', w: 1 },
    ];
    const HM_LAYERS = { cases: true, raids: true, turf: true, places: true };
    // created_at windows (slider stops). null = no time filter.
    const HM_WINDOWS = [
      { label: 'All time', days: null },
      { label: 'Past year', days: 365 },
      { label: 'Past 90 days', days: 90 },
      { label: 'Past 30 days', days: 30 },
      { label: 'Past 7 days', days: 7 },
    ];
    let HM_WIN = 0;

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
      renderHeatmapControls();
      renderHeatmap();
    }
    function onEnterHeatmap() { if (dbReady()) fetchHeatmap(); else renderHeatmap(); }

    // Layer chips + time-range slider. Rendered once per entry; handlers mutate
    // state and re-render only the grid (so the slider keeps focus while dragging).
    function renderHeatmapControls() {
      const box = $('#hm-controls'); if (!box) return;
      if (!dbReady()) { box.innerHTML = ''; return; }
      const chips = HM_LAYER_META.map((L) => `<button class="hm-layer rounded-lg border px-3 py-1.5 text-xs font-semibold transition" data-k="${L.key}" aria-pressed="${HM_LAYERS[L.key]}">${L.icon} ${L.label}</button>`).join('');
      box.innerHTML = `
        <div class="flex flex-wrap items-center gap-2">${chips}</div>
        <div class="mt-3 flex w-full items-center gap-3">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Window</span>
          <input id="hm-window" type="range" min="0" max="${HM_WINDOWS.length - 1}" step="1" value="${HM_WIN}" class="h-1.5 flex-1 cursor-pointer accent-blue-500" />
          <span id="hm-window-label" class="min-w-[6.5rem] text-right text-xs font-medium text-slate-200">${HM_WINDOWS[HM_WIN].label}</span>
        </div>`;
      const paint = () => box.querySelectorAll('.hm-layer').forEach((b) => {
        const on = HM_LAYERS[b.dataset.k];
        b.className = 'hm-layer rounded-lg border px-3 py-1.5 text-xs font-semibold transition ' + (on ? 'border-blue-500/40 bg-blue-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-500');
        b.setAttribute('aria-pressed', on);
      });
      paint();
      box.querySelectorAll('.hm-layer').forEach((b) => b.onclick = () => { HM_LAYERS[b.dataset.k] = !HM_LAYERS[b.dataset.k]; paint(); renderHeatmap(); });
      const slider = $('#hm-window'), label = $('#hm-window-label');
      if (slider) {
        slider.oninput = () => { if (label) label.textContent = HM_WINDOWS[Number(slider.value)].label; };
        slider.onchange = () => { HM_WIN = Number(slider.value); renderHeatmap(); };
      }
    }

    function renderHeatmap() {
      const grid = $('#hm-grid'), notice = $('#hm-notice'), legend = $('#hm-legend'); if (!grid) return;
      if (!dbReady()) { if (notice) { notice.classList.remove('hidden'); notice.textContent = 'Sign in to view the Commander Heatmap.'; } grid.innerHTML = ''; if (legend) legend.textContent = ''; const c = $('#hm-controls'); if (c) c.innerHTML = ''; return; }
      if (notice) notice.classList.add('hidden');

      const enabled = HM_LAYER_META.filter((L) => HM_LAYERS[L.key]);
      if (!enabled.length) { grid.innerHTML = '<p class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-500">No layers selected — enable at least one layer above.</p>'; if (legend) legend.textContent = ''; return; }

      // created_at window. Records without a creation date are always in-range
      // (standing intel like turf/places may be untimestamped).
      const days = HM_WINDOWS[HM_WIN].days;
      const cutoff = days ? Date.now() - days * 86400000 : null;
      const inWin = (rec) => !cutoff || !rec || !rec.created_at || Date.parse(rec.created_at) >= cutoff;

      // Defensive: strip a trailing ".0" on bare numbers (e.g. legacy imports where
      // a postal/area like "21" came through as "21.0") before grouping/display.
      const norm = (s) => String(s || '').replace(/(\d)\.0\b/g, '$1').trim();
      const areas = {};
      const bump = (area, key) => { const a = norm(area); if (!a) return; (areas[a] = areas[a] || { cases: 0, places: 0, turf: 0, raids: 0 })[key] += 1; };
      const cases = (typeof casesCache !== 'undefined' ? casesCache : []);
      const caseArea = {};
      cases.forEach((c) => { caseArea[c.id] = norm(c.area); });   // area lookup for raids — built from all cases

      if (HM_LAYERS.cases)  cases.filter(inWin).forEach((c) => { if (norm(c.area)) bump(c.area, 'cases'); });
      if (HM_LAYERS.places) HM.places.filter(inWin).forEach((p) => bump(p.area, 'places'));
      if (HM_LAYERS.turf)   HM.turf.filter(inWin).forEach((t) => bump(t.hotspot_area || t.block, 'turf'));
      if (HM_LAYERS.raids)  HM.raids.filter(inWin).forEach((r) => { const a = caseArea[r.case_id]; if (a) bump(a, 'raids'); });

      const scoreOf = (v) => enabled.reduce((s, L) => s + v[L.key] * L.w, 0);
      const rows = Object.keys(areas).map((a) => { const v = areas[a]; return { area: a, v, score: scoreOf(v) }; })
        .filter((r) => r.score > 0).sort((x, y) => y.score - x.score);
      const max = rows.reduce((m, r) => Math.max(m, r.score), 0) || 1;

      if (!rows.length) { grid.innerHTML = '<p class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-500">No area data in this window. Widen the time range, enable more layers, or add an <b>Area</b> to cases, places, or gang turf.</p>'; if (legend) legend.textContent = ''; return; }
      const lvl = (pct) => pct >= 75 ? 'lvl3' : pct >= 50 ? 'lvl2' : pct >= 25 ? 'lvl1' : '';
      grid.innerHTML = rows.map((r) => { const pct = Math.round(r.score / max * 100); return `<div class="hm-tile ${lvl(pct)}">
        <div class="flex items-center justify-between"><h4 class="text-base font-bold text-white">${esc(r.area)}</h4><span class="font-mono text-lg font-bold text-white">${pct}</span></div>
        <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-900"><div class="hm-bar" style="width:${pct}%"></div></div>
        <div class="mt-3 grid grid-cols-2 gap-1 text-[11px] text-slate-300">${enabled.map((L) => `<span>${L.icon} ${r.v[L.key]} ${L.label.toLowerCase()}</span>`).join('')}</div></div>`; }).join('');
      const formula = enabled.map((L) => `${L.label.toLowerCase()}×${L.w}`).join(' + ');
      if (legend) legend.innerHTML = `Intensity = ${esc(formula)}. Window: <span class="text-slate-300">${esc(HM_WINDOWS[HM_WIN].label)}</span> (by creation date). Scoped to cases you can access (bureau + JTF + grants). ${rows.length} area${rows.length === 1 ? '' : 's'}.`;
    }

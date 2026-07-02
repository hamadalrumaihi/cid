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

    /* ---- Stylized San Andreas map: intensity dots by area ------------------
       Rough coastline silhouette (decorative context); known areas get fixed
       positions, everything else stays in the tiles below. */
    const HM_XY = {
      'paleto bay': [30, 10], 'mount chiliad': [40, 20], 'grapeseed': [57, 20], 'sandy shores': [55, 32],
      'grand senora desert': [47, 43], 'harmony': [37, 41], 'blaine county': [62, 28], 'chumash': [13, 58],
      'banham canyon': [18, 64], 'tataviam mountains': [68, 55], 'richman': [28, 72], 'morningwood': [24, 77],
      'vinewood hills': [42, 66], 'vinewood': [46, 73], 'burton': [39, 78], 'rockford hills': [32, 79],
      'downtown los santos': [49, 80], 'mirror park': [58, 76], 'del perro': [20, 80], 'vespucci': [23, 86],
      'vespucci beach': [18, 89], 'little seoul': [34, 85], 'pillbox hill': [47, 85], 'strawberry': [46, 91],
      'davis': [51, 95], 'chamberlain hills': [41, 93], 'la mesa': [58, 85], 'el burro heights': [66, 87],
      'cypress flats': [62, 93], 'murrieta heights': [62, 81], 'rancho': [54, 96], 'port of los santos': [55, 104],
      'la puerta': [36, 93], 'fort zancudo': [22, 40], 'route 68': [40, 48], 'humane labs': [72, 44],
    };
    function renderHeatSvg(rows, max) {
      const box = $('#hm-map'); if (!box) return;
      if (!dbReady() || !rows || !rows.length) { box.innerHTML = ''; return; }
      const placed = rows.filter((r) => HM_XY[r.area.toLowerCase()]);
      if (!placed.length) { box.innerHTML = ''; return; }
      const dotColor = (pct) => pct >= 75 ? '#f43f5e' : pct >= 50 ? '#f59e0b' : '#3b82f6';
      const dots = placed.map((r) => {
        const xy = HM_XY[r.area.toLowerCase()], x = xy[0], y = xy[1];
        const pct = Math.round(r.score / max * 100);
        const rad = 2 + pct / 100 * 4.5;
        const parts = HM_LAYER_META.filter((L) => HM_LAYERS[L.key] && r.v[L.key]).map((L) => r.v[L.key] + ' ' + L.label.toLowerCase()).join(', ');
        return `<g><circle cx="${x}" cy="${y}" r="${rad.toFixed(1)}" fill="${dotColor(pct)}" fill-opacity="0.75" stroke="#0b1120" stroke-width="0.6"><title>${esc(r.area)} \u2014 intensity ${pct} (${esc(parts)})</title></circle>
          <text x="${x}" y="${(y - rad - 1.5).toFixed(1)}" text-anchor="middle" font-size="3.2" fill="#cbd5e1">${esc(r.area.length > 16 ? r.area.slice(0, 15) + '\u2026' : r.area)}</text></g>`;
      }).join('');
      const unplaced = rows.length - placed.length;
      box.innerHTML = `<div class="overflow-hidden rounded-2xl border border-white/5 bg-ink-950/60">
        <svg viewBox="0 0 100 130" preserveAspectRatio="xMidYMid meet" style="width:100%;max-height:520px;height:auto;display:block" role="img" aria-label="San Andreas intensity map">
          <path d="M28,3 C45,1 62,6 68,14 C76,22 80,34 78,46 C86,54 88,66 84,78 C80,92 72,102 60,110 C52,116 40,118 30,112 C18,106 10,96 10,84 C6,72 8,60 14,50 C10,38 12,24 18,14 C21,8 24,5 28,3 Z" fill="#0f1726" stroke="#26385a" stroke-width="0.8" />
          <text x="30" y="7" font-size="3" fill="#64748b">PALETO</text>
          <text x="52" y="38" font-size="3" fill="#64748b">BLAINE COUNTY</text>
          <text x="40" y="102" font-size="3" fill="#64748b">LOS SANTOS</text>
          ${dots}
        </svg>
        <p class="border-t border-white/5 px-4 py-2 text-[11px] text-slate-500">Stylized map \u2014 dot size &amp; color follow area intensity (hover a dot for the breakdown).${unplaced ? ` ${unplaced} area${unplaced === 1 ? '' : 's'} without a map position (postals etc.) appear in the tiles below.` : ''}</p>
      </div>`;
    }
    function renderHeatmap() {
      const grid = $('#hm-grid'), notice = $('#hm-notice'), legend = $('#hm-legend'); if (!grid) return;
      if (!dbReady()) { if (notice) { notice.classList.remove('hidden'); notice.textContent = 'Sign in to view the Commander Heatmap.'; } grid.innerHTML = ''; if (legend) legend.textContent = ''; const c = $('#hm-controls'); if (c) c.innerHTML = ''; const hmm = $('#hm-map'); if (hmm) hmm.innerHTML = ''; return; }
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

      if (!rows.length) { renderHeatSvg([], 1); grid.innerHTML = '<p class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-500">No area data in this window. Widen the time range, enable more layers, or add an <b>Area</b> to cases, places, or gang turf.</p>'; if (legend) legend.textContent = ''; return; }
      renderHeatSvg(rows, max);
      const lvl = (pct) => pct >= 75 ? 'lvl3' : pct >= 50 ? 'lvl2' : pct >= 25 ? 'lvl1' : '';
      grid.innerHTML = rows.map((r) => { const pct = Math.round(r.score / max * 100); return `<div class="hm-tile ${lvl(pct)}">
        <div class="flex items-center justify-between"><h4 class="text-base font-bold text-white">${esc(r.area)}</h4><span class="font-mono text-lg font-bold text-white">${pct}</span></div>
        <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-900"><div class="hm-bar" style="width:${pct}%"></div></div>
        <div class="mt-3 grid grid-cols-2 gap-1 text-[11px] text-slate-300">${enabled.map((L) => `<span>${L.icon} ${r.v[L.key]} ${L.label.toLowerCase()}</span>`).join('')}</div></div>`; }).join('');
      const formula = enabled.map((L) => `${L.label.toLowerCase()}×${L.w}`).join(' + ');
      if (legend) legend.innerHTML = `Intensity = ${esc(formula)}. Window: <span class="text-slate-300">${esc(HM_WINDOWS[HM_WIN].label)}</span> (by creation date). Scoped to cases you can access (bureau + JTF + grants). ${rows.length} area${rows.length === 1 ? '' : 's'}.`;
    }

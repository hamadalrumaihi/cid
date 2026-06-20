/* network.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).

   Wave 2: relationship graph. A hand-rolled SVG ego/overview network — NO new
   dependency — on the Intelligence "Network" sub-tab. Gangs are hubs; persons
   (members) and places (turf/fronts) orbit them. Click any node to re-centre
   the graph on it (ego view); click the centred node to open its intel profile.
   Pan by dragging, zoom with the wheel or the +/− buttons. Also openable centred
   on a person/gang via openIntelGraph() (e.g. from the intel profile slide-over). */
"use strict";

    // Node colours (SVG needs literal fills, not Tailwind classes).
    const NET_FILL = { gang: '#3b82f6', person: '#10b981', place: '#f59e0b' };
    const NET_R    = { gang: 26, person: 16, place: 14 };
    const NET_ICON = { gang: '🚩', person: '👤', place: '📍' };
    const NET_VBW = 1000, NET_VBH = 640;   // virtual canvas; viewBox is centred on origin

    let NET_FOCUS = null;                   // focused node key, or null for overview
    let NET_PENDING = null;                 // focus to apply on next entry (openIntelGraph)
    let NET_VIEW = { tx: 0, ty: 0, k: 1 };  // pan/zoom of the <g> layer
    let NET_GRAPH = null;                   // { nodes, adj }

    function netNotice(m) {
      const w = $('#net-wrap'); if (w) w.innerHTML = `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${esc(m)}</div>`;
    }
    const netTrunc = (s, n = 16) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

    async function onEnterNetwork() {
      if (!dbReady()) { netNotice('Live relationship data requires sign-in.'); return; }
      try {
        await netLoad();
        NET_FOCUS = NET_PENDING && NET_GRAPH.nodes[NET_PENDING] ? NET_PENDING : null;
        NET_PENDING = null;
        NET_VIEW = { tx: 0, ty: 0, k: 1 };
        netRender();
      } catch (e) { netNotice('Could not build network: ' + (e.message || String(e))); }
    }

    // Pull the four entity sets (reuse module caches where populated) and build a
    // node table + undirected adjacency. Persons/places only enter the graph when
    // they have a gang link — unaffiliated records would just be noise here.
    async function netLoad() {
      const gangs   = (typeof GANGS !== 'undefined' && GANGS.length)     ? GANGS   : await DB().list('gangs');
      const persons = (typeof PERSONS !== 'undefined' && PERSONS.length) ? PERSONS : await DB().list('persons');
      const places  = (typeof PLACES !== 'undefined' && PLACES.length)   ? PLACES  : await DB().list('places');
      let members = []; try { members = await DB().list('gang_members'); } catch (e) {}

      const nodes = {}, adj = {};
      const add = (key, type, label, sub) => { if (!nodes[key]) { nodes[key] = { key, type, label, sub, id: key.slice(key.indexOf(':') + 1) }; adj[key] = new Set(); } };
      const link = (a, b) => { if (a === b || !nodes[a] || !nodes[b]) return; adj[a].add(b); adj[b].add(a); };

      gangs.forEach((g) => add('g:' + g.id, 'gang', g.name || 'Gang', cap(g.threat_level || '') + (g.threat_level ? ' threat' : '')));
      const personById = {}; persons.forEach((p) => { personById[p.id] = p; });

      // persons.gang_id → gang
      persons.forEach((p) => { if (p.gang_id && nodes['g:' + p.gang_id]) { add('p:' + p.id, 'person', p.name || 'Person', p.alias || p.status || ''); link('p:' + p.id, 'g:' + p.gang_id); } });
      // gang_members linking an existing person ↔ gang
      members.forEach((m) => { if (m.person_id && m.gang_id && nodes['g:' + m.gang_id] && personById[m.person_id]) { const p = personById[m.person_id]; add('p:' + p.id, 'person', p.name || 'Person', p.alias || p.status || ''); link('p:' + p.id, 'g:' + m.gang_id); } });
      // places.controlling_gang_id → gang
      places.forEach((pl) => { if (pl.controlling_gang_id && nodes['g:' + pl.controlling_gang_id]) { add('pl:' + pl.id, 'place', pl.name || 'Place', pl.type || ''); link('pl:' + pl.id, 'g:' + pl.controlling_gang_id); } });

      NET_GRAPH = { nodes, adj };
    }

    // Deterministic layout. Focus → ego ring; otherwise gangs on a big circle with
    // their satellites in small circles. Returns positions + the visible node set.
    function netLayout() {
      const { nodes, adj } = NET_GRAPH, pos = {}, visible = new Set();
      if (NET_FOCUS && nodes[NET_FOCUS]) {
        pos[NET_FOCUS] = { x: 0, y: 0 }; visible.add(NET_FOCUS);
        const neigh = [...adj[NET_FOCUS]].filter((k) => nodes[k]);
        const n = neigh.length, R = Math.max(170, Math.min(300, 90 + n * 16));
        neigh.forEach((k, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(n, 1); pos[k] = { x: R * Math.cos(a), y: R * Math.sin(a) }; visible.add(k); });
      } else {
        const gangs = Object.values(nodes).filter((nd) => nd.type === 'gang');
        const ng = gangs.length, R = ng <= 1 ? 0 : Math.max(220, Math.min(430, 120 + ng * 40));
        gangs.forEach((gn, i) => {
          const ga = -Math.PI / 2 + 2 * Math.PI * i / Math.max(ng, 1), gx = R * Math.cos(ga), gy = R * Math.sin(ga);
          pos[gn.key] = { x: gx, y: gy }; visible.add(gn.key);
          const sat = [...adj[gn.key]].filter((k) => nodes[k] && !pos[k]);
          const m = sat.length, r = Math.max(70, Math.min(150, 40 + m * 12));
          sat.forEach((k, j) => { const a = 2 * Math.PI * j / Math.max(m, 1); pos[k] = { x: gx + r * Math.cos(a), y: gy + r * Math.sin(a) }; visible.add(k); });
        });
      }
      return { pos, visible };
    }

    function netRender() {
      const wrap = $('#net-wrap'); if (!wrap) return;
      const { nodes, adj } = NET_GRAPH;
      if (!Object.keys(nodes).length) { netNotice('No relationships on file yet. Link persons or places to a gang, then revisit.'); return; }
      const { pos, visible } = netLayout();
      const focusNd = NET_FOCUS ? nodes[NET_FOCUS] : null;

      // Edges (dedup by sorted pair), then nodes drawn on top.
      const drawn = new Set(); let edges = '';
      visible.forEach((a) => adj[a].forEach((b) => {
        if (!visible.has(b)) return; const key = a < b ? a + '|' + b : b + '|' + a; if (drawn.has(key)) return; drawn.add(key);
        edges += `<line x1="${pos[a].x.toFixed(1)}" y1="${pos[a].y.toFixed(1)}" x2="${pos[b].x.toFixed(1)}" y2="${pos[b].y.toFixed(1)}" stroke="#334155" stroke-width="1.5" />`;
      }));
      let circles = '';
      visible.forEach((k) => {
        const nd = nodes[k], p = pos[k], r = NET_R[nd.type], isF = k === NET_FOCUS;
        circles += `<g class="net-node" data-key="${k}" style="cursor:pointer">
          ${isF ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 7}" fill="none" stroke="#e2e8f0" stroke-width="2" />` : ''}
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${NET_FILL[nd.type]}" fill-opacity="0.9" stroke="#0b1120" stroke-width="2" />
          <text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-size="${nd.type === 'gang' ? 15 : 12}">${NET_ICON[nd.type]}</text>
          <text x="${p.x.toFixed(1)}" y="${(p.y + r + 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="#cbd5e1">${esc(netTrunc(nd.label))}</text>
        </g>`;
      });

      const vb = `${-NET_VBW / 2} ${-NET_VBH / 2} ${NET_VBW} ${NET_VBH}`;
      const focusLabel = focusNd ? `${NET_ICON[focusNd.type]} ${esc(focusNd.label)}` : 'Overview — all gangs & their networks';
      const canProfile = focusNd && (focusNd.type === 'gang' || focusNd.type === 'person');
      wrap.innerHTML = `
        <div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-900/60 p-4">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Relationship network</p>
            <h3 class="truncate text-lg font-bold text-white">${focusLabel}</h3>
            <p class="mt-0.5 text-xs text-slate-500">${visible.size} node${visible.size === 1 ? '' : 's'} shown · click a node to re-centre${focusNd ? ' · click the centre to open its profile' : ''}</p>
          </div>
          <div class="flex flex-shrink-0 flex-wrap items-center gap-2">
            <span class="hidden items-center gap-3 text-[11px] text-slate-400 sm:flex">
              <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full" style="background:${NET_FILL.gang}"></span>Gang</span>
              <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full" style="background:${NET_FILL.person}"></span>Person</span>
              <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full" style="background:${NET_FILL.place}"></span>Place</span>
            </span>
            ${canProfile ? '<button id="net-profile" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10">🔎 Profile</button>' : ''}
            ${NET_FOCUS ? '<button id="net-overview" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">⌂ Overview</button>' : ''}
            <button id="net-zin" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">＋</button>
            <button id="net-zout" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">－</button>
            <button id="net-reset" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">↺</button>
          </div>
        </div>
        <div class="overflow-hidden rounded-2xl border border-white/5 bg-ink-950/60">
          <svg id="net-svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;aspect-ratio:${NET_VBW}/${NET_VBH};touch-action:none;cursor:grab;display:block">
            <g id="net-zoom">${edges}${circles}</g>
          </svg>
        </div>`;

      netApplyTransform();
      netWire();
    }

    function netApplyTransform() {
      const g = $('#net-zoom'); if (g) g.setAttribute('transform', `translate(${NET_VIEW.tx} ${NET_VIEW.ty}) scale(${NET_VIEW.k})`);
    }

    function netSetFocus(key) { NET_FOCUS = key; NET_VIEW = { tx: 0, ty: 0, k: 1 }; netRender(); }

    function netWire() {
      const svg = $('#net-svg'); if (!svg) return;
      const nodes = NET_GRAPH.nodes;
      const pf = $('#net-profile'); if (pf) pf.onclick = () => { const nd = nodes[NET_FOCUS]; if (nd && typeof openIntelProfile === 'function') openIntelProfile(nd.type, nd.id); };
      const ov = $('#net-overview'); if (ov) ov.onclick = () => netSetFocus(null);
      const zoomBy = (f) => { NET_VIEW.k = Math.max(0.3, Math.min(3, NET_VIEW.k * f)); NET_VIEW.tx *= f; NET_VIEW.ty *= f; netApplyTransform(); };
      const zin = $('#net-zin'); if (zin) zin.onclick = () => zoomBy(1.2);
      const zout = $('#net-zout'); if (zout) zout.onclick = () => zoomBy(1 / 1.2);
      const rst = $('#net-reset'); if (rst) rst.onclick = () => { NET_VIEW = { tx: 0, ty: 0, k: 1 }; netApplyTransform(); };

      // Wheel zoom (about centre — simple and predictable).
      svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

      // Drag to pan; suppress the node click if the pointer actually moved.
      let dragging = false, moved = false, sx = 0, sy = 0, stx = 0, sty = 0;
      const ratio = () => NET_VBW / (svg.clientWidth || NET_VBW);
      svg.addEventListener('pointerdown', (e) => { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; stx = NET_VIEW.tx; sty = NET_VIEW.ty; svg.style.cursor = 'grabbing'; });
      svg.addEventListener('pointermove', (e) => { if (!dragging) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; const rr = ratio(); NET_VIEW.tx = stx + dx * rr; NET_VIEW.ty = sty + dy * rr; netApplyTransform(); });
      const end = () => { dragging = false; svg.style.cursor = 'grab'; };
      svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end); svg.addEventListener('pointerleave', end);

      $$('.net-node', svg).forEach((g) => g.addEventListener('click', () => {
        if (moved) return; const key = g.dataset.key, nd = nodes[key];
        if (key === NET_FOCUS) { if (nd.type === 'gang' || nd.type === 'person') { if (typeof openIntelProfile === 'function') openIntelProfile(nd.type, nd.id); } else if (typeof navigate === 'function') navigate('places'); return; }
        netSetFocus(key);
      }));
    }

    // Entry point used elsewhere (e.g. intel profile slide-over) to jump straight
    // to the Network tab centred on a given person/gang.
    function openIntelGraph(type, id) {
      NET_PENDING = (type === 'gang' ? 'g:' : 'p:') + id;
      if (typeof navigate === 'function') navigate('network');
    }

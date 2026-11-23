/* Marathon Trainer: visual extras. Virtual Boston, fitness/form, route map, training bloom, ghost runner.
   Loaded before app.js; uses its helpers and state at call time (S, activities, weekStats, racePlan, …). */
'use strict';

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- Strava polyline decoding ---------- */
function decodePoly(str) {
  const pts = []; let i = 0, lat = 0, lng = 0;
  while (str && i < str.length) {
    for (const k of [0, 1]) {
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= str.length);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

/* =====================================================================
   1 · Virtual Boston: training miles laid end to end along the course
   ===================================================================== */
function journeyData() {
  const rr = runs().slice().sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  let tot = 0; const laps = [];
  for (const r of rr) {
    const before = Math.floor(tot / 26.2); tot += r.miles;
    for (let l = before + 1; l <= Math.floor(tot / 26.2); l++) laps.push({ n: l, date: r.date });
  }
  const pos = tot % 26.2, lap = Math.floor(tot / 26.2) + 1;
  const passed = BOS_MARKS.filter(m => m[0] <= pos + 1e-6), ahead = BOS_MARKS.filter(m => m[0] > pos + 1e-6);
  const last = passed[passed.length - 1], next = ahead[0];
  // miles still planned between now and race day (not counting the race itself)
  let futureMi = 0;
  if (S.plan) for (const w of weekStats()) {
    if (w.past || w.phase === 'Race') continue;
    futureMi += w.started ? Math.max(0, w.planMi - w.mi) : w.planMi;
  }
  return { tot, laps, pos, lap, last, next, futureMi, projected: (tot + futureMi) / 26.2, runs: rr };
}
const journeyWhere = J => (J.next && J.next[0] - J.pos < 0.6 ? `approaching ${J.next[1]}` : J.last && J.pos - J.last[0] < 0.8 ? `passing ${J.last[1]}` : J.next ? `${(J.next[0] - J.pos).toFixed(1)} mi to ${J.next[1]}` : 'on Boylston');

function journeyCard() {
  if (!S.plan) return '';
  const J = journeyData(); if (!J.tot) return '';
  return `<button class="card race-link journey-link" data-act="goto-journey"><span>🦄</span><div><b>Virtual Boston · lap ${J.lap}</b>
    <div class="note">Mile ${J.pos.toFixed(1)}, ${esc(journeyWhere(J))}</div>
    <div class="jl-bar"><i style="width:${(J.pos / 26.2 * 100).toFixed(1)}%"></i></div></div><span class="chev">›</span></button>`;
}

function viewJourney() {
  if (!S.plan) return emptyPlan();
  const J = journeyData(), { W, H, top, bot } = PF;
  const x = mi => (mi / 26.2) * W, y = e => bot - (e / 520) * (bot - top);
  const pts = BOS_ELEV.map((e, i) => [x(Math.min(i, 26.2)), y(e)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = `${line}L${W},${bot}L0,${bot}Z`;
  const elevAt = mi => { const i = Math.min(26, Math.floor(mi)), f = mi - i; return BOS_ELEV[i] + (BOS_ELEV[i + 1] - BOS_ELEV[i]) * (i === 26 ? f / 0.2 : f); };
  const rx = x(J.pos), ry = y(elevAt(J.pos));
  const marks = BOS_MARKS.filter(m => m[0] > 0 && m[0] < 26.2);
  const lapTiles = Array.from({ length: Math.max(J.lap, Math.ceil(J.projected)) }, (_, i) => {
    const n = i + 1, done = J.laps.find(l => l.n === n);
    return `<div class="lap ${done ? 'done' : n === J.lap ? 'now' : 'future'}" title="Lap ${n}${done ? ' · finished ' + fmtDate(done.date) : ''}">
      ${n === J.lap ? `<i style="height:${(J.pos / 26.2 * 100).toFixed(0)}%"></i>` : ''}<span>${n}</span></div>`;
  }).join('');
  const recent = J.laps.slice(-6).reverse().map(l => {
    const prev = J.laps.find(p => p.n === l.n - 1);
    return `<div class="lap-row"><b>Lap ${l.n}</b><span>${fmtDate(l.date)}</span><span class="muted">${prev ? daysBetween(prev.date, l.date) + ' days' : 'first Boston!'}</span></div>`;
  }).join('');
  return `<div class="card race-head">
      <div class="k">You are on Boston lap</div><div class="hero-num">${J.lap}</div>
      <div class="hero-sub">Mile ${J.pos.toFixed(1)} · ${esc(journeyWhere(J))}</div>
      <div class="note" style="margin-top:6px">${Math.round(J.tot)} training miles = <b>${(J.tot / 26.2).toFixed(1)} Bostons</b></div></div>

    <div class="card chart-card">
      <h3>Where you are on the course</h3><div class="sub">Each training mile moves you along Hopkinton → Boylston. Finish a lap and you start again.</div>
      <svg class="profile journey" viewBox="0 0 ${W} ${H}" role="img" aria-label="Runner at mile ${J.pos.toFixed(1)} of the Boston course">
        <defs><clipPath id="jclip"><rect x="0" y="0" width="${rx.toFixed(1)}" height="${H}"/></clipPath></defs>
        <path d="${area}" class="pf-area"/><path d="${line}" class="pf-line" style="opacity:.35"/>
        <g clip-path="url(#jclip)"><path d="${area}" class="j-done-area"/><path d="${line}" class="pf-line"/></g>
        ${marks.map(m => `<circle cx="${x(m[0]).toFixed(1)}" cy="${y(elevAt(m[0])).toFixed(1)}" r="5" class="${m[0] <= J.pos ? 'j-m-on' : 'j-m-off'}"/>`).join('')}
        ${[0, 5, 10, 15, 20, 25].map(m => `<text x="${x(m)}" y="${H - 16}" class="pf-tick" text-anchor="${m ? 'middle' : 'start'}">${m || 'mi 0'}</text>`).join('')}
        <circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="18" class="j-pulse"/>
        <circle cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" r="10" class="pf-dot"/>
        <text x="${Math.min(W - 60, Math.max(60, rx)).toFixed(1)}" y="${Math.max(24, ry - 26).toFixed(1)}" class="pf-label" text-anchor="middle">You</text>
      </svg>
      <div class="j-marks">${marks.map(m => `<span class="${m[0] <= J.pos ? 'on' : ''}">${m[0] <= J.pos ? '✓' : '○'} ${esc(m[1])}</span>`).join('')}</div>
    </div>

    <h2>Laps</h2>
    <div class="card"><div class="laps">${lapTiles}</div>
      <div class="note" style="margin-top:10px">Finish your plan and you'll have run about <b>${J.projected.toFixed(1)} Bostons</b> in training before running the real one on ${fmtDate(S.plan.race.date)}.</div></div>
    ${recent ? `<div class="card list">${recent}</div>` : ''}`;
}

/* =====================================================================
   2 · Fitness / fatigue / form (training load model)
   ===================================================================== */
// Training stress per workout: hours × intensity² × 100, intensity from pace vs. an estimated threshold pace.
function stressOf(a) {
  const P = S.plan.race, thr = P.goalPace * 0.93;
  if (a.isRun && a.miles > 0) { const sec = a.sec || a.miles * P.easyPace, IF = Math.min(1.15, thr / (sec / a.miles)); return sec / 3600 * IF * IF * 100; }
  if (a.isXT) { const sec = a.sec || 2700, IF = a.effort ? 0.55 + a.effort * 0.04 : 0.75; return sec / 3600 * IF * IF * 100; }
  return 0;
}
function fitnessSeries() {
  const P = S.plan.race, weeks = weekStats(), load = {};
  const add = (d, v) => { load[d] = (load[d] || 0) + v; };
  for (const a of activities()) if (a.date <= TODAY) add(a.date, stressOf(a));
  // project the rest of the plan forward
  const paceOf = s => (s.kind === 'quick' ? P.quickPace : s.kind === 'race' ? P.goalPace : P.easyPace);
  for (const w of weeks) {
    if (w.past) continue;
    const free = []; for (let i = 0; i < 7; i++) { const d = addDays(w.start, i); if (d > TODAY) free.push(d); }
    if (!free.length) continue;
    const pick = pref => { const d = addDays(w.start, pref); return d > TODAY ? d : free[free.length - 1]; };
    for (const s of w.sessions) {
      if (s.done) continue;
      const d = s.kind === 'race' ? P.date : pick({ run1: 2, run2: 4, long: 6 }[s.key] ?? 6);
      add(d, stressOf({ isRun: true, miles: s.mi, sec: s.mi * paceOf(s) }));
    }
    const xt = Math.max(0, (w.xtTarget || 0) - w.xt);
    [1, 3, 5].slice(0, xt).forEach(o => add(pick(o), stressOf({ isXT: true })));
  }
  const start = addDays(S.plan.weeks[0].start, -56), end = addDays(P.date, 2);
  let ctl = 0, atl = 0; const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const form = ctl - atl, L = load[d] || 0;
    ctl += (L - ctl) / 42; atl += (L - atl) / 7;
    if (d >= S.plan.weeks[0].start) out.push({ d, ctl, atl, form, load: L, future: d > TODAY });
  }
  return out;
}
const formStatus = f => (f >= 5 && f <= 25 ? 'good' : f > -5 && f < 35 ? 'warn' : 'bad');
function fitnessCard() {
  if (!S.plan) return '';
  const F = fitnessSeries(), now = F.filter(p => !p.future).pop() || F[0], race = F.find(p => p.d === S.plan.race.date);
  const peak = F.filter(p => !p.future).reduce((m, p) => (p.ctl > m ? p.ctl : m), 0);
  const L = (cls, color, label) => `<span><i class="${cls}" style="background:${color}"></i>${label}</span>`;
  const fst = race ? formStatus(race.form) : null;
  return `<div class="card chart-card"><h3>Fitness, fatigue &amp; form</h3>
    <div class="sub">Fitness builds slowly; fatigue spikes after hard weeks. <b>Form</b> = fitness − fatigue, and you want it fresh (positive) on race day. Dashed = your plan from here.</div>
    <div class="legend">${L('', 'var(--series-1)', 'Fitness') + L('', 'var(--series-2)', 'Fatigue') + L('', 'var(--series-3)', 'Form')}</div>
    <div class="chart-wrap tall"><canvas id="c-fit" role="img" aria-label="Fitness, fatigue and form over the training plan"></canvas></div>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="k">Fitness now</div><div class="v">${Math.round(now.ctl)}</div><div class="s">peak so far ${Math.round(peak)}</div></div>
      <div class="stat"><div class="k">Form now</div><div class="v">${now.form >= 0 ? '+' : ''}${Math.round(now.form)}</div><div class="s">${now.form < -20 ? 'deep in a block' : now.form < -5 ? 'training hard' : now.form < 5 ? 'balanced' : 'fresh'}</div></div>
      <div class="stat ${fst ? 'st-' + fst : ''}"><div class="k">Race-day form</div><div class="v">${race ? (race.form >= 0 ? '+' : '') + Math.round(race.form) : '–'}</div><div class="s">${fst === 'good' ? 'taper lands right' : fst === 'warn' ? 'close to ideal' : fst ? 'check the taper' : ''}</div></div></div>
    <div class="note" style="margin-top:8px">Estimated from pace and time on feet (cross-training counted lightly). Ideal race-day form is about +5 to +25.</div></div>`;
}
function drawFitness() {
  const el = document.getElementById('c-fit'); if (!el || typeof Chart === 'undefined') return;
  const F = fitnessSeries(), C = { s1: cssVar('--series-1'), s2: cssVar('--series-2'), s3: cssVar('--series-3'), grid: cssVar('--grid'), text: cssVar('--text'), surface: cssVar('--surface'), muted: cssVar('--muted'), crit: cssVar('--critical') };
  const ti = F.findIndex(p => p.future), ri = F.findIndex(p => p.d === S.plan.race.date);
  const dash = ctx => (F[ctx.p1DataIndex]?.future ? [5, 4] : undefined);
  const marker = { id: 'mtMarkers', afterDatasetsDraw(ch) {
    const { ctx, chartArea: a, scales: { x } } = ch;
    [[ti - 1, 'Today', C.muted], [ri, 'Race', C.crit]].forEach(([i, lab, col]) => {
      if (i < 0) return; const X = x.getPixelForValue(i);
      ctx.save(); ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X, a.top); ctx.lineTo(X, a.bottom); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = col; ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign = i === ri ? 'right' : 'center'; ctx.fillText(lab, i === ri ? X - 3 : X, a.top + 10); ctx.restore();
    });
  } };
  const ds = (label, key, color, w) => ({ label, data: F.map(p => +p[key].toFixed(1)), borderColor: color, backgroundColor: color, borderWidth: w, pointRadius: 0, pointHoverRadius: 4, tension: 0.25, segment: { borderDash: dash } });
  S.charts.push(new Chart(el, {
    type: 'line', plugins: [marker],
    data: { labels: F.map(p => p.d), datasets: [ds('Fitness', 'ctl', C.s1, 2.5), ds('Fatigue', 'atl', C.s2, 1.5), ds('Form', 'form', C.s3, 2)] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: C.text, titleColor: C.surface, bodyColor: C.surface, padding: 10, cornerRadius: 8, boxPadding: 4,
        callbacks: { title: i => `${fmtDate(F[i[0].dataIndex].d)}${F[i[0].dataIndex].future ? ' · planned' : ''}`, label: c => ` ${c.dataset.label}: ${c.raw > 0 && c.dataset.label === 'Form' ? '+' : ''}${Math.round(c.raw)}` } } },
      scales: {
        x: { grid: { display: false }, border: { color: C.grid }, ticks: { maxRotation: 0, autoSkip: false, callback: (v, i) => { const d = parseISO(F[i].d); return d.getDate() === 1 ? MON[d.getMonth()] : ''; } } },
        y: { grid: { color: C.grid }, border: { display: false } },
      },
    },
  }));
}

/* =====================================================================
   3 · Route map: every Strava run route
   ===================================================================== */
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletP) return leafletP;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
  leafletP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; s.onload = res; s.onerror = () => { leafletP = null; rej(new Error('Map library did not load. Check your connection.')); }; document.head.appendChild(s); });
  return leafletP;
}
const routeRuns = () => S.acts.filter(a => a.isRun && a.poly).map(a => ({ ...a, pts: decodePoly(a.poly) })).filter(a => a.pts.length > 1);
function viewRoutes() {
  const all = S.acts.filter(a => a.isRun && a.poly);
  if (!stravaConnected()) return `<div class="card empty"><div class="big">🗺️</div><p><b>Your routes come from Strava</b></p><p class="note">Connect Strava in Settings and every run you've recorded will be drawn here.</p><button class="btn" data-act="goto-settings">Go to Settings</button></div>`;
  if (!all.length) return `<div class="card empty"><div class="big">🗺️</div><p><b>No routes yet</b></p><p class="note">Sync Strava to pull in the GPS routes for your runs. Treadmill runs have no route.</p><button class="btn strava" data-act="sync">Sync now</button></div>`;
  const mi = sum(all, a => a.miles);
  return `<div class="seg">${[['map', 'Map'], ['art', 'Art']].map(([k, l]) => `<button data-mapmode="${k}" class="${S.mapMode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="map-wrap ${S.mapMode}"><div id="rmap"></div>
      <div class="map-chips">${[['all', 'All'], ['30', '30 days'], ['long', 'Long runs']].map(([k, l]) => `<button data-mapf="${k}" class="${S.mapFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="card tight" id="map-detail"><div class="note">Tap a route to see the run. Brighter streets are the ones you run most.</div></div>
    <div class="stats"><div class="stat"><div class="k">Routes</div><div class="v">${all.length}</div></div>
      <div class="stat"><div class="k">GPS miles</div><div class="v">${Math.round(mi)}</div></div>
      <div class="stat"><div class="k">Longest</div><div class="v">${mi1(Math.max(...all.map(a => a.miles)))}</div></div></div>`;
}
async function initRouteMap() {
  const el = document.getElementById('rmap'); if (!el) return;
  try { await loadLeaflet(); } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!document.getElementById('rmap')) return;
  if (S.map) { S.map.remove(); S.map = null; }
  const dark = matchMedia('(prefers-color-scheme: dark)').matches || document.documentElement.dataset.theme === 'dark';
  const map = S.map = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true });
  // OpenStreetMap tiles, muted to gray (and inverted in dark mode) by CSS so the routes stand out.
  el.classList.toggle('tiles-dark', dark);
  if (S.mapMode === 'map') L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  else map.attributionControl.setPrefix(false);
  const cut = addDays(TODAY, -30);
  const rr = routeRuns().filter(a => S.mapFilter === 'all' || (S.mapFilter === '30' ? a.date >= cut : a.miles >= 10));
  const color = S.mapMode === 'art' ? '#ff7a3d' : cssVar('--series-2'), hi = cssVar('--series-1');
  let sel = null;
  const lines = rr.map(a => {
    const pl = L.polyline(a.pts, { color, weight: S.mapMode === 'art' ? 1.8 : 2.5, opacity: S.mapMode === 'art' ? 0.38 : 0.5, interactive: true });
    pl.on('click', () => {
      if (sel) sel.setStyle({ color, weight: S.mapMode === 'art' ? 1.8 : 2.5, opacity: S.mapMode === 'art' ? 0.38 : 0.5 });
      sel = pl; pl.setStyle({ color: S.mapMode === 'art' ? '#ffffff' : hi, weight: 5, opacity: 1 }); pl.bringToFront();
      document.getElementById('map-detail').innerHTML = `<div class="run tappable" data-sid="${a.id}" style="padding:0"><div class="date"><b>${parseISO(a.date).getDate()}</b><span>${MON[parseISO(a.date).getMonth()]}</span></div>
        <div class="grow"><div class="nm">${esc(a.name)}</div><div class="meta">${fmtDur(a.sec)} · ${fmtPace(a.sec / a.miles)}/mi${a.hr ? ' · ♥ ' + Math.round(a.hr) : ''} · tap for splits</div></div><div class="mi">${mi1(a.miles)}<small>mi</small></div></div>`;
    });
    return pl.addTo(map);
  });
  if (!rr.length) { map.setView([42.35, -71.06], 11); document.getElementById('map-detail').innerHTML = '<div class="note">No routes match this filter.</div>'; return; }
  // frame the "home" area (where most runs start) so one travel run doesn't zoom the map out
  const st = rr.map(a => a.pts[0]), med = k => st.map(p => p[k]).sort((a, b) => a - b)[Math.floor(st.length / 2)];
  const home = [med(0), med(1)], near = rr.filter(a => Math.hypot(a.pts[0][0] - home[0], (a.pts[0][1] - home[1]) * 0.74) < 0.3);
  map.fitBounds(L.latLngBounds((near.length ? near : rr).flatMap(a => a.pts)), { padding: [18, 18] });
  setTimeout(() => map.invalidateSize(), 60);
  void lines;
}

/* =====================================================================
   4 · Training bloom: the whole block as a flower
   ===================================================================== */
function bloomKind(r, weeks) {
  if (S.plan && r.date === S.plan.race.date && r.miles > 20) return 'race';
  const w = weeks.find(x => r.date >= x.start && r.date < x.end);
  if (w && w.sessions.some(s => s.kind === 'long' && s.run === r)) return 'long';
  if (r.miles >= 10) return 'long';
  if (r.sec && r.sec / r.miles < S.plan.race.goalPace + 10) return 'quick';
  return 'easy';
}
function bloomSVG(opts = {}) {
  const P = S.plan.race, weeks = weekStats(), start = S.plan.weeks[0].start, end = P.date, span = daysBetween(start, end) + 1;
  const SZ = 640, c = SZ / 2, r0 = 64, rMax = 270, scale = (rMax - r0) / 26.2;
  const col = { easy: cssVar('--series-1'), quick: cssVar('--series-2'), long: cssVar('--series-3'), race: cssVar('--critical'), plan: cssVar('--plan'), text: cssVar('--text'), muted: cssVar('--muted'), surface: cssVar('--surface'), xt: cssVar('--text-2') };
  const ang = d => ((daysBetween(start, d) + 0.5) / span) * 2 * Math.PI - Math.PI / 2;
  const pt = (a, r) => [c + Math.cos(a) * r, c + Math.sin(a) * r];
  const petal = (d, mi, fill, stroke, extra, off = 0) => {
    const a = ang(d) + off, len = Math.max(10, mi * scale), w = Math.min(15, 4 + mi * 0.55) / 2;
    const [bx, by] = pt(a, r0), [tx, ty] = pt(a, r0 + len), [mx, my] = pt(a, r0 + len * 0.55), nx = -Math.sin(a) * w * 1.6, ny = Math.cos(a) * w * 1.6;
    return `<path d="M${bx.toFixed(1)},${by.toFixed(1)} Q${(mx + nx).toFixed(1)},${(my + ny).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} Q${(mx - nx).toFixed(1)},${(my - ny).toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}Z" fill="${fill}" stroke="${stroke}" ${extra}/>`;
  };
  const rr = runs().filter(r => r.date >= start && r.date <= end).sort((a, b) => b.miles - a.miles);
  const perDay = {};
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SZ} ${SZ}" class="bloom" role="img" aria-label="Training bloom: ${rr.length} runs">`;
  if (opts.bg) s += `<rect width="${SZ}" height="${SZ}" fill="${opts.bg}"/>`;
  // guide rings at 10 and 20 miles
  [10, 20].forEach(m => { s += `<circle cx="${c}" cy="${c}" r="${r0 + m * scale}" fill="none" stroke="${col.muted}" stroke-opacity=".25" stroke-dasharray="2 5"/><text x="${c + 4}" y="${c - r0 - m * scale - 4}" font-size="11" fill="${col.muted}">${m} mi</text>`; });
  // planned runs still to come: outline petals
  if (!opts.noPlan) for (const w of weeks) {
    if (w.past) continue;
    w.sessions.filter(x => !x.done).forEach(x => {
      const d = x.kind === 'race' ? P.date : addDays(w.start, { run1: 2, run2: 4, long: 6 }[x.key] ?? 6);
      if (d > TODAY) s += petal(d, x.mi, col.plan, col.plan, 'fill-opacity=".16" stroke-width="1.3" stroke-dasharray="3 2.5"');
    });
  }
  // runs done: biggest first so short runs sit on top
  for (const r of rr) {
    const k = bloomKind(r, weeks), n = (perDay[r.date] = (perDay[r.date] || 0) + 1) - 1;
    s += petal(r.date, r.miles, col[k], opts.bg || col.surface, `stroke-width="1.2" fill-opacity=".9" data-bloom="${esc(r.id)}" class="petal"`, n * 0.012);
  }
  // cross-training: dots inside the core
  activities().filter(a => a.isXT && a.date >= start && a.date <= end).forEach(a => { const [x, y] = pt(ang(a.date), r0 - 12); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${col.xt}" fill-opacity=".75"/>`; });
  // month ticks
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dd = parseISO(d); if (dd.getDate() !== 1 && d !== start) continue;
    const a = ang(d), [x1, y1] = pt(a, rMax + 6), [x2, y2] = pt(a, rMax + 14), [lx, ly] = pt(a, rMax + 30);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col.muted}"/><text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="600" fill="${col.muted}">${MON[dd.getMonth()]}</text>`;
  }
  // today hand + race marker
  if (TODAY >= start && TODAY <= end) { const [x1, y1] = pt(ang(TODAY), r0 - 4), [x2, y2] = pt(ang(TODAY), rMax + 4); s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col.text}" stroke-opacity=".5" stroke-width="1.5"/>`; }
  { const [x, y] = pt(ang(end), rMax + 4); s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${col.race}"/>`; }
  const tot = sum(rr, r => r.miles);
  s += `<text x="${c}" y="${c + 2}" text-anchor="middle" font-size="30" font-weight="800" fill="${col.text}">${Math.round(tot)}</text>
    <text x="${c}" y="${c + 22}" text-anchor="middle" font-size="12" fill="${col.muted}">miles</text>`;
  if (opts.title) s += `<text x="${c}" y="40" text-anchor="middle" font-size="22" font-weight="800" fill="${col.text}">${esc(opts.title)}</text>`;
  return s + '</svg>';
}
function viewBloom() {
  if (!S.plan) return emptyPlan();
  const L = (color, label, ring) => `<span><i style="background:${ring ? 'transparent' : color};${ring ? `border:1.5px dashed ${color};` : ''}"></i>${label}</span>`;
  const rr = runs().filter(r => r.date >= S.plan.weeks[0].start), weeks = weekStats();
  const k = { easy: 0, quick: 0, long: 0 }; rr.forEach(r => { const x = bloomKind(r, weeks); if (k[x] != null) k[x]++; });
  return `<div class="card chart-card"><h3>Your training bloom</h3>
    <div class="sub">Every run of the plan is a petal: the angle is the date (clockwise from ${fmtDate(S.plan.weeks[0].start)} to race day), the length is the miles. Dashed petals are runs still to come, and it fills in as you train.</div>
    <div class="legend">${L('var(--series-1)', `Easy · ${k.easy}`) + L('var(--series-2)', `Quicker · ${k.quick}`) + L('var(--series-3)', `Long · ${k.long}`) + L('var(--plan)', 'Planned', true) + L('var(--text-2)', 'Cross-train')}</div>
    <div class="bloom-wrap" id="bloom">${bloomSVG()}</div>
    <div class="hm-detail" id="bloom-detail">Tap a petal to see the run.</div>
    <button class="btn secondary" data-act="bloom-save">Save as image</button></div>`;
}
function showBloomRun(id) {
  const r = runs().find(x => String(x.id) === String(id)); if (!r) return;
  document.querySelectorAll('.petal.sel').forEach(p => p.classList.remove('sel'));
  document.querySelector(`.petal[data-bloom="${CSS.escape(String(id))}"]`)?.classList.add('sel');
  document.getElementById('bloom-detail').innerHTML = `<b>${DOW[parseISO(r.date).getDay()]} ${fmtDate(r.date)}</b> · ${esc(r.name)} · ${mi1(r.miles)} mi${r.sec ? ' @ ' + fmtPace(r.sec / r.miles) + '/mi' : ''}`;
}
async function saveBloom() {
  const bg = cssVar('--surface') || '#ffffff';
  const svg = bloomSVG({ bg, noPlan: false, title: `${S.plan.race.name} · training bloom` });
  const img = new Image(), url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace('<svg ', '<svg width="1800" height="1800" '));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const cv = document.createElement('canvas'); cv.width = cv.height = 1800;
  const g = cv.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 1800, 1800); g.drawImage(img, 0, 0, 1800, 1800);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const file = new File([blob], 'training-bloom.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Training bloom' }); } catch {} return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'training-bloom.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* =====================================================================
   5 · Ghost runner: a run's miles vs. a pace ghost
   ===================================================================== */
async function runDetail(id) {
  if (S.det[id]) return S.det[id];
  const tok = await ensureToken();
  const r = await fetch(`https://www.strava.com/api/v3/activities/${id}`, { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error('Strava error ' + r.status);
  const j = await r.json();
  const d = { splits: (j.splits_standard || []).map(s => ({ d: s.distance / 1609.344, t: s.moving_time, hr: s.average_heartrate || null, el: (s.elevation_difference || 0) * 3.28084 })), poly: j.map?.polyline || j.map?.summary_polyline || '' };
  S.det[id] = d;
  const keys = Object.keys(S.det); if (keys.length > 80) delete S.det[keys[0]];
  save('mt.det', S.det);
  return d;
}
function routeSVG(poly, size = 120) {
  const pts = decodePoly(poly); if (pts.length < 2) return '';
  const lat0 = pts.reduce((m, p) => m + p[0], 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
  const xs = pts.map(p => p[1] * k), ys = pts.map(p => -p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), sc = (size - 12) / Math.max(x1 - x0, y1 - y0, 1e-6);
  const ox = (size - (x1 - x0) * sc) / 2, oy = (size - (y1 - y0) * sc) / 2;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(ox + (xs[i] - x0) * sc).toFixed(1)},${(oy + (ys[i] - y0) * sc).toFixed(1)}`).join('');
  return `<svg class="route-mini" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--series-2)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
const GHOSTS = [['easy', 'Easy'], ['quick', 'Quicker'], ['goal', 'Goal pace'], ['boston', 'Boston plan']];
function ghostPace(kind, mileIdx) {
  const P = S.plan.race;
  if (kind === 'boston') { const seg = racePlan(P.goalSec); return seg[Math.min(seg.length - 1, mileIdx % 26)].pace; }
  return kind === 'easy' ? P.easyPace : kind === 'quick' ? P.quickPace : P.goalPace;
}
function ghostHTML(a, det, kind) {
  const splits = det && det.splits.length ? det.splits.filter(s => s.d > 0.05) : [{ d: a.miles, t: a.sec, hr: a.hr, el: 0 }];
  let you = 0, ghost = 0;
  const rows = splits.map((s, i) => {
    const g = ghostPace(kind, i) * s.d; you += s.t; ghost += g;
    return { i, s, pace: s.t / s.d, gp: g / s.d, diff: g - s.t, gap: ghost - you };   // diff > 0 = you were faster
  });
  const gap = ghost - you, maxD = Math.max(15, ...rows.map(r => Math.abs(r.diff)));
  const fmtGap = v => `${v >= 0 ? '' : '−'}${fmtDur(Math.abs(v))}`;
  // race strip: where the ghost was when you finished (or you when it finished)
  const lead = gap >= 0, yourPos = lead ? 1 : you > 0 ? ghost / you : 1, ghostPos = lead ? (you / ghost) : 1;
  const W = 600, H = 150, pad = 34, n = rows.length, xs = i => pad + (i / n) * (W - pad * 2), maxG = Math.max(20, ...rows.map(r => Math.abs(r.gap)));
  const yg = v => H / 2 - (v / maxG) * (H / 2 - 16);
  const gl = [[0, 0], ...rows.map((r, i) => [i + 1, r.gap])];
  const path = gl.map(([i, v], k) => `${k ? 'L' : 'M'}${xs(i).toFixed(1)},${yg(v).toFixed(1)}`).join('');
  const area = `${path}L${xs(n).toFixed(1)},${H / 2}L${xs(0)},${H / 2}Z`;
  return `<div class="ghost-head ${lead ? 'ahead' : 'behind'}">
      <div class="gh-big">${lead ? 'You beat the ghost' : 'The ghost got you'}</div>
      <div class="gh-sub">by <b>${fmtDur(Math.abs(gap))}</b> · ghost ran ${GHOSTS.find(g => g[0] === kind)[1].toLowerCase()}${kind === 'boston' ? ' (Boston mile-by-mile)' : ` at ${fmtPace(ghostPace(kind, 0))}/mi`}</div></div>
    <div class="track" aria-label="Finish positions">
      <div class="lane"><span class="who">You</span><div class="tk"><i class="dot you" style="left:${(yourPos * 100).toFixed(1)}%"></i></div></div>
      <div class="lane"><span class="who">👻</span><div class="tk"><i class="dot ghost" style="left:${(ghostPos * 100).toFixed(1)}%"></i></div></div></div>
    ${n > 1 ? `<div class="sub" style="margin-top:12px">Gap to the ghost, mile by mile (above the line = ahead)</div>
    <svg viewBox="0 0 ${W} ${H}" class="gap-chart" role="img" aria-label="Gap to ghost by mile">
      <defs><clipPath id="gc-up"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath><clipPath id="gc-dn"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath></defs>
      <line x1="${pad}" x2="${W - pad}" y1="${H / 2}" y2="${H / 2}" stroke="var(--plan)" stroke-dasharray="4 4"/>
      <path d="${area}" fill="var(--series-1)" fill-opacity=".25" clip-path="url(#gc-up)"/><path d="${area}" fill="var(--series-2)" fill-opacity=".25" clip-path="url(#gc-dn)"/>
      <path d="${path}" fill="none" stroke="var(--text-2)" stroke-width="2"/>
      ${rows.map((r, i) => `<circle cx="${xs(i + 1).toFixed(1)}" cy="${yg(r.gap).toFixed(1)}" r="4" fill="${r.gap >= 0 ? 'var(--series-1)' : 'var(--series-2)'}" stroke="var(--surface)" stroke-width="1.5"/>`).join('')}
      <text x="${pad - 6}" y="${yg(maxG) + 4}" text-anchor="end" class="gc-t">+${fmtDur(maxG)}</text><text x="${pad - 6}" y="${yg(-maxG) + 4}" text-anchor="end" class="gc-t">−${fmtDur(maxG)}</text>
    </svg>` : ''}
    <div class="gsplits">${rows.map(r => `<div class="gs"><span class="gm">${r.s.d < 0.95 ? mi1(r.s.d) : r.i + 1}</span><b>${fmtPace(r.pace)}</b>
        <span class="gbar"><i class="${r.diff >= 0 ? 'up' : 'dn'}" style="width:${(Math.abs(r.diff) / maxD * 50).toFixed(1)}%"></i></span>
        <span class="gd ${r.diff >= 0 ? 'up' : 'dn'}">${r.diff >= 0 ? '−' : '+'}${Math.abs(Math.round(r.diff / r.s.d))}s</span></div>`).join('')}</div>
    <div class="note" style="margin-top:6px">Per mile: <span class="gd up">−s</span> = faster than the ghost, <span class="gd dn">+s</span> = slower.${det ? '' : ' Mile splits will show once Strava details load.'} Final gap ${fmtGap(gap)}.</div>`;
}
async function openRun(id) {
  const a = activities().find(x => String(x.id) === String(id)) || S.acts.find(x => String(x.id) === String(id)); if (!a) return;
  const weeks = weekStats(), w = weeks.find(x => a.date >= x.start && a.date < x.end);
  const sess = w?.sessions.find(s => s.run && s.run.id === a.id);
  let kind = sess?.kind === 'quick' ? 'quick' : sess?.kind === 'race' ? 'boston' : 'easy';
  closeSheet();
  document.body.insertAdjacentHTML('beforeend', `<div class="sheet-bg" id="sheet"><div class="sheet run-sheet">
    <div class="sheet-h"><span></span><b>${esc(a.name)}</b><button type="button" class="link strong" data-close>Done</button></div>
    <div class="rd-top"><div id="rd-route" class="rd-route">${a.poly ? routeSVG(a.poly) : ''}</div>
      <div class="rd-stats"><div><span class="muted">${DOW[parseISO(a.date).getDay()]} ${fmtDate(a.date)}${a.time ? ' · ' + a.time : ''}</span></div>
        <div class="rd-big">${mi1(a.miles)}<small> mi</small></div>
        <div>${fmtDur(a.sec)} · <b>${fmtPace(a.sec / a.miles)}</b>/mi${a.hr ? ` · ♥ ${Math.round(a.hr)}` : ''}${a.elev ? ` · ↗ ${Math.round(a.elev)} ft` : ''}</div>
        ${sess ? `<div class="note">Plan: ${esc(sess.label)}</div>` : ''}</div></div>
    <h3 style="margin:14px 0 6px">👻 Ghost runner</h3>
    <div class="seg" id="ghost-seg">${GHOSTS.map(([k, l]) => `<button type="button" data-ghost="${k}" class="${k === kind ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="ghost">${ghostHTML(a, null, kind)}</div></div></div>`);
  document.body.style.overflow = 'hidden';
  const bg = document.getElementById('sheet');
  let det = null;
  bg.addEventListener('click', e => {
    if (e.target === bg || e.target.closest('[data-close]')) { closeSheet(); return; }
    const g = e.target.closest('[data-ghost]'); if (!g) return;
    kind = g.dataset.ghost; bg.querySelectorAll('[data-ghost]').forEach(b => b.classList.toggle('on', b === g));
    document.getElementById('ghost').innerHTML = ghostHTML(a, det, kind);
  });
  if (a.source === 'strava' && stravaConnected()) {
    try {
      det = await runDetail(a.id);
      if (!document.getElementById('ghost')) return;
      document.getElementById('ghost').innerHTML = ghostHTML(a, det, kind);
      if (det.poly) document.getElementById('rd-route').innerHTML = routeSVG(det.poly);
    } catch (e) { console.error(e); toast('Could not load mile splits: ' + e.message, 4000); }
  }
}

/* ---------- Explore row (top of Charts) ---------- */
function exploreRow() {
  if (!S.plan) return '';
  const J = journeyData();
  return `<div class="explore">
    <button class="xp" data-act="goto-journey"><span class="xi">🦄</span><b>Virtual Boston</b><span>Lap ${J.lap} · mi ${J.pos.toFixed(1)}</span></button>
    <button class="xp" data-act="goto-routes"><span class="xi">🗺️</span><b>Route map</b><span>Every run you've drawn</span></button>
    <button class="xp" data-act="goto-bloom"><span class="xi">🌸</span><b>Training bloom</b><span>Your block as a flower</span></button></div>`;
}

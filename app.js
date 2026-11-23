/* Marathon Trainer — single-file app logic (no build step). */
'use strict';

/* ---------- storage ---------- */
const load = (k, d = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const S = {
  plan: load('mt.plan'),
  strava: load('mt.strava', {}),
  acts: load('mt.acts', []),
  lastSync: load('mt.lastSync'),
  // Every workout lives here: history imported from the spreadsheet (source 'import') and
  // ones logged in the app (source 'app'). All of them can be edited or deleted.
  workouts: load('mt.workouts', null),
  tab: 'today',
  runFilter: 'all',
  charts: [],
};

/* ---------- date + format helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const TODAY = (() => { const q = new URLSearchParams(location.search).get('today'); return /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : iso(new Date()); })();
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const fmtDate = s => { const d = parseISO(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const fmtPace = sec => { if (!isFinite(sec) || sec <= 0) return '–'; sec = Math.round(sec); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
const fmtDur = sec => { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`; };
const fmtHM = sec => { sec = Math.round(sec); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec % 3600 / 60))}`; };
const mi1 = n => (Math.round(n * 10) / 10).toFixed(1);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0);
const riegel = (miles, sec) => sec * Math.pow(26.2 / miles, 1.06);

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- spreadsheet import ---------- */
const serialToISO = n => { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const fracToSec = n => Math.round(n * 86400);
const isNum = v => typeof v === 'number' && isFinite(v);

function parseWorkbook(wb, fileName) {
  const ws = wb.Sheets['Training'] || wb.Sheets[wb.SheetNames[0]];
  return parseRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }), fileName);
}
// rows: 2-D array of cell values; dates/durations as spreadsheet serial numbers.
function parseRows(rows, fileName) {
  const str =v => (typeof v === 'string' ? v.trim() : '');

  // value to the right of a label cell
  const labelVal = re => {
    for (const r of rows) for (let c = 0; c < r.length; c++) {
      if (re.test(str(r[c]))) for (let k = c + 1; k <= c + 3 && k < r.length; k++) if (isNum(r[k])) return r[k];
    }
    return null;
  };

  // plan table
  let hRow = -1, H = {};
  rows.some((r, i) => { const ix = r.findIndex(v => str(v) === 'Wk'); if (ix >= 0 && r.some(v => str(v) === 'Week Start')) { hRow = i; r.forEach((v, c) => { if (str(v)) H[str(v)] = c; }); return true; } return false; });
  if (hRow < 0) throw new Error('Could not find the plan table (header row with "Wk" and "Week Start").');
  const col = (...names) => { for (const n of names) for (const k in H) if (k.toLowerCase().startsWith(n.toLowerCase())) return H[k]; return -1; };
  const C = {
    wk: H['Wk'], start: H['Week Start'], phase: col('Phase'),
    run1: col('Run 1: '), run1Mi: col('Run 1 Mi'), run2: col('Run 2: '), run2Mi: col('Run 2 Mi'),
    long: col('Run 3'), longNotes: col('Long Run Notes'), planMi: col('Plan Mi'), xt: col('Cross-Train'),
  };
  const g = (r, c) => (c >= 0 ? r[c] : null);
  const dash = v => (str(v) && !/^[–—-]$/.test(str(v)) && str(v) !== '�' ? str(v) : '');
  const weeks = [];
  for (let i = hRow + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!isNum(r[C.wk]) || !isNum(r[C.start])) { if (weeks.length) break; else continue; }
    const longMi = +g(r, C.long) || 0;
    weeks.push({
      wk: r[C.wk], start: serialToISO(r[C.start]), phase: str(g(r, C.phase)) || '',
      run1: dash(g(r, C.run1)), run1Mi: +g(r, C.run1Mi) || 0,
      run2: dash(g(r, C.run2)), run2Mi: +g(r, C.run2Mi) || 0,
      longMi, longNotes: dash(g(r, C.longNotes)),
      planMi: +g(r, C.planMi) || 0, xtTarget: +g(r, C.xt) || 0,
    });
  }
  if (!weeks.length) throw new Error('Plan table was empty.');

  // run log (Date / Miles / Time / F45)
  const log = [];
  const lh = rows.findIndex(r => r.some(v => str(v) === 'Date') && r.some(v => str(v) === 'Miles'));
  if (lh >= 0) {
    const L = {}; rows[lh].forEach((v, c) => { if (str(v)) L[str(v)] ??= c; });
    for (let i = lh + 1; i < rows.length; i++) {
      const r = rows[i]; if (!isNum(r[L.Date])) continue;
      const miles = +r[L.Miles] || 0, t = r[L.Time];
      log.push({ date: serialToISO(r[L.Date]), miles, sec: isNum(t) ? fracToSec(t) : 0, xt: L.F45 != null && +r[L.F45] > 0 });
    }
  }

  const raceSerial = labelVal(/^Race date \(/i) ?? labelVal(/^Race date/i);
  const goalFrac = labelVal(/^Goal finish time/i);
  const dist = labelVal(/^Marathon distance/i) || 26.2;
  const goalSec = goalFrac ? fracToSec(goalFrac) : 12600;
  const goalPace = labelVal(/^Goal pace/i);
  const easy = labelVal(/^Easy pace \(/i);
  const quick = labelVal(/^Quicker run pace/i);
  const easyOffF = labelVal(/^Easy pace offset/i), quickOffF = labelVal(/^Quicker-run offset/i);
  // half-marathon benchmark block
  let bench = null;
  const bi = rows.findIndex(r => r.some(v => /benchmark/i.test(str(v))));
  if (bi >= 0) {
    const bc = rows[bi].findIndex(v => /benchmark/i.test(str(v)));
    const near = (re) => { for (let i = bi + 1; i < Math.min(rows.length, bi + 8); i++) if (re.test(str(rows[i][bc])) && isNum(rows[i][bc + 1])) return rows[i][bc + 1]; return null; };
    const bd = near(/^Race date/i);
    let bdist = near(/^Distance/i), bt = near(/^Finish time/i);
    if (bd && (!bdist || !bt)) { const l = log.find(x => x.date === serialToISO(bd) && x.miles > 0); if (l) { bdist = l.miles; bt = l.sec / 86400; } }
    if (bd && bdist && bt) bench = { date: serialToISO(bd), miles: bdist, sec: fracToSec(bt), name: String(rows[bi][bc]).trim() };
  }

  const lastLong = weeks[weeks.length - 1];
  const gp = goalFrac ? goalSec / dist : goalPace ? fracToSec(goalPace) : goalSec / dist;
  const easyOff = easyOffF != null ? fracToSec(easyOffF) : easy ? fracToSec(easy) - gp : 75;
  const quickOff = quickOffF != null ? fracToSec(quickOffF) : quick ? gp - fracToSec(quick) : 25;
  const race = {
    date: raceSerial ? serialToISO(raceSerial) : addDays(lastLong.start, 1),
    goalSec, distance: dist, easyOff, quickOff,
    goalPace: gp,
    easyPace: gp + easyOff,
    quickPace: gp - quickOff,
    name: (rows.flat().find(v => /marathon.*plan/i.test(str(v))) || 'Marathon').replace(/\s*[–—-]?\s*sandbox.*$/i, '').replace(/\s*plan$/i, '').trim(),
  };
  return { race, weeks, log, bench, fileName, importedAt: new Date().toISOString() };
}

/* ---------- starting data: import from a spreadsheet, then the app owns it ---------- */
// Turn the spreadsheet's run log into editable workouts.
function historyWorkouts(plan) {
  const out = [];
  plan.log.forEach((l, i) => {
    if (l.miles > 0) out.push({ id: `imp-r${i}-${l.date}`, source: 'import', date: l.date, start: '', type: 'Run', title: '', miles: l.miles, sec: l.sec, hr: null, effort: null, notes: '' });
    if (l.xt) out.push({ id: `imp-x${i}-${l.date}`, source: 'import', date: l.date, start: '', type: 'F45', title: '', miles: 0, sec: 0, hr: null, effort: null, notes: '' });
  });
  return out;
}
function adoptPlan(plan, from) {
  const hadPlan = !!S.plan;
  if (hadPlan && !confirm(`Replace your plan and goal with the one from ${from}? Plan edits you made in the app will be replaced. Workouts you logged in the app are kept.`)) return false;
  plan.source = from;
  S.plan = plan; save('mt.plan', plan);
  const mine = (S.workouts || []).filter(w => w.source !== 'import');
  const hist = historyWorkouts(plan);
  // Imported history wins up to its last date; keep app-logged workouts that aren't duplicates of it.
  const dup = w => hist.some(h => h.date === w.date && h.type === w.type && Math.abs((h.miles || 0) - (w.miles || 0)) < 0.05);
  setWorkouts([...hist, ...mine.filter(w => !dup(w))]);
  return true;
}
function setWorkouts(list) {
  S.workouts = list.sort((a, b) => ((a.date + (a.start || '')) < (b.date + (b.start || '')) ? 1 : -1));
  save('mt.workouts', S.workouts);
}
// Older installs stored history only inside the plan: convert once.
if (S.plan && !S.workouts) setWorkouts(historyWorkouts(S.plan));
if (!S.workouts) S.workouts = [];

async function importFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const plan = parseWorkbook(wb, file.name);
    if (!adoptPlan(plan, file.name)) return;
    toast(`Imported ${plan.weeks.length} weeks and ${plan.log.length} logged days`);
    render();
  } catch (e) {
    console.error(e); toast('Import failed: ' + e.message, 5000);
  }
}

/* Google Sheet import (one-time pull through the Apps Script web app) */
S.gsheet = load('mt.gsheet', null); // remembers the link so re-importing is one tap
function parseGsLink(s) {
  const m = String(s || '').trim().match(/^(https:\/\/script\.google(?:usercontent)?\.com\/[^#\s]+)#(.+)$/);
  return m ? { url: m[1], key: decodeURIComponent(m[2]) } : null;
}
async function importSheet(text) {
  const link = typeof text === 'string' ? parseGsLink(text) : text;
  if (!link) return toast('Paste the full link: the web app URL, then # and your key', 5000);
  try {
    const r = await fetch(`${link.url}?key=${encodeURIComponent(link.key)}&t=${Date.now()}`);
    if (!r.ok) throw new Error('Google Sheet link error ' + r.status);
    let j; try { j = await r.json(); } catch { throw new Error('The Google Sheet link did not return data'); }
    if (!j.ok) throw new Error(j.error || 'Google Sheet error');
    const plan = parseRows(j.rows, j.name || 'Google Sheet');
    if (!adoptPlan(plan, `Google Sheet “${j.name}”`)) return;
    S.gsheet = { ...link, name: j.name }; save('mt.gsheet', S.gsheet);
    toast(`Imported ${plan.weeks.length} weeks from “${j.name}”`); render();
  } catch (e) { console.error(e); toast(e.message, 6000); }
}

/* ---------- editing (everything saves on this device) ---------- */
const withMiles = (text, oldMi, newMi) => (text && oldMi !== newMi ? text.replace(new RegExp(`\\b${String(oldMi).replace('.', '\\.')}(\\s*mi\\b)`), `${newMi}$1`) : text);
async function saveWeek(i, f) {
  const w = S.plan.weeks[i];
  Object.assign(w, f); w.planMi = +(f.run1Mi + f.run2Mi + f.longMi).toFixed(2);
  save('mt.plan', S.plan);
}
async function saveGoals(goalSec, easyOff, quickOff) {
  const r = S.plan.race, gp = goalSec / r.distance;
  Object.assign(r, { goalSec, easyOff, quickOff, goalPace: gp, easyPace: gp + easyOff, quickPace: gp - quickOff });
  save('mt.plan', S.plan);
}
const parseClock = s => { const t = String(s).trim(); if (!t) return NaN; const p = t.split(':').map(Number); if (p.some(isNaN) || p.length > 3) return NaN; return p.reduce((a, x) => a * 60 + x, 0); };

function openSheet(html, onSubmit, savedMsg = 'Saved') {
  closeSheet();
  document.body.insertAdjacentHTML('beforeend', `<div class="sheet-bg" id="sheet"><form class="sheet" id="sheet-form" autocomplete="off" novalidate>${html}</form></div>`);
  document.body.style.overflow = 'hidden';
  const bg = document.getElementById('sheet'), form = document.getElementById('sheet-form');
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    try { const msg = await onSubmit(new FormData(form)); closeSheet(); render(); toast(msg || savedMsg); }
    catch (err) { console.error(err); toast(err.message, 5000); btn.disabled = false; }
  });
  return form;
}
function closeSheet() { document.getElementById('sheet')?.remove(); document.body.style.overflow = ''; }
const sheetHead = (title, saveLabel = 'Save') => `<div class="sheet-h"><button type="button" class="link" data-close>Cancel</button><b>${title}</b><button type="submit" class="link strong">${saveLabel}</button></div>`;
const saveNote = () => '';

/* ---------- log / edit a workout (Strava-style) ---------- */
const WTYPES = [['Run', '🏃', 'Run'], ['F45', '🔥', 'F45'], ['Strength', '🏋️', 'Strength'], ['HIIT', '⚡', 'HIIT']];
const partOfDay = start => { const h = +(start || '12').slice(0, 2); return h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'; };
const defaultTitle = (type, start) => `${partOfDay(start)} ${type === 'Run' ? 'Run' : type === 'F45' ? 'F45' : type === 'HIIT' ? 'HIIT' : 'Strength Workout'}`;
const EFFORT = ['', 'Easy', 'Easy', 'Moderate', 'Moderate', 'Moderate', 'Hard', 'Hard', 'Very hard', 'Very hard', 'Max effort'];

function editWorkout(id) {
  const now = new Date();
  const w = id ? S.workouts.find(x => x.id === id) : null;
  if (id && !w) return;
  const v = w || { type: 'Run', date: TODAY, start: `${pad(now.getHours())}:${pad(now.getMinutes())}`, title: '', miles: '', sec: 0, hr: '', effort: '', notes: '' };
  const form = openSheet(`${sheetHead(w ? 'Edit workout' : 'Log workout', w ? 'Save' : 'Save')}
    <div class="seg type-seg" role="radiogroup">${WTYPES.map(([k, ic, l]) => `<label><input type="radio" name="type" value="${k}" ${v.type === k ? 'checked' : ''}><span>${ic} ${l}</span></label>`).join('')}</div>
    <label class="f">Title</label><input name="title" type="text" value="${esc(v.title)}" placeholder="${esc(defaultTitle(v.type, v.start))}">
    <div class="row2 even"><div><label class="f">Date</label><input name="date" type="date" value="${v.date}" max="${addDays(TODAY, 1)}"></div>
      <div><label class="f">Start time</label><input name="start" type="time" value="${v.start || ''}"></div></div>
    <div class="row2 even"><div class="run-only"><label class="f">Distance (mi)</label><input name="miles" type="number" step="0.01" min="0" inputmode="decimal" value="${v.miles || ''}" placeholder="0.00"></div>
      <div><label class="f">Moving time</label><input name="time" type="text" inputmode="numeric" value="${v.sec ? fmtDur(v.sec) : ''}" placeholder="h:mm:ss"></div></div>
    <div class="pace-line run-only" id="pace-line"></div>
    <div class="row2 even"><div><label class="f">Avg heart rate</label><input name="hr" type="number" min="40" max="230" inputmode="numeric" value="${v.hr ? Math.round(v.hr) : ''}" placeholder="bpm"></div><div></div></div>
    <label class="f">How did it feel? <span id="effort-label" class="muted"></span></label>
    <input name="effort" type="range" min="0" max="10" step="1" value="${v.effort || 0}" class="effort">
    <div class="effort-scale"><span>Skip</span><span>Easy</span><span>Moderate</span><span>Hard</span><span>Max</span></div>
    <label class="f">Notes</label><textarea name="notes" rows="3" placeholder="How did it go? Shoes, weather, fueling…">${esc(v.notes)}</textarea>
    ${w ? '<button type="button" class="btn danger" data-act="delete-workout">Delete workout</button>' : ''}`,
  fd => {
    const type = fd.get('type') || 'Run', isRun = type === 'Run';
    const sec = parseClock(fd.get('time')), miles = isRun ? +fd.get('miles') || 0 : 0;
    const date = fd.get('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Pick a date');
    if (isRun && !(miles > 0)) throw new Error('Enter the distance');
    if (fd.get('time') && !(sec > 0)) throw new Error('Use a time like 32:15 or 1:05:30');
    if (isRun && !(sec > 0)) throw new Error('Enter the moving time');
    const rec = {
      id: w ? w.id : `app-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, source: w ? w.source : 'app',
      date, start: fd.get('start') || '', type, title: fd.get('title').trim(), miles, sec: sec > 0 ? sec : 0,
      hr: +fd.get('hr') || null, effort: +fd.get('effort') || null, notes: fd.get('notes').trim(),
    };
    setWorkouts([...S.workouts.filter(x => x.id !== rec.id), rec]);
    return w ? 'Workout updated' : `${isRun ? mi1(miles) + ' mi run' : type} logged`;
  });
  const sync = () => {
    const fd = new FormData(form), type = fd.get('type'), isRun = type === 'Run';
    form.querySelectorAll('.run-only').forEach(el => (el.style.display = isRun ? '' : 'none'));
    form.elements.title.placeholder = defaultTitle(type, fd.get('start'));
    const sec = parseClock(fd.get('time')), mi = +fd.get('miles');
    document.getElementById('pace-line').innerHTML = isRun && sec > 0 && mi > 0 ? `Pace <b>${fmtPace(sec / mi)}</b> /mi` : '';
    const e = +fd.get('effort');
    document.getElementById('effort-label').textContent = e ? `${e}/10 · ${EFFORT[e]}` : '';
  };
  form.addEventListener('input', sync); form.addEventListener('change', sync); sync();
  form.querySelector('[data-act=delete-workout]')?.addEventListener('click', () => {
    if (!confirm('Delete this workout?')) return;
    setWorkouts(S.workouts.filter(x => x.id !== w.id)); closeSheet(); render(); toast('Workout deleted');
  });
}

/* ---------- fundraising (GivenGain, read through the Google Apps Script link) ---------- */
S.fund = load('mt.fund', null);     // { url, id, data, at }
S.thanks = load('mt.thanks', {});   // donation id -> true once thanked
const ggId = url => (String(url || '').trim().match(/givengain\.com\/project\/(?:[^?#]*?-)?(\d+)(?:[/?#]|$)/) || String(url || '').trim().match(/^(\d+)$/) || [])[1];
const money = (n, cents) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
async function loadFund(manual) {
  if (!S.fund?.id) return;
  if (!S.gsheet) { if (manual) toast('The donation tracker uses your Google Sheet link. Import from it once in Settings → Starting data.', 5000); return; }
  try {
    const r = await fetch(`${S.gsheet.url}?key=${encodeURIComponent(S.gsheet.key)}&action=donations&project=${S.fund.id}&t=${Date.now()}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Donation tracker error');
    if (j.total == null) throw new Error('Your Google script needs the donation update (see README)');
    const before = S.fund.data?.donations?.length;
    S.fund = { ...S.fund, data: j, at: Date.now() }; save('mt.fund', S.fund);
    const added = before != null ? j.donations.length - before : 0;
    if (manual || added > 0) toast(added > 0 ? `🎉 ${added} new donation${added > 1 ? 's' : ''}! ${money(j.total)} raised` : `Donations updated: ${money(j.total)} raised`, 4000);
    render();
  } catch (e) { console.error(e); if (manual) toast(e.message, 6000); }
}
function shareFund() {
  const url = S.fund?.url; if (!url) return;
  const d = S.fund.data;
  const text = d ? `I'm running the 2027 Boston Marathon for the Boys & Girls Club of Lawrence. ${money(d.total)} raised so far. Help me reach ${money(d.target)}!` : 'Support my Boston Marathon fundraiser';
  if (navigator.share) navigator.share({ title: d?.title || 'My Boston Marathon fundraiser', text, url }).catch(() => {});
  else { navigator.clipboard?.writeText(url); toast('Link copied'); }
}
function fundBar(d) {
  const top = Math.max(d.target || 0, d.total || 0, d.minimum || 0) || 1;
  const pct = Math.min(100, (d.total / top) * 100), minPct = d.minimum ? (d.minimum / top) * 100 : null;
  return `<div class="fbar" role="img" aria-label="${money(d.total)} of ${money(d.target)} raised"><div class="fill${d.minimum && d.total >= d.minimum ? ' met' : ''}" style="width:${pct}%"></div>${minPct && minPct < 100 ? `<i class="tick" style="left:${minPct}%"></i>` : ''}</div>
    <div class="fbar-l"><span>${Math.floor((d.total / (d.target || top)) * 100)}% of ${money(d.target)}</span>${d.minimum ? `<span>${d.total >= d.minimum ? '✓ ' + money(d.minimum) + ' minimum met' : money(d.minimum - d.total) + ' to ' + money(d.minimum) + ' minimum'}</span>` : ''}</div>`;
}
function fundCard() {
  if (!S.fund?.id) return '';
  const d = S.fund.data;
  if (!d) return `<div class="card fund-card" data-act="goto-fund"><div class="t">Fundraising</div><div class="note">Loading your GivenGain page…</div></div>`;
  const last = d.donations[0];
  return `<h2 class="h2-row">Fundraising <button class="chip-btn" data-act="share-fund">Share</button></h2>
    <div class="card fund-card tappable" data-act="goto-fund">
    <div class="fund-top"><div><div class="hero-num" style="font-size:30px">${money(d.total)}</div><div class="hero-sub">raised for Boys &amp; Girls Club of Lawrence</div></div><div class="chev">›</div></div>
    ${fundBar(d)}
    ${last ? `<div class="note" style="margin-top:8px">Latest: <b>${esc(last.donor)}</b> ${money(last.amount)} · ${fmtDate(last.date.slice(0, 10))}${last.message ? ` · “${esc(last.message.slice(0, 60))}${last.message.length > 60 ? '…' : ''}”` : ''}</div>` : ''}</div>`;
}
function viewFund() {
  const f = S.fund, d = f?.data;
  if (!d) return `<div class="card empty"><p><b>Fundraising tracker</b></p><p class="note">Add your GivenGain page in Settings → Fundraising.</p><button class="btn" data-act="goto-settings">Open Settings</button></div>`;
  const named = d.donations.filter(x => x.donor !== 'Anonymous');
  const toThank = named.filter(x => !S.thanks[x.id]).length;
  const avg = d.donations.length ? d.total / d.donations.length : 0;
  const daysLeft = d.deadline ? Math.max(0, daysBetween(TODAY, d.deadline.slice(0, 10))) : null;
  const rows = d.donations.map(x => {
    const anon = x.donor === 'Anonymous', done = !!S.thanks[x.id];
    return `<div class="run donor">
      ${anon ? '<div class="check" style="opacity:.35" title="Anonymous">–</div>' : `<button class="check${done ? ' done' : ''}" data-thank="${esc(x.id)}" aria-label="${done ? 'Thanked' : 'Mark as thanked'}">${done ? '✓' : ''}</button>`}
      <div class="grow"><div class="nm">${esc(x.donor)}${x.offPlatform ? ' <span class="src" style="color:var(--muted)">offline</span>' : ''}</div>
        <div class="meta">${fmtDate(x.date.slice(0, 10))}</div>${x.message ? `<div class="notes">“${esc(x.message)}”</div>` : ''}</div>
      <div class="mi">${money(x.amount)}</div></div>`;
  }).join('');
  return `<button class="chip-btn" data-act="goto-today" style="margin:4px 0 10px">‹ Today</button>
  <div class="card"><div class="hero-num">${money(d.total)}</div><div class="hero-sub" style="margin-bottom:12px">raised of ${money(d.target)} · ${esc(d.title)}</div>${fundBar(d)}</div>
  <div class="stats">
    <div class="stat"><div class="k">Donations</div><div class="v">${d.donations.length}</div><div class="s">avg ${money(avg)}</div></div>
    <div class="stat"><div class="k">To thank</div><div class="v">${toThank}</div><div class="s">of ${named.length} named</div></div>
    <div class="stat"><div class="k">Days left</div><div class="v">${daysLeft ?? '–'}</div><div class="s">${d.deadline ? 'until ' + fmtDate(d.deadline.slice(0, 10)) : ''}</div></div></div>
  <div class="card chart-card" style="margin-top:12px"><h3>Raised over time</h3><div class="sub">Running total vs your target</div>
    <div class="legend"><span><i style="background:var(--series-1)"></i>Raised</span><span><i style="background:var(--series-2)"></i>Target</span>${d.minimum ? '<span><i style="background:var(--series-3)"></i>Minimum</span>' : ''}</div>
    <div class="chart-wrap" style="height:200px"><canvas id="c-fund" role="img" aria-label="Running total raised over time"></canvas></div></div>
  <div class="row2 even" style="margin:12px 0"><button class="btn" data-act="share-fund" style="margin:0">Share my page</button><a class="btn secondary" href="${esc(f.url)}" target="_blank" rel="noopener" style="margin:0;text-decoration:none">Open GivenGain</a></div>
  <h2>Donors <span class="muted" style="text-transform:none;letter-spacing:0">· tap ○ once you've said thanks</span></h2>
  <div class="card list">${rows}</div>
  <p class="note" style="text-align:center">Updated ${new Date(f.at).toLocaleString()} · <a href="#" data-act="fund-refresh">refresh</a></p>`;
}
function drawFundChart() {
  const el = document.getElementById('c-fund'), d = S.fund?.data;
  if (!el || !d || typeof Chart === 'undefined') return;
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  const pts = [...d.donations].sort((a, b) => (a.date < b.date ? -1 : 1));
  let run = 0; const data = pts.map(x => ({ x: new Date(x.date).getTime(), y: (run += x.amount) }));
  if (data.length) data.push({ x: parseISO(TODAY).getTime() + 864e5 / 2, y: run });
  const x0 = data.length ? data[0].x - 2 * 864e5 : Date.now(), x1 = Math.max(Date.now(), data.length ? data[data.length - 1].x : 0) + 2 * 864e5;
  const flat = (y, c) => ({ type: 'line', data: [{ x: x0, y }, { x: x1, y }], borderColor: c, borderWidth: 2, pointRadius: 0, borderDash: [] });
  S.charts.push(new Chart(el, {
    type: 'line',
    data: { datasets: [
      { label: 'Raised', data, borderColor: v('--series-1'), backgroundColor: v('--series-1') + '22', fill: true, stepped: 'before', borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 },
      { label: 'Target', ...flat(d.target, v('--series-2')) },
      ...(d.minimum ? [{ label: 'Minimum', ...flat(d.minimum, v('--series-3')) }] : []),
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      plugins: { legend: { display: false }, tooltip: { filter: i => i.datasetIndex === 0, backgroundColor: v('--text'), titleColor: v('--surface'), bodyColor: v('--surface'), callbacks: { title: i => { const t = new Date(i[0].raw.x); return `${MON[t.getMonth()]} ${t.getDate()}`; }, label: c => ` ${money(c.raw.y)} raised` } } },
      scales: {
        x: { type: 'linear', min: x0, max: x1, grid: { display: false }, border: { color: v('--grid') }, ticks: { color: v('--muted'), maxTicksLimit: 5, maxRotation: 0, callback: val => { const t = new Date(val); return `${MON[t.getMonth()]} ${t.getDate()}`; } } },
        y: { beginAtZero: true, suggestedMax: (d.target || 0) * 1.05, grid: { color: v('--grid') }, border: { display: false }, ticks: { color: v('--muted'), callback: val => '$' + (val >= 1000 ? val / 1000 + 'k' : val) } },
      },
    },
  }));
}

/* ---------- backup ---------- */
function exportBackup() {
  const data = { app: 'marathon-trainer', version: 2, exportedAt: new Date().toISOString(), plan: S.plan, workouts: S.workouts, fund: S.fund ? { url: S.fund.url, id: S.fund.id } : null, thanks: S.thanks };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], `marathon-backup-${TODAY}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'Marathon backup' }).catch(() => {}); return; }
  const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = file.name; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function restoreBackup() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const d = JSON.parse(await inp.files[0].text());
      if (d.app !== 'marathon-trainer' || !d.plan || !Array.isArray(d.workouts)) throw new Error('That isn\'t a Marathon backup file');
      if (!confirm(`Restore the backup from ${new Date(d.exportedAt).toLocaleDateString()}? It replaces your current plan and workouts.`)) return;
      S.plan = d.plan; save('mt.plan', S.plan); setWorkouts(d.workouts);
      if (d.fund) { S.fund = d.fund; save('mt.fund', S.fund); } if (d.thanks) { S.thanks = d.thanks; save('mt.thanks', S.thanks); } toast(`Restored ${d.workouts.length} workouts`); render();
    } catch (e) { toast('Restore failed: ' + e.message, 5000); }
  };
  inp.click();
}

function editWeek(i) {
  const w = S.plan.weeks[i], phases = [...new Set(S.plan.weeks.map(x => x.phase).filter(Boolean))];
  const num = (name, v, step = '0.1') => `<input name="${name}" type="number" step="${step}" min="0" inputmode="decimal" value="${v}">`;
  const form = openSheet(`${sheetHead(`Week ${w.wk} · ${fmtDate(w.start)}`)}
    <label class="f">Phase</label><input name="phase" type="text" list="phase-list" value="${esc(w.phase)}"><datalist id="phase-list">${phases.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
    <div class="row2"><div><label class="f">Run 1</label><input name="run1" type="text" value="${esc(w.run1)}"></div><div><label class="f">Miles</label>${num('run1Mi', w.run1Mi)}</div></div>
    <div class="row2"><div><label class="f">Run 2</label><input name="run2" type="text" value="${esc(w.run2)}"></div><div><label class="f">Miles</label>${num('run2Mi', w.run2Mi)}</div></div>
    <div class="row2"><div><label class="f">Long run notes</label><input name="longNotes" type="text" value="${esc(w.longNotes)}"></div><div><label class="f">Long mi</label>${num('longMi', w.longMi)}</div></div>
    <label class="f">Cross-train sessions</label>${num('xtTarget', w.xtTarget, '1')}
    <p class="note">Week total: <b id="wk-total">${w.planMi}</b> mi</p>${saveNote()}`,
  fd => {
    const n = k => Math.max(0, +fd.get(k) || 0);
    const f = { phase: fd.get('phase').trim(), run1Mi: n('run1Mi'), run2Mi: n('run2Mi'), longMi: n('longMi'), xtTarget: Math.round(n('xtTarget')), longNotes: fd.get('longNotes').trim() };
    f.run1 = withMiles(fd.get('run1').trim(), w.run1Mi, f.run1Mi);
    f.run2 = withMiles(fd.get('run2').trim(), w.run2Mi, f.run2Mi);
    return saveWeek(i, f);
  });
  form.addEventListener('input', () => { const fd = new FormData(form); document.getElementById('wk-total').textContent = +((+fd.get('run1Mi') || 0) + (+fd.get('run2Mi') || 0) + (+fd.get('longMi') || 0)).toFixed(2); });
}

function editGoals() {
  const r = S.plan.race;
  const form = openSheet(`${sheetHead('Race goal')}
    <label class="f">Goal finish time (h:mm:ss)</label><input name="goal" type="text" inputmode="numeric" value="${fmtDur(r.goalSec)}">
    <div class="row2"><div><label class="f">Easy pace: slower than goal by (m:ss)</label><input name="easy" type="text" inputmode="numeric" value="${fmtDur(r.easyOff)}"></div>
    <div><label class="f">Quicker run: faster by (m:ss)</label><input name="quick" type="text" inputmode="numeric" value="${fmtDur(r.quickOff)}"></div></div>
    <p class="note" id="goal-preview"></p>${saveNote()}`,
  fd => {
    const g = parseClock(fd.get('goal')), e = parseClock(fd.get('easy')), q = parseClock(fd.get('quick'));
    if (!(g > 3600) || !(e >= 0) || !(q >= 0)) throw new Error('Use times like 3:30:00 and 1:15');
    return saveGoals(g, e, q);
  });
  const prev = () => {
    const fd = new FormData(form), g = parseClock(fd.get('goal')), e = parseClock(fd.get('easy')), q = parseClock(fd.get('quick'));
    const gp = g / r.distance;
    document.getElementById('goal-preview').innerHTML = g > 3600 ? `Goal pace <b>${fmtPace(gp)}</b>/mi · easy <b>${fmtPace(gp + (e || 0))}</b> · quicker <b>${fmtPace(gp - (q || 0))}</b>` : '';
  };
  form.addEventListener('input', prev); prev();
}

function pickFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  inp.onchange = () => inp.files[0] && importFile(inp.files[0]);
  inp.click();
}

/* ---------- Strava ---------- */
const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];
// Cross-training that counts: F45 / functional strength (Apple Watch usually sends these as Workout or
// WeightTraining), traditional strength, and HIIT. Walks, hikes, rides etc. are ignored.
const XT_TYPES = ['WeightTraining', 'HighIntensityIntervalTraining', 'Crossfit', 'Workout'];
const XT_LABEL = { WeightTraining: 'Strength', HighIntensityIntervalTraining: 'HIIT', Crossfit: 'CrossFit', Workout: 'F45/Workout' };
// Spreadsheet log is the history; Strava supplies runs dated after its last entry.
const sheetCutoff = () => (S.workouts || []).filter(w => w.source === 'import').reduce((m, w) => (w.date > m ? w.date : m), '') || null;
const redirectURI = () => location.origin + location.pathname;
const stravaReady = () => !!(S.strava.clientId && S.strava.clientSecret);
const stravaConnected = () => !!S.strava.refresh;

function stravaAuthorize() {
  if (!stravaReady()) return toast('Enter your Strava Client ID and Secret first');
  const p = new URLSearchParams({ client_id: S.strava.clientId, response_type: 'code', redirect_uri: redirectURI(), approval_prompt: 'auto', scope: 'read,activity:read_all', state: 'mt' });
  location.href = 'https://www.strava.com/oauth/authorize?' + p;
}
async function tokenReq(params) {
  const body = new URLSearchParams({ client_id: S.strava.clientId, client_secret: S.strava.clientSecret, ...params });
  const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Strava auth error ${r.status}`);
  return j;
}
function storeToken(j) {
  Object.assign(S.strava, { access: j.access_token, refresh: j.refresh_token, expiresAt: j.expires_at });
  if (j.athlete) S.strava.athlete = { id: j.athlete.id, name: `${j.athlete.firstname || ''} ${j.athlete.lastname || ''}`.trim() };
  save('mt.strava', S.strava);
}
async function exchangeCode(code) {
  storeToken(await tokenReq({ code, grant_type: 'authorization_code' }));
  toast('Strava connected'); await sync(true);
}
async function ensureToken() {
  if (S.strava.access && S.strava.expiresAt * 1000 > Date.now() + 60e3) return S.strava.access;
  storeToken(await tokenReq({ grant_type: 'refresh_token', refresh_token: S.strava.refresh }));
  return S.strava.access;
}
const mapAct = a => {
  const t = a.sport_type || a.type, run = RUN_TYPES.includes(t);
  return {
    id: a.id, date: a.start_date_local.slice(0, 10), time: a.start_date_local.slice(11, 16), name: a.name, type: t,
    isRun: run, isXT: XT_TYPES.includes(t), miles: (a.distance || 0) / 1609.344, sec: a.moving_time || 0,
    elev: (a.total_elevation_gain || 0) * 3.28084, hr: a.average_heartrate || null, maxhr: a.max_heartrate || null, source: 'strava',
  };
};
async function sync(manual) {
  if (!stravaConnected()) { if (manual) toast('Connect Strava in Settings first'); return; }
  const btn = document.querySelector('[data-act=sync]') || document.createElement('i');
  btn.classList.add('spin');
  try {
    const tok = await ensureToken();
    const cut = sheetCutoff();
    const from = cut ? addDays(cut, 1) : S.plan ? addDays(S.plan.weeks[0].start, -42) : addDays(TODAY, -180);
    const after = Math.floor(parseISO(from).getTime() / 1000);
    let page = 1, all = [];
    while (page < 20) {
      const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200&page=${page}`, { headers: { Authorization: 'Bearer ' + tok } });
      if (r.status === 401) throw new Error('Strava access denied — reconnect and allow "View data about your activities"');
      if (!r.ok) throw new Error('Strava error ' + r.status);
      const j = await r.json(); all = all.concat(j);
      if (j.length < 200) break; page++;
    }
    S.acts = all.filter(a => [...RUN_TYPES, ...XT_TYPES].includes(a.sport_type || a.type)).map(mapAct).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
    S.lastSync = Date.now(); save('mt.acts', S.acts); save('mt.lastSync', S.lastSync);
    if (manual) toast(`Synced ${S.acts.length} activities`);
    render();
  } catch (e) { console.error(e); toast(e.message, 5000); }
  finally { btn.classList.remove('spin'); }
}

/* ---------- derived data ---------- */
function activities() {
  const out = S.workouts.map(w => ({
    id: w.id, wid: w.id, date: w.date, time: w.start || '', type: w.type, isRun: w.type === 'Run', isXT: w.type !== 'Run',
    name: w.title || (w.source === 'import' ? (w.type === 'Run' ? 'Run' : w.type) : defaultTitle(w.type, w.start)),
    miles: w.miles || 0, sec: w.sec || 0, hr: w.hr || null, effort: w.effort || null, notes: w.notes || '', source: w.source,
  }));
  // Strava (only works with a Strava subscription): add anything not already logged here.
  const cut = sheetCutoff();
  for (const a of S.acts) {
    if ((!a.isRun && !a.isXT) || (cut && a.date <= cut)) continue;
    if (out.some(o => o.date === a.date && o.isRun === a.isRun && Math.abs(o.miles - a.miles) < 0.15)) continue;
    out.push(a);
  }
  return out.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
}
const runs = () => activities().filter(a => a.isRun && a.miles > 0);

function matchSessions(w, wruns) {
  const sess = [
    { key: 'run1', label: w.run1 || 'Run 1', mi: w.run1Mi, kind: /quick/i.test(w.run1) ? 'quick' : 'easy' },
    { key: 'run2', label: w.run2 || 'Run 2', mi: w.run2Mi, kind: /quick/i.test(w.run2) ? 'quick' : 'easy' },
    { key: 'long', label: w.phase === 'Race' ? 'Boston Marathon' : `Long run ${w.longMi} mi`, mi: w.longMi, kind: w.phase === 'Race' ? 'race' : 'long', notes: w.longNotes },
  ].filter(s => s.mi > 0);
  const pool = [...wruns];
  [...sess].sort((a, b) => b.mi - a.mi).forEach(s => {
    const ok = pool.filter(r => r.miles >= s.mi * 0.75).sort((a, b) => a.miles - b.miles);
    if (ok.length) { s.run = ok[0]; s.done = true; pool.splice(pool.indexOf(ok[0]), 1); }
  });
  return { sess, extra: pool };
}

function weekStats() {
  if (!S.plan) return [];
  const acts = activities();
  let cumPlan = 0, cumAct = 0;
  return S.plan.weeks.map((w, i) => {
    const end = addDays(w.start, 7);
    const a = acts.filter(x => x.date >= w.start && x.date < end);
    const wr = a.filter(x => x.isRun && x.miles > 0);
    const mi = sum(wr, r => r.miles), sec = sum(wr, r => r.sec);
    cumPlan += w.planMi;
    const started = w.start <= TODAY;
    if (started) cumAct += mi;
    const m = matchSessions(w, wr);
    return {
      ...w, i, end, runs: wr, mi, sec, pace: mi ? sec / mi : null, xt: a.filter(x => x.isXT).length, xtActs: a.filter(x => x.isXT),
      longest: wr.length ? Math.max(...wr.map(r => r.miles)) : 0, cumPlan, cumAct: started ? cumAct : null,
      started, past: end <= TODAY, sessions: m.sess, extra: m.extra,
    };
  });
}
function currentWeekIndex(weeks) {
  const i = weeks.findIndex(w => TODAY >= w.start && TODAY < w.end);
  if (i >= 0) return i;
  return TODAY < weeks[0].start ? 0 : weeks.length - 1;
}
function predictAt(date) {
  const P = S.plan; let best = null;
  const from = addDays(date, -42);
  for (const r of runs()) if (r.date <= date && r.date > from && r.miles >= 4 && r.sec > 0) {
    const p = riegel(r.miles, r.sec); if (!best || p < best.sec) best = { sec: p, src: `${mi1(r.miles)} mi on ${fmtDate(r.date)}` };
  }
  if (P.bench && P.bench.date <= date && daysBetween(P.bench.date, date) <= 120) {
    const p = riegel(P.bench.miles, P.bench.sec); if (!best || p < best.sec) best = { sec: p, src: `${P.bench.name.replace(/benchmark/i, '').trim() || 'Benchmark'} (${fmtDate(P.bench.date)})` };
  }
  return best;
}

/* ---------- coaching recommendations ---------- */
function recommendations(weeks, ci) {
  const P = S.plan.race, w = weeks[ci], R = [];
  const dow = parseISO(TODAY).getDay(), daysLeft = 7 - dow;
  const allRuns = runs();
  const ranOn = d => allRuns.some(r => r.date === d);
  const ranToday = ranOn(TODAY);
  let streak = 0; for (let d = addDays(TODAY, ranToday ? 0 : -1); ranOn(d); d = addDays(d, -1)) streak++;
  const todo = w.sessions.filter(s => !s.done);
  const paceFor = s => s.kind === 'quick' ? P.quickPace : s.kind === 'race' ? P.goalPace : P.easyPace;
  const daysToRace = daysBetween(TODAY, P.date);

  if (!stravaConnected()) R.push({ lvl: 'info', icon: 'i', t: 'Connect Strava', b: 'Link Strava in Settings so your Apple Watch runs sync in automatically.' });

  // 1 · today's workout
  if (daysToRace < 0) {
    R.push({ lvl: 'good', icon: '★', t: 'Race complete', b: 'Recover with a week of rest or very easy movement before planning what\'s next.' });
  } else if (daysToRace === 0) {
    R.push({ lvl: 'info', icon: '★', t: 'Race day', b: `Start at ${fmtPace(P.goalPace + 10)}–${fmtPace(P.goalPace)}/mi through the Newton hills, fuel every 4–5 miles, then race the last 10K.` });
  } else if (ranToday) {
    const r = allRuns.find(x => x.date === TODAY);
    R.push({ lvl: 'good', icon: '✓', t: `Done today: ${mi1(r.miles)} mi @ ${fmtPace(r.sec / r.miles)}/mi`, b: 'Refuel within an hour (carbs + protein) and hydrate.' });
  } else if (!todo.length) {
    R.push({ lvl: 'good', icon: '✓', t: 'All runs done this week', b: w.xt < w.xtTarget ? `Fit in ${w.xtTarget - w.xt === 1 ? 'a cross-training session' : (w.xtTarget - w.xt) + ' cross-training sessions'} (F45, strength, or HIIT), or rest.` : 'Rest, stretch, or an easy walk. You\'ve earned it.' });
  } else if (streak >= 3) {
    R.push({ lvl: 'info', icon: 'z', t: 'Rest or cross-train today', b: `You've run ${streak} days in a row. A day off lets the training soak in.` });
  } else {
    const weekend = dow === 0 || dow >= 5;
    const long = todo.find(s => s.kind === 'long' || s.kind === 'race');
    const short = todo.filter(s => s !== long);
    const pick = (weekend && long) || short[0] || long;
    let body = `${pick.mi} mi @ ~${fmtPace(paceFor(pick))}/mi.`;
    const gp = /last (\d+) mi @ goal/i.exec(pick.notes || '');
    if (gp) body += ` Finish the last ${gp[1]} mi at goal pace (${fmtPace(P.goalPace)}/mi).`;
    else if (pick.notes && !/^easy$/i.test(pick.notes)) body += ` ${pick.notes}.`;
    if (pick.kind === 'long' && pick.mi >= 12) body += ' Bring fuel: a gel every 40–45 min.';
    if (pick.kind === 'quick') body += ' Warm up 1 mi easy first.';
    R.push({ lvl: 'info', icon: '→', t: `Up next: ${pick.label}`, b: body });
  }

  // 2 · too many runs left
  const slots = daysLeft - (ranToday ? 1 : 0);
  if (todo.length > slots && slots >= 0 && todo.length) {
    const drop = [...todo].filter(s => s.kind !== 'long').sort((a, b) => a.mi - b.mi)[0];
    R.push({ lvl: 'warning', icon: '!', t: `${todo.length} runs left, ${slots} day${slots === 1 ? '' : 's'} left this week`, b: drop ? `Skip the ${drop.mi} mi run rather than double up. Protect the long run.` : 'Don\'t cram. Move on with next week\'s plan.' });
  }

  // 3 · acute:chronic load
  const milesIn = (a, b) => sum(allRuns.filter(r => r.date > a && r.date <= b), r => r.miles);
  const acute = milesIn(addDays(TODAY, -7), TODAY), chronic = milesIn(addDays(TODAY, -28), TODAY) / 4;
  if (chronic >= 4) {
    const ratio = acute / chronic;
    if (ratio > 1.5) R.push({ lvl: 'critical', icon: '!!', t: `Load spike: ${Math.round((ratio - 1) * 100)}% above your 4-week average`, b: `${mi1(acute)} mi in 7 days vs ${mi1(chronic)} mi/week average. That's high injury risk. Take an extra easy day.` });
    else if (ratio > 1.3) R.push({ lvl: 'warning', icon: '!', t: `Mileage up ${Math.round((ratio - 1) * 100)}% vs your 4-week average`, b: 'Keep every run this week truly easy and watch for aches in shins, knees, and Achilles.' });
    else if (ratio < 0.6 && !/taper|race|injury|return/i.test(w.phase) && !/cutback/i.test(w.longNotes)) R.push({ lvl: 'info', icon: 'i', t: 'Light week so far', b: `${mi1(acute)} mi in the last 7 days vs ${mi1(chronic)} mi/week average. Ease back in; don't jump straight to full volume.` });
  }

  // 4 · easy-pace discipline (80/20)
  const recent = allRuns.filter(r => r.date > addDays(TODAY, -14) && r.miles >= 1.5 && r.sec);
  const fast = recent.filter(r => r.sec / r.miles < P.easyPace - 30);
  if (recent.length >= 4 && fast.length / recent.length > 0.5)
    R.push({ lvl: 'warning', icon: '!', t: 'Easy runs are running fast', b: `${fast.length} of ${recent.length} recent runs were quicker than ${fmtPace(P.easyPace - 30)}/mi. Easy days should be ~${fmtPace(P.easyPace)}/mi so you're fresh for the long run.` });

  // 5 · long-run jump
  const prevLong = Math.max(0, ...weeks.slice(Math.max(0, ci - 4), ci).map(x => x.longest));
  const ls = w.sessions.find(s => s.kind === 'long');
  if (ls && !ls.done && prevLong > 0 && ls.mi > 6 && ls.mi > prevLong * 1.3)
    R.push({ lvl: 'warning', icon: '!', t: `Long run jump: ${ls.mi} mi vs recent best ${mi1(prevLong)}`, b: `Run it slower than easy pace (${fmtPace(P.easyPace + 15)}/mi is fine). Walk breaks are OK. If it's too much, stop at ${Math.round(prevLong * 1.2)} mi.` });

  // 6 · last long run too fast
  const lastLong = allRuns.filter(r => r.date > addDays(TODAY, -7) && r.miles >= 8).sort((a, b) => b.miles - a.miles)[0];
  if (lastLong && lastLong.sec / lastLong.miles < P.goalPace + 15 && !/goal/i.test(w.longNotes))
    R.push({ lvl: 'warning', icon: '!', t: `Long run was quick: ${fmtPace(lastLong.sec / lastLong.miles)}/mi`, b: `Long runs build endurance at easy effort (~${fmtPace(P.easyPace)}/mi). Running them near race pace adds fatigue without much extra benefit.` });

  // 7 · cumulative vs plan (completed weeks)
  const done = weeks.filter(x => x.past);
  if (done.length >= 2) {
    const cp = sum(done, x => x.planMi), ca = sum(done, x => x.mi), diff = ca - cp, pct = diff / cp;
    if (pct >= -0.05 && pct <= 0.15) R.push({ lvl: 'good', icon: '✓', t: 'On plan', b: `${Math.round(ca)} mi logged vs ${Math.round(cp)} planned across ${done.length} completed weeks.` });
    else if (pct > 0.15) R.push({ lvl: 'warning', icon: '!', t: `${Math.round(diff)} mi ahead of plan`, b: 'Extra volume early is the most common cause of injury. Stick to the plan numbers.' });
    else if (pct >= -0.15) R.push({ lvl: 'warning', icon: '!', t: `${Math.round(-diff)} mi behind plan`, b: 'Small gap. Don\'t make it up; just hit this week\'s runs.' });
    else R.push({ lvl: 'serious', icon: '!', t: `${Math.round(-diff)} mi behind plan (${Math.round(-pct * 100)}%)`, b: 'Resume the plan where you are rather than adding miles. If you\'ve missed 2+ weeks, repeat the last week you completed.' });
  }

  // 8 · race prediction
  const pred = predictAt(TODAY);
  if (pred && daysToRace >= 0) {
    const gap = pred.sec - P.goalSec, perMi = gap / P.distance;
    if (gap <= 0) R.push({ lvl: 'good', icon: '✓', t: `On track: predicted ${fmtHM(pred.sec)}`, b: `From ${pred.src}. That's ${fmtHM(-gap)} under your ${fmtHM(P.goalSec)} goal.` });
    else R.push({ lvl: gap > 900 ? 'serious' : 'info', icon: '◷', t: `Predicted ${fmtHM(pred.sec)} vs goal ${fmtHM(P.goalSec)}`, b: `From ${pred.src}. You need ~${Math.round(perMi)} s/mi faster. With ${Math.round(daysToRace / 7)} weeks left, the quicker runs and goal-pace long-run finishes are where it comes from.` });
  }

  // 9 · cross-training (F45 / strength / HIIT)
  if (w.xtTarget > 0) {
    const need = w.xtTarget - w.xt;
    const longS = w.sessions.find(s => s.kind === 'long');
    if (need <= 0) R.push({ lvl: 'good', icon: '✓', t: `Cross-training: ${w.xt}/${w.xtTarget} done`, b: 'Strength work protects your legs as mileage climbs.' });
    else if (need > daysLeft) R.push({ lvl: 'warning', icon: '!', t: `Cross-training: ${w.xt}/${w.xtTarget}, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, b: 'Get in what you can, but don\'t stack a hard F45 or HIIT session right before the long run.' });
    else R.push({ lvl: 'info', icon: '◆', t: `Cross-training: ${w.xt}/${w.xtTarget} this week`, b: `${need} to go. Best on an easy-run or rest day.${longS && !longS.done ? ' Avoid heavy legs or HIIT the day before the long run.' : ''}` });
  }
  const recentWks = weeks.slice(Math.max(0, ci - 4), ci).filter(x => x.xtTarget > 0 && !/injury/i.test(x.phase));
  if (recentWks.length >= 3) {
    const hit = recentWks.filter(x => x.xt >= x.xtTarget).length;
    if (hit <= 1) R.push({ lvl: 'warning', icon: '!', t: `Cross-training target hit ${hit} of the last ${recentWks.length} weeks`, b: 'Strength and HIIT build the hip, glute and core strength that holds your form in the last 10K. Schedule them like runs.' });
  }

  // 10 · heart-rate efficiency
  const hrRuns = allRuns.filter(r => r.hr && r.miles >= 2);
  const eff = rs => sum(rs, r => (r.miles / r.sec * 3600) / r.hr) / rs.length;
  const a1 = hrRuns.filter(r => r.date > addDays(TODAY, -21)), a0 = hrRuns.filter(r => r.date <= addDays(TODAY, -21) && r.date > addDays(TODAY, -42));
  if (a1.length >= 3 && a0.length >= 3) {
    const d = eff(a1) / eff(a0) - 1;
    if (d >= 0.03) R.push({ lvl: 'good', icon: '♥', t: `Aerobic fitness up ${Math.round(d * 100)}%`, b: 'You\'re running faster at the same heart rate than 3–6 weeks ago.' });
    else if (d <= -0.04) R.push({ lvl: 'info', icon: '♥', t: 'Heart rate running high for your pace', b: 'Possible fatigue, heat, poor sleep, or illness. Consider an extra easy day.' });
  }

  // 11 · phase tip
  const tips = {
    Injury: 'Injury: let it heal. Pain-free cross-training (bike, pool) keeps fitness; follow your PT or doctor on when to run.',
    Return: 'Return: short, easy, pain-free runs. Stop if anything changes your stride; consistency beats catching up.',
    Base: 'Base phase: build the habit. All runs conversational; you should be able to talk in full sentences.',
    Build: 'Build phase: mileage climbs. Sleep 8 hours and practice your race-day fuel on long runs.',
    Peak: 'Peak phase: biggest weeks. Rehearse race morning (breakfast, gear, gels) on a long run.',
    Taper: 'Taper: less volume, same routine. Feeling sluggish or antsy is normal. Trust the training.',
    Race: 'Race week: short easy runs, extra carbs the last 2–3 days, lay out your gear the night before.',
  };
  if (/cutback/i.test(w.longNotes)) R.push({ lvl: 'info', icon: '↓', t: 'Cutback week', b: 'Lower volume on purpose so your body absorbs the last few weeks. Keep it easy.' });
  else if (tips[w.phase]) R.push({ lvl: 'info', icon: 'i', t: `${w.phase} phase`, b: tips[w.phase].replace(/^[^:]+:\s*/, '') });

  const order = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 };
  const first = R.findIndex(r => /^(Up next|Done today|All runs|Rest or|Race)/.test(r.t));
  const head = first >= 0 ? R.splice(first, 1) : [];
  return head.concat(R.sort((a, b) => order[a.lvl] - order[b.lvl]));
}

/* ---------- views ---------- */
const LVL = { good: 'On track', warning: 'Heads up', serious: 'Attention', critical: 'Warning', info: 'Coach' };
const recCard = r => `<div class="card rec"><div class="ic ${r.lvl}" aria-hidden="true">${esc(r.icon)}</div><div><div class="lvl">${LVL[r.lvl]}</div><div class="t">${esc(r.t)}</div><div class="b">${esc(r.b)}</div></div></div>`;

function ring(val, max, size = 92) {
  const r = size / 2 - 7, c = 2 * Math.PI * r, p = Math.min(1, max ? val / max : 0);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${mi1(val)} of ${max} miles">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="9"/>
    ${p > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p >= 1 ? 'var(--good)' : 'var(--series-1)'}" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${c * p} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
    <text x="50%" y="47%" text-anchor="middle" font-size="19" font-weight="700" fill="var(--text)">${mi1(val)}</text>
    <text x="50%" y="64%" text-anchor="middle" font-size="11" fill="var(--muted)">of ${max} mi</text></svg>`;
}
const runRow = r => {
  const d = parseISO(r.date);
  const meta = r.isRun
    ? [fmtDur(r.sec), r.sec ? fmtPace(r.sec / r.miles) + '/mi' : '', r.hr ? `♥ ${Math.round(r.hr)}` : '', r.effort ? `effort ${r.effort}/10` : '']
    : ['Cross-train · ' + (XT_LABEL[r.type] || r.type), r.sec ? fmtDur(r.sec) : '', r.hr ? `♥ ${Math.round(r.hr)}` : '', r.effort ? `effort ${r.effort}/10` : ''];
  const right = r.isRun ? `${mi1(r.miles)}<small>mi</small>` : r.sec ? `${Math.round(r.sec / 60)}<small>min</small>` : `✓<small>done</small>`;
  const src = r.source === 'strava' ? ' <span class="src">Strava</span>' : '';
  return `<div class="run${r.wid ? ' tappable' : ''}"${r.wid ? ` data-wid="${esc(r.wid)}"` : ''}><div class="date"><b>${d.getDate()}</b><span>${MON[d.getMonth()]}</span></div>
    <div class="grow"><div class="nm">${esc(r.name)}${src}</div><div class="meta">${esc(meta.filter(Boolean).join(' · '))}</div>${r.notes ? `<div class="notes">${esc(r.notes)}</div>` : ''}</div>
    <div class="mi">${right}</div></div>`;
};
const xtRow = w => {
  if (!w.xtTarget && !w.xt) return '';
  const full = w.xt >= w.xtTarget;
  const detail = w.xtActs.length ? w.xtActs.map(a => `${DOW[parseISO(a.date).getDay()]} ${XT_LABEL[a.type] || a.type}`).join(' · ') : 'F45, strength, or HIIT';
  return `<div class="session"><div class="check ${full ? 'done' : w.xt ? 'partial' : ''}">${full ? '✓' : ''}</div>
    <div><div class="t">Cross-train</div><div class="d">${esc(detail)}</div></div><div class="m">${w.xt}/${w.xtTarget || 0}</div></div>`;
};
const emptyPlan = () => `<div class="card empty"><div class="big">🏃</div><p><b>Bring in your training plan</b></p>
  <p class="note">Import your plan, paces and run history once from your spreadsheet. After that everything lives in the app and you can edit it here.</p>
  <button class="btn" data-act="goto-settings">Import from Google Sheet</button>
  <button class="btn secondary" data-act="import">Import an .xlsx file</button></div>`;

function viewToday() {
  if (!S.plan) return emptyPlan();
  const weeks = weekStats(), ci = currentWeekIndex(weeks), w = weeks[ci], P = S.plan.race;
  const dtr = daysBetween(TODAY, P.date);
  const pred = predictAt(TODAY);
  const done = weeks.filter(x => x.past);
  const cumDiff = done.length ? sum(done, x => x.mi) - sum(done, x => x.planMi) : 0;
  const sessions = w.sessions.map(s => `<div class="session">
      <div class="check ${s.done ? 'done' : ''}">${s.done ? '✓' : ''}</div>
      <div><div class="t">${esc(s.label)}</div><div class="d">${s.done ? `${fmtDate(s.run.date)} · ${mi1(s.run.miles)} mi @ ${fmtPace(s.run.sec / s.run.miles)}/mi` : esc(s.notes && !/^easy$/i.test(s.notes) ? s.notes : (s.kind === 'quick' ? `~${fmtPace(P.quickPace)}/mi` : `~${fmtPace(s.kind === 'race' ? P.goalPace : P.easyPace)}/mi`))}</div></div>
      <div class="m">${s.mi} mi</div></div>`).join('');
  const extra = w.extra.length ? `<div class="session"><div class="check done" style="background:var(--series-3);border-color:var(--series-3)">+</div><div><div class="t">Extra runs</div><div class="d">${w.extra.map(r => mi1(r.miles) + ' mi').join(', ')}</div></div></div>` : '';
  const recs = recommendations(weeks, ci).map(recCard).join('');
  const recent = activities().slice(0, 4).map(runRow).join('');
  return `
  <div class="card hero">${ring(w.mi, w.planMi)}
    <div><div class="hero-num">${dtr >= 0 ? dtr : 0}<span style="font-size:16px;font-weight:600;color:var(--text-2)"> days</span></div>
    <div class="hero-sub">to ${esc(P.name)} · ${fmtDate(P.date)}</div>
    <div style="margin-top:8px"><span class="pill phase">Week ${w.wk} · ${esc(w.phase)}</span> <span class="pill">${fmtDate(w.start)}–${fmtDate(addDays(w.start, 6))}</span></div></div></div>
  <div class="stats">
    <div class="stat"><div class="k">Goal</div><div class="v">${fmtHM(P.goalSec)}</div><div class="s">${fmtPace(P.goalPace)}/mi</div></div>
    <div class="stat"><div class="k">Predicted</div><div class="v">${pred ? fmtHM(pred.sec) : '–'}</div><div class="s">${pred ? fmtPace(pred.sec / P.distance) + '/mi' : 'need 4+ mi run'}</div></div>
    <div class="stat"><div class="k">vs plan</div><div class="v">${cumDiff >= 0 ? '+' : ''}${Math.round(cumDiff)} mi</div><div class="s">${done.length} wks done</div></div>
  </div>
  ${fundCard()}
  <h2 class="h2-row">This week <button class="chip-btn" data-act="edit-week" data-i="${ci}">Edit</button></h2><div class="card tight">${sessions}${extra}${xtRow(w)}</div>
  <h2>Coach</h2>${recs}
  <h2>Recent</h2><div class="card list">${recent || '<div class="empty">No activities yet</div>'}</div>`;
}

function viewPlan() {
  if (!S.plan) return emptyPlan();
  const weeks = weekStats(), ci = currentWeekIndex(weeks);
  let lastPhase = null;
  const rows = weeks.map(w => {
    const head = w.phase !== lastPhase ? `${lastPhase === null ? '' : '</div>'}<h2>${esc(w.phase)}</h2><div class="card list">` : ''; lastPhase = w.phase;
    const pct = w.planMi ? Math.min(100, w.mi / w.planMi * 100) : 0;
    const det = w.sessions.map(s => `<div>${s.done ? '✓' : '○'} ${esc(s.label)}${s.notes && s.kind === 'long' && !/^easy$/i.test(s.notes) ? ' · ' + esc(s.notes) : ''}${s.done ? ` <span class="ok">(${mi1(s.run.miles)} mi)</span>` : ''}</div>`).join('')
      + (w.xtTarget || w.xt ? `<div>${w.xt >= w.xtTarget ? '✓' : '○'} Cross-train ${w.xt}/${w.xtTarget}${w.xtActs.length ? ' · ' + w.xtActs.map(a => `${DOW[parseISO(a.date).getDay()]} ${XT_LABEL[a.type] || a.type}`).join(', ') : ''}</div>` : '')
      + (w.runs.length ?`<div>Runs: ${w.runs.map(r => `${DOW[parseISO(r.date).getDay()]} ${mi1(r.miles)}`).join(' · ')}${w.pace ? ` · avg ${fmtPace(w.pace)}/mi` : ''}</div>` : '')
      + `<button class="chip-btn" data-act="edit-week" data-i="${w.i}">Edit week</button>`;
    return head + `<div class="week ${w.i === ci ? 'current' : ''}" data-week="${w.i}">
      <div class="wn">W${w.wk}</div>
      <div><div>${esc(w.run1 || '—')} · ${esc((w.run2 || '—').replace(/\s*[–—-]\s*shorter, quicker.*$/i, ' quick'))}${w.phase === 'Race' ? ' · <b>RACE</b>' : w.longMi ? ' · <b>Long ' + w.longMi + '</b>' : ''}</div>
        <div class="wd">${fmtDate(w.start)}${w.i === ci ? ' · this week' : ''}</div>${w.started ? `<div class="bar"><div style="width:${pct}%"></div></div>` : ''}</div>
      <div class="mi">${w.started ? mi1(w.mi) : '–'}<small>of ${w.planMi}</small></div></div>
      <div class="week-detail" id="wd-${w.i}">${det}</div>`;
  }).join('');
  return rows + '</div>';
}

function viewRuns() {
  const all = activities();
  const list = all.filter(a => S.runFilter === 'all' || (S.runFilter === 'runs' ? a.isRun : a.isXT));
  const r = all.filter(a => a.isRun && a.miles > 0);
  return `<div class="seg" role="tablist">${[['all', 'All'], ['runs', 'Runs'], ['xt', 'Cross-train']].map(([k, l]) => `<button data-filter="${k}" class="${S.runFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><div class="k">Runs</div><div class="v">${r.length}</div></div>
      <div class="stat"><div class="k">Miles</div><div class="v">${Math.round(sum(r, x => x.miles))}</div></div>
      <div class="stat"><div class="k">Cross-train</div><div class="v">${all.filter(a => a.isXT).length}</div></div></div>
    <button class="btn" data-act="log" style="margin:0 0 12px">+ Log workout</button>
    <div class="card list">${list.map(runRow).join('') || '<div class="empty">Nothing here yet. Tap + to log a workout.</div>'}</div>
    <p class="note" style="text-align:center">Tap any workout to edit or delete it.</p>`;
}

function viewSettings() {
  const P = S.plan, st = S.strava, g = S.gsheet, cut = sheetCutoff();
  const nApp = S.workouts.filter(w => w.source === 'app').length;
  return `
  <h2>Strava</h2><div class="card">
    ${stravaConnected() ? `<div class="ok">✓ Connected${st.athlete?.name ? ' as ' + esc(st.athlete.name) : ''}</div><div class="note">${S.acts.length} activities synced${cut ? ` after ${fmtDate(cut)}` : ''} · last sync ${S.lastSync ? new Date(S.lastSync).toLocaleString() : 'never'}. Runs, F45/workouts, strength and HIIT come in automatically; walks are ignored.</div>
      <button class="btn strava" data-act="sync">Sync now</button><button class="btn danger" data-act="disconnect">Disconnect</button>`
    : `<div class="note">Needs a Strava subscription. Create an API app at <b>strava.com/settings/api</b> with <i>Authorization Callback Domain</i> <code>${esc(location.hostname || 'localhost')}</code>, then paste its keys here.</div>
      <label class="f" for="cid">Client ID</label><input id="cid" type="text" inputmode="numeric" autocomplete="off" value="${esc(st.clientId || '')}">
      <label class="f" for="csec">Client Secret</label><input id="csec" type="password" autocomplete="off" value="${esc(st.clientSecret || '')}">
      <button class="btn strava" data-act="connect">Connect with Strava</button>
      <details style="margin-top:14px"><summary class="note">Connected in Safari but the app didn't pick it up?</summary>
        <label class="f" for="code">Paste authorization code</label><input id="code" type="text" autocomplete="off">
        <button class="btn secondary" data-act="code">Use code</button></details>`}
    <div class="note" style="margin-top:10px">Keys and tokens stay on this phone only.</div></div>

  <h2>Fundraising</h2><div class="card">
    ${S.fund?.data ? `<div class="ok">✓ Tracking “${esc(S.fund.data.title)}”</div><div class="note">${money(S.fund.data.total)} raised · updated ${new Date(S.fund.at).toLocaleString()}</div>` : '<div class="note">Paste your GivenGain page link to track donations on the Today screen. It uses your Google Sheet link (Starting data) to read GivenGain.</div>'}
    <label class="f" for="fundurl">GivenGain page link</label><input id="fundurl" type="text" autocomplete="off" value="${esc(S.fund?.url || '')}" placeholder="https://www.givengain.com/project/…">
    <button class="btn ${S.fund?.data ? 'secondary' : ''}" data-act="fund-save">${S.fund?.id ? 'Save &amp; refresh' : 'Track donations'}</button></div>

  ${P ? `<h2>Race goal</h2><div class="card">
    <div class="stats"><div class="stat"><div class="k">Goal</div><div class="v">${fmtDur(P.race.goalSec)}</div><div class="s">${fmtPace(P.race.goalPace)}/mi</div></div>
      <div class="stat"><div class="k">Easy</div><div class="v">${fmtPace(P.race.easyPace)}</div><div class="s">+${fmtDur(P.race.easyOff ?? P.race.easyPace - P.race.goalPace)}</div></div>
      <div class="stat"><div class="k">Quicker</div><div class="v">${fmtPace(P.race.quickPace)}</div><div class="s">−${fmtDur(P.race.quickOff ?? P.race.goalPace - P.race.quickPace)}</div></div></div>
    <button class="btn secondary" data-act="edit-goals">Change goal &amp; paces</button></div>` : ''}

  <h2>Your data</h2><div class="card">
    <div class="note">Everything is kept in this app and is yours to edit: the plan (Plan tab → tap a week → <b>Edit week</b>), your goal (above), and every workout (Runs tab → tap one). ${S.workouts.length} workouts saved${nApp ? `, ${nApp} logged in the app` : ''}.</div>
    <button class="btn secondary" data-act="export">Back up to a file</button>
    <button class="btn secondary" data-act="restore">Restore a backup</button>
    <div class="note" style="margin-top:8px">Removing the app from your home screen erases its data, so save a backup now and then.</div></div>

  <h2>Starting data</h2><div class="card">
    ${P ? `<div class="ok">✓ Started from ${esc(P.source || P.fileName)}</div><div class="note">${P.weeks.length} weeks · race ${fmtDate(P.race.date)}${cut ? ` · history through ${fmtDate(cut)}` : ''} · imported ${new Date(P.importedAt).toLocaleDateString()}</div>`
      : '<div class="note">Import your plan, paces and run history from your spreadsheet to get started.</div>'}
    <label class="f" for="gslink">Google Sheet link (web app URL#key)</label><input id="gslink" type="text" autocomplete="off" value="${esc(g ? g.url + '#' + g.key : '')}" placeholder="https://script.google.com/macros/s/…/exec#key">
    <button class="btn ${P ? 'secondary' : ''}" data-act="gs-import">${P ? 'Re-import from Google Sheet' : 'Import from Google Sheet'}</button>
    <button class="btn secondary" data-act="import">Import an .xlsx file</button>
    ${P ? '<div class="note" style="margin-top:8px">Re-importing replaces the plan and the imported history. Workouts you logged in the app are kept.</div>' : ''}</div>

  <button class="btn danger" data-act="reset" style="margin-top:20px">Erase everything on this device</button>
  <p class="note" style="text-align:center;margin-top:16px">Today: ${fmtDate(TODAY)}, ${parseISO(TODAY).getFullYear()}</p>`;
}

/* ---------- charts ---------- */
function viewCharts() {
  if (!S.plan) return emptyPlan();
  const hasHR = runs().some(r => r.hr);
  const card = (id, title, sub, legend) => `<div class="card chart-card"><h3>${title}</h3><div class="sub">${sub}</div>${legend ? `<div class="legend">${legend}</div>` : ''}<div class="chart-wrap"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div></div>`;
  const L = (cls, color, label) => `<span><i class="${cls}" style="background:${color}"></i>${label}</span>`;
  return card('c-weekly', 'Weekly mileage', 'Actual miles vs plan, all 30 weeks', L('', 'var(--series-1)', 'Actual') + L('dash', 'var(--plan)', 'Plan'))
    + card('c-cum', 'Cumulative miles', 'Are you banking the miles?', L('', 'var(--series-1)', 'Actual') + L('dash', 'var(--plan)', 'Plan'))
    + card('c-pace', 'Pace per run', 'Higher is faster', L('dot', 'var(--series-1)', 'Run') + L('', 'var(--series-2)', 'Goal pace') + L('', 'var(--series-3)', 'Easy pace'))
    + card('c-long', 'Long run progression', 'Longest run each week vs the planned long run', L('', 'var(--series-1)', 'Longest actual') + L('dash', 'var(--plan)', 'Planned long'))
    + card('c-xt', 'Cross-training', 'F45, strength and HIIT sessions per week vs target', L('', 'var(--series-1)', 'Sessions') + L('dash', 'var(--plan)', 'Target'))
    + card('c-pred', 'Predicted marathon time', 'Best recent effort (Riegel formula), lower is faster', L('', 'var(--series-1)', 'Predicted') + L('', 'var(--series-2)', 'Goal'))
    + (hasHR ? card('c-hr', 'Average heart rate', 'Per run from Apple Watch via Strava. Dropping at the same pace = fitter', '') : '');
}
function drawCharts() {
  S.charts.forEach(c => c.destroy()); S.charts = [];
  if (!S.plan || typeof Chart === 'undefined') return;
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  const C = { s1: v('--series-1'), s2: v('--series-2'), s3: v('--series-3'), plan: v('--plan'), grid: v('--grid'), muted: v('--muted'), text: v('--text'), surface: v('--surface') };
  Chart.defaults.color = C.muted; Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.font.size = 11;
  const P = S.plan.race, weeks = weekStats(), ci = currentWeekIndex(weeks);
  const base = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: C.text, titleColor: C.surface, bodyColor: C.surface, padding: 10, cornerRadius: 8, displayColors: true, boxPadding: 4 } },
    scales: { x: { grid: { display: false }, border: { color: C.grid } }, y: { grid: { color: C.grid }, border: { display: false }, beginAtZero: true } },
  };
  const merge = (o) => { const b = structuredClone(base); return Object.assign(b, o, { plugins: { ...b.plugins, ...(o.plugins || {}), tooltip: { ...b.plugins.tooltip, ...((o.plugins || {}).tooltip || {}) } }, scales: { x: { ...b.scales.x, ...((o.scales || {}).x || {}) }, y: { ...b.scales.y, ...((o.scales || {}).y || {}) } } }); };
  const mk = (id, cfg) => { const el = document.getElementById(id); if (el) S.charts.push(new Chart(el, cfg)); };
  const labels = weeks.map(w => 'W' + w.wk);
  const wkTitle = items => { const w = weeks[items[0].dataIndex]; return `Week ${w.wk} · ${fmtDate(w.start)} · ${w.phase}`; };

  mk('c-weekly', { data: { labels, datasets: [
    { type: 'bar', label: 'Actual', data: weeks.map(w => w.started ? +mi1(w.mi) : null), backgroundColor: weeks.map(w => w.i === ci ? C.s1 + 'aa' : C.s1), borderRadius: 4, borderSkipped: 'start', barPercentage: 0.75, categoryPercentage: 0.9 },
    { type: 'line', label: 'Plan', data: weeks.map(w => w.planMi), borderColor: C.plan, borderDash: [4, 3], borderWidth: 2, pointRadius: 0, stepped: 'middle', pointHitRadius: 10 },
  ] }, options: merge({ interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: wkTitle, label: c => ` ${c.dataset.label}: ${c.raw ?? '–'} mi` } } }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0 } } } }) });

  mk('c-cum', { type: 'line', data: { labels, datasets: [
    { label: 'Actual', data: weeks.map(w => w.cumAct != null ? +w.cumAct.toFixed(1) : null), borderColor: C.s1, backgroundColor: C.s1 + '22', fill: true, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.2 },
    { label: 'Plan', data: weeks.map(w => +w.cumPlan.toFixed(1)), borderColor: C.plan, borderDash: [4, 3], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 },
  ] }, options: merge({ interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: wkTitle, label: c => ` ${c.dataset.label}: ${c.raw ?? '–'} mi` } } }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0 } } } }) });

  const rr = runs().filter(r => r.miles >= 1 && r.sec).reverse();
  const t = s => parseISO(s).getTime();
  const x0 = rr.length ? t(rr[0].date) - 3 * 864e5 : t(weeks[0].start), x1 = t(TODAY) + 3 * 864e5;
  const paces = rr.map(r => r.sec / r.miles);
  const yMin = Math.floor((Math.min(P.quickPace, ...paces) - 15) / 30) * 30, yMax = Math.ceil((Math.max(P.easyPace, ...paces) + 15) / 30) * 30;
  const dateTick = val => { const d = new Date(val); return `${MON[d.getMonth()]} ${d.getDate()}`; };
  mk('c-pace', { type: 'scatter', data: { datasets: [
    { label: 'Run', data: rr.map(r => ({ x: t(r.date), y: r.sec / r.miles, r })), backgroundColor: C.s1, borderColor: C.surface, borderWidth: 2, pointRadius: rr.map(r => Math.max(4, Math.min(10, 3 + r.miles / 2))), pointHoverRadius: 8 },
    { type: 'line', label: 'Goal pace', data: [{ x: x0, y: P.goalPace }, { x: x1, y: P.goalPace }], borderColor: C.s2, borderWidth: 2, pointRadius: 0 },
    { type: 'line', label: 'Easy pace', data: [{ x: x0, y: P.easyPace }, { x: x1, y: P.easyPace }], borderColor: C.s3, borderWidth: 2, pointRadius: 0 },
  ] }, options: merge({
    plugins: { tooltip: { filter: i => i.datasetIndex === 0, callbacks: { title: i => i[0] ? `${fmtDate(i[0].raw.r.date)} · ${i[0].raw.r.name}` : '', label: c => ` ${mi1(c.raw.r.miles)} mi @ ${fmtPace(c.raw.y)}/mi${c.raw.r.hr ? ` · ♥ ${Math.round(c.raw.r.hr)}` : ''}` } } },
    scales: { x: { type: 'linear', min: x0, max: x1, ticks: { callback: dateTick, maxTicksLimit: 6, maxRotation: 0 } }, y: { reverse: true, beginAtZero: false, min: yMin, max: yMax, ticks: { callback: fmtPace, stepSize: 30 } } },
  }) });

  mk('c-long', { data: { labels, datasets: [
    { type: 'bar', label: 'Longest actual', data: weeks.map(w => w.started ? +mi1(w.longest) : null), backgroundColor: C.s1, borderRadius: 4, borderSkipped: 'start', barPercentage: 0.75, categoryPercentage: 0.9 },
    { type: 'line', label: 'Planned long', data: weeks.map(w => w.longMi), borderColor: C.plan, borderDash: [4, 3], borderWidth: 2, pointRadius: 0, stepped: 'middle', pointHitRadius: 10 },
  ] }, options: merge({ interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: wkTitle, label: c => ` ${c.dataset.label}: ${c.raw ?? '–'} mi` } } }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0 } } } }) });

  mk('c-xt', { data: { labels, datasets: [
    { type: 'bar', label: 'Sessions', data: weeks.map(w => w.started ? w.xt : null), backgroundColor: weeks.map(w => w.xtTarget && w.past && w.xt < w.xtTarget ? C.s1 + '88' : C.s1), borderRadius: 4, borderSkipped: 'start', barPercentage: 0.75, categoryPercentage: 0.9 },
    { type: 'line', label: 'Target', data: weeks.map(w => w.xtTarget), borderColor: C.plan, borderDash: [4, 3], borderWidth: 2, pointRadius: 0, stepped: 'middle', pointHitRadius: 10 },
  ] }, options: merge({ interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: wkTitle, label: c => ` ${c.dataset.label}: ${c.raw ?? '–'}`, afterBody: i => { const w = weeks[i[0].dataIndex]; return w.xtActs.length ? w.xtActs.map(a => `${DOW[parseISO(a.date).getDay()]} ${XT_LABEL[a.type] || a.type}`).join(', ') : ''; } } } }, scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 8, maxRotation: 0 } }, y: { ticks: { stepSize: 1, precision: 0 }, suggestedMax: 3 } } }) });

  const pw = weeks.filter(w => w.started).map(w => { const d = w.end <= TODAY ? addDays(w.end, -1) : TODAY; return { w, p: predictAt(d) }; });
  mk('c-pred', { type: 'line', data: { labels: pw.map(x => 'W' + x.w.wk), datasets: [
    { label: 'Predicted', data: pw.map(x => x.p ? Math.round(x.p.sec) : null), borderColor: C.s1, borderWidth: 2, pointRadius: 4, pointBackgroundColor: C.s1, pointBorderColor: C.surface, pointBorderWidth: 2, pointHoverRadius: 6, spanGaps: true, tension: 0.2 },
    { label: 'Goal', data: pw.map(() => P.goalSec), borderColor: C.s2, borderWidth: 2, pointRadius: 0 },
  ] }, options: merge({ interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { callbacks: { title: i => wkTitle([{ dataIndex: pw[i[0].dataIndex].w.i }]), label: c => ` ${c.dataset.label}: ${c.raw ? fmtHM(c.raw) : '–'}`, afterBody: i => { const p = pw[i[0].dataIndex].p; return p ? `From ${p.src}` : ''; } } } }, scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: false, suggestedMin: P.goalSec - 600, ticks: { callback: fmtHM, stepSize: 300 } } } }) });

  const hr = rr.filter(r => r.hr);
  if (hr.length) mk('c-hr', { type: 'scatter', data: { datasets: [
    { label: 'Avg HR', data: hr.map(r => ({ x: t(r.date), y: r.hr, r })), backgroundColor: C.s1, borderColor: C.surface, borderWidth: 2, pointRadius: 5, pointHoverRadius: 8 },
  ] }, options: merge({ plugins: { tooltip: { callbacks: { title: i => `${fmtDate(i[0].raw.r.date)} · ${i[0].raw.r.name}`, label: c => ` ♥ ${Math.round(c.raw.y)} bpm · ${mi1(c.raw.r.miles)} mi @ ${fmtPace(c.raw.r.sec / c.raw.r.miles)}/mi` } } },
    scales: { x: { type: 'linear', min: x0, max: x1, ticks: { callback: dateTick, maxTicksLimit: 6, maxRotation: 0 } }, y: { beginAtZero: false } } }) });
}

/* ---------- render + events ---------- */
const TITLES = { today: 'Today', plan: 'Plan', charts: 'Charts', runs: 'Runs', settings: 'Settings', fund: 'Fundraising' };
function render() {
  const view = document.getElementById('view');
  document.getElementById('hdr-title').textContent = TITLES[S.tab];
  document.getElementById('hdr-eyebrow').textContent = S.plan ? `${S.plan.race.name} · ${fmtHM(S.plan.race.goalSec)} goal` : 'Marathon Trainer';
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  const fn = { today: viewToday, plan: viewPlan, charts: viewCharts, runs: viewRuns, settings: viewSettings, fund: viewFund }[S.tab];
  view.innerHTML = fn();
  if (S.tab === 'plan') view.querySelector('.week.current')?.scrollIntoView({ block: 'center' });
  S.charts.forEach(c => c.destroy()); S.charts = [];
  if (S.tab === 'charts') drawCharts(); else if (S.tab === 'fund') drawFundChart();
}

document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
});
document.getElementById('log-btn').addEventListener('click', () => editWorkout());
document.getElementById('view').addEventListener('click', async e => {
  const th = e.target.closest('[data-thank]'); if (th) { const id = th.dataset.thank; if (S.thanks[id]) delete S.thanks[id]; else S.thanks[id] = true; save('mt.thanks', S.thanks); render(); return; }
  const row = e.target.closest('[data-wid]'); if (row) { editWorkout(row.dataset.wid); return; }
  const wk = e.target.closest('.week'); if (wk) { document.getElementById('wd-' + wk.dataset.week).classList.toggle('open'); return; }
  const f = e.target.closest('[data-filter]'); if (f) { S.runFilter = f.dataset.filter; render(); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  const readKeys = () => { const id = document.getElementById('cid'), sec = document.getElementById('csec'); if (id) { S.strava.clientId = id.value.trim(); S.strava.clientSecret = sec.value.trim(); save('mt.strava', S.strava); } };
  if (act === 'import') pickFile();
  else if (act === 'goto-settings') { S.tab = 'settings'; render(); window.scrollTo(0, 0); }
  else if (act === 'goto-fund') { S.tab = 'fund'; render(); window.scrollTo(0, 0); }
  else if (act === 'goto-today') { S.tab = 'today'; render(); window.scrollTo(0, 0); }
  else if (act === 'share-fund') { e.stopPropagation(); shareFund(); }
  else if (act === 'fund-refresh') { e.preventDefault(); loadFund(true); }
  else if (act === 'fund-save') {
    const url = document.getElementById('fundurl').value.trim(), id = ggId(url);
    if (!id) { toast('Paste the full GivenGain project link (it ends in a number)', 5000); return; }
    S.fund = { url: /^https?:/.test(url) ? url : `https://www.givengain.com/project/${id}`, id, data: S.fund?.id === id ? S.fund.data : null, at: S.fund?.at };
    save('mt.fund', S.fund); a.disabled = true; await loadFund(true); a.disabled = false;
  }
  else if (act === 'edit-week') editWeek(+a.dataset.i);
  else if (act === 'edit-goals') editGoals();
  else if (act === 'gs-import') { a.disabled = true; await importSheet(document.getElementById('gslink').value); a.disabled = false; }
  else if (act === 'log') editWorkout();
  else if (act === 'restore') restoreBackup();
  else if (act === 'connect') { readKeys(); stravaAuthorize(); }
  else if (act === 'code') { readKeys(); const c = document.getElementById('code').value.trim(); if (!c) return; try { await exchangeCode(c); } catch (err) { toast(err.message, 5000); } }
  else if (act === 'sync') sync(true);
  else if (act === 'disconnect') { if (confirm('Disconnect Strava? Synced activities will be removed from this phone.')) { S.strava = { clientId: S.strava.clientId, clientSecret: S.strava.clientSecret }; S.acts = []; save('mt.strava', S.strava); save('mt.acts', []); render(); } }
  else if (act === 'export') exportBackup();
  else if (act === 'reset') { if (confirm('Erase your plan, all workouts and Strava keys from this device? Back up first if you might want them.')) { ['mt.plan', 'mt.workouts', 'mt.strava', 'mt.acts', 'mt.lastSync', 'mt.gsheet', 'mt.fund', 'mt.thanks'].forEach(k => localStorage.removeItem(k)); location.reload(); } }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => S.tab === 'charts' && drawCharts());

/* ---------- boot ---------- */
(async function boot() {
  const q = new URLSearchParams(location.search);
  if (q.get('state') === 'mt' && (q.get('code') || q.get('error'))) {
    history.replaceState(null, '', location.pathname);
    if (q.get('error')) toast('Strava: access was not granted', 4000);
    else if (!/activity:read/.test(q.get('scope') || '')) toast('Please allow "View data about your activities" when connecting', 5000);
    else if (!stravaReady()) {
      // iOS home-screen apps and Safari keep separate storage; hand the code across manually.
      S.tab = 'settings'; render();
      document.getElementById('view').insertAdjacentHTML('afterbegin', `<div class="card"><b>Almost there</b><p class="note">Copy this code, open the Marathon app from your home screen, and paste it under Settings › Strava › "Paste authorization code" (within a few minutes).</p><input type="text" readonly value="${esc(q.get('code'))}" onclick="this.select()"><button class="btn" onclick="navigator.clipboard.writeText('${esc(q.get('code'))}').then(()=>this.textContent='Copied ✓')">Copy code</button></div>`);
      return;
    } else {
      render();
      try { await exchangeCode(q.get('code')); } catch (e) { toast(e.message, 5000); }
      return;
    }
  }
  render();
  navigator.storage?.persist?.().catch(() => {});
  if (S.fund?.id && (!S.fund.at || Date.now() - S.fund.at > 30 * 60e3)) loadFund(false);
  if (stravaConnected() && (!S.lastSync || Date.now() - S.lastSync > 30 * 60e3)) sync(false);
})();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

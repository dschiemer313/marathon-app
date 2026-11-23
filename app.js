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
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const str = v => (typeof v === 'string' ? v.trim() : '');

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
  // half-marathon benchmark block
  let bench = null;
  const bi = rows.findIndex(r => r.some(v => /benchmark/i.test(str(v))));
  if (bi >= 0) {
    const bc = rows[bi].findIndex(v => /benchmark/i.test(str(v)));
    const near = (re) => { for (let i = bi + 1; i < Math.min(rows.length, bi + 8); i++) if (re.test(str(rows[i][bc])) && isNum(rows[i][bc + 1])) return rows[i][bc + 1]; return null; };
    const bd = near(/^Race date/i), bdist = near(/^Distance/i), bt = near(/^Finish time/i);
    if (bd && bdist && bt) bench = { date: serialToISO(bd), miles: bdist, sec: fracToSec(bt), name: String(rows[bi][bc]).trim() };
  }

  const lastLong = weeks[weeks.length - 1];
  const race = {
    date: raceSerial ? serialToISO(raceSerial) : addDays(lastLong.start, 1),
    goalSec, distance: dist,
    goalPace: goalPace ? fracToSec(goalPace) : goalSec / dist,
    easyPace: easy ? fracToSec(easy) : goalSec / dist + 75,
    quickPace: quick ? fracToSec(quick) : goalSec / dist - 25,
    name: (rows.flat().find(v => /marathon.*plan/i.test(str(v))) || 'Marathon').replace(/\s*[–—-]?\s*sandbox.*$/i, '').replace(/\s*plan$/i, '').trim(),
  };
  return { race, weeks, log, bench, fileName, importedAt: new Date().toISOString() };
}

async function importFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    S.plan = parseWorkbook(wb, file.name);
    save('mt.plan', S.plan);
    toast(`Imported ${S.plan.weeks.length} weeks from ${file.name}`);
    render();
  } catch (e) {
    console.error(e); toast('Import failed: ' + e.message, 5000);
  }
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
const sheetCutoff = () => (S.plan && S.plan.log.length ? S.plan.log.reduce((m, l) => (l.date > m ? l.date : m), '') : null);
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
  const btn = document.getElementById('sync-btn'); btn.classList.add('spin');
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
  const cut = sheetCutoff();
  const out = S.acts.filter(a => (a.isRun || a.isXT) && (!cut || a.date > cut));
  if (S.plan) for (const [i, l] of S.plan.log.entries()) {
    if (l.miles > 0) out.push({ id: 'x' + i, date: l.date, time: '', name: 'Run (spreadsheet)', type: 'Run', isRun: true, isXT: false, miles: l.miles, sec: l.sec, hr: null, source: 'sheet' });
    if (l.xt) out.push({ id: 'f' + i, date: l.date, time: '', name: 'F45 (spreadsheet)', type: 'F45', isRun: false, isXT: true, miles: 0, sec: 0, hr: null, source: 'sheet' });
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
    ? [r.type, fmtDur(r.sec), r.sec ? fmtPace(r.sec / r.miles) + '/mi' : '', r.hr ? `♥ ${Math.round(r.hr)}` : '']
    : ['Cross-train · ' + (XT_LABEL[r.type] || r.type), r.hr ? `♥ ${Math.round(r.hr)}` : ''];
  const right = r.isRun ? `${mi1(r.miles)}<small>mi</small>` : r.sec ? `${Math.round(r.sec / 60)}<small>min</small>` : `✓<small>done</small>`;
  return `<div class="run"><div class="date"><b>${d.getDate()}</b><span>${MON[d.getMonth()]}</span></div>
    <div class="grow"><div class="nm">${esc(r.name)}</div><div class="meta">${esc(meta.filter(Boolean).join(' · '))}</div></div>
    <div class="mi">${right}</div></div>`;
};
const xtRow = w => {
  if (!w.xtTarget && !w.xt) return '';
  const full = w.xt >= w.xtTarget;
  const detail = w.xtActs.length ? w.xtActs.map(a => `${DOW[parseISO(a.date).getDay()]} ${XT_LABEL[a.type] || a.type}`).join(' · ') : 'F45, strength, or HIIT';
  return `<div class="session"><div class="check ${full ? 'done' : w.xt ? 'partial' : ''}">${full ? '✓' : ''}</div>
    <div><div class="t">Cross-train</div><div class="d">${esc(detail)}</div></div><div class="m">${w.xt}/${w.xtTarget || 0}</div></div>`;
};
const emptyPlan = () => `<div class="card empty"><div class="big">🏃</div><p><b>Import your training plan</b></p>
  <p class="note">Pick your Marathon spreadsheet (.xlsx) from Files or OneDrive. The app reads the weekly plan, your paces, and your run log.</p>
  <button class="btn" data-act="import">Choose spreadsheet</button></div>`;

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
  <h2>This week</h2><div class="card tight">${sessions}${extra}${xtRow(w)}</div>
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
      + (w.runs.length ?`<div>Runs: ${w.runs.map(r => `${DOW[parseISO(r.date).getDay()]} ${mi1(r.miles)}`).join(' · ')}${w.pace ? ` · avg ${fmtPace(w.pace)}/mi` : ''}</div>` : '');
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
    <div class="card list">${list.map(runRow).join('') || '<div class="empty">Nothing here yet. Connect Strava or import your spreadsheet.</div>'}</div>`;
}

function viewSettings() {
  const P = S.plan, st = S.strava;
  return `
  <h2>Training plan</h2><div class="card">
    ${P ? `<div class="ok">✓ ${esc(P.fileName)}</div><div class="note">${P.weeks.length} weeks · race ${fmtDate(P.race.date)} · goal ${fmtHM(P.race.goalSec)} (${fmtPace(P.race.goalPace)}/mi) · easy ${fmtPace(P.race.easyPace)}/mi · ${P.log.length} logged runs · imported ${new Date(P.importedAt).toLocaleDateString()}</div>` : '<div class="note">No plan imported yet.</div>'}
    <button class="btn ${P ? 'secondary' : ''}" data-act="import">${P ? 'Re-import spreadsheet' : 'Import spreadsheet'}</button>
    ${sheetCutoff() ? `<div class="note" style="margin-top:8px"><b>Runs through ${fmtDate(sheetCutoff())}</b> come from the spreadsheet. After that, Strava adds your runs plus cross-training (F45, strength, HIIT). Walks and other activities are ignored.</div>` : ''}
    <div class="note" style="margin-top:8px">Re-import any time you edit the plan in Excel. If you log more runs there, the handoff date moves forward with it.</div></div>

  <h2>Strava</h2><div class="card">
    ${stravaConnected() ? `<div class="ok">✓ Connected${st.athlete?.name ? ' as ' + esc(st.athlete.name) : ''}</div><div class="note">${S.acts.length} activities · last sync ${S.lastSync ? new Date(S.lastSync).toLocaleString() : 'never'}</div>
      <button class="btn strava" data-act="sync">Sync now</button><button class="btn danger" data-act="disconnect">Disconnect</button>`
    : `<div class="note">Create a free API app at <b>strava.com/settings/api</b> with <i>Authorization Callback Domain</i> set to <code>${esc(location.hostname || 'localhost')}</code>, then paste its keys here.</div>
      <label class="f" for="cid">Client ID</label><input id="cid" type="text" inputmode="numeric" autocomplete="off" value="${esc(st.clientId || '')}">
      <label class="f" for="csec">Client Secret</label><input id="csec" type="password" autocomplete="off" value="${esc(st.clientSecret || '')}">
      <button class="btn strava" data-act="connect">Connect with Strava</button>
      <details style="margin-top:14px"><summary class="note">Connected in Safari but the app didn't pick it up?</summary>
        <label class="f" for="code">Paste authorization code</label><input id="code" type="text" autocomplete="off">
        <button class="btn secondary" data-act="code">Use code</button></details>`}
    <div class="note" style="margin-top:10px">Keys and tokens stay on this phone only.</div></div>

  <h2>Data</h2><div class="card">
    <button class="btn secondary" data-act="export">Export data (JSON)</button>
    <button class="btn danger" data-act="reset">Reset app</button></div>
  <p class="note" style="text-align:center;margin-top:16px">Apple Watch runs reach the app through Strava.<br>Today: ${fmtDate(TODAY)}, ${parseISO(TODAY).getFullYear()}</p>`;
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
const TITLES = { today: 'Today', plan: 'Plan', charts: 'Charts', runs: 'Runs', settings: 'Settings' };
function render() {
  const view = document.getElementById('view');
  document.getElementById('hdr-title').textContent = TITLES[S.tab];
  document.getElementById('hdr-eyebrow').textContent = S.plan ? `${S.plan.race.name} · ${fmtHM(S.plan.race.goalSec)} goal` : 'Marathon Trainer';
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  const fn = { today: viewToday, plan: viewPlan, charts: viewCharts, runs: viewRuns, settings: viewSettings }[S.tab];
  view.innerHTML = fn();
  if (S.tab === 'plan') view.querySelector('.week.current')?.scrollIntoView({ block: 'center' });
  if (S.tab === 'charts') drawCharts(); else { S.charts.forEach(c => c.destroy()); S.charts = []; }
}

document.querySelector('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
});
document.getElementById('sync-btn').addEventListener('click', () => sync(true));
document.getElementById('view').addEventListener('click', async e => {
  const wk = e.target.closest('.week'); if (wk) { document.getElementById('wd-' + wk.dataset.week).classList.toggle('open'); return; }
  const f = e.target.closest('[data-filter]'); if (f) { S.runFilter = f.dataset.filter; render(); return; }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  const readKeys = () => { const id = document.getElementById('cid'), sec = document.getElementById('csec'); if (id) { S.strava.clientId = id.value.trim(); S.strava.clientSecret = sec.value.trim(); save('mt.strava', S.strava); } };
  if (act === 'import') pickFile();
  else if (act === 'connect') { readKeys(); stravaAuthorize(); }
  else if (act === 'code') { readKeys(); const c = document.getElementById('code').value.trim(); if (!c) return; try { await exchangeCode(c); } catch (err) { toast(err.message, 5000); } }
  else if (act === 'sync') sync(true);
  else if (act === 'disconnect') { if (confirm('Disconnect Strava? Synced activities will be removed from this phone.')) { S.strava = { clientId: S.strava.clientId, clientSecret: S.strava.clientSecret }; S.acts = []; save('mt.strava', S.strava); save('mt.acts', []); render(); } }
  else if (act === 'export') {
    const blob = new Blob([JSON.stringify({ plan: S.plan, activities: S.acts }, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(blob), l = document.createElement('a'); l.href = u; l.download = `marathon-data-${TODAY}.json`; l.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  else if (act === 'reset') { if (confirm('Erase the plan, Strava keys and synced runs from this device?')) { ['mt.plan', 'mt.strava', 'mt.acts', 'mt.lastSync'].forEach(k => localStorage.removeItem(k)); location.reload(); } }
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
  if (stravaConnected() && (!S.lastSync || Date.now() - S.lastSync > 30 * 60e3)) sync(false);
})();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

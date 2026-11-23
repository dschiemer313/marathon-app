/* Marathon Trainer: donor miles. Dedicate each Boston mile (and training long runs) to a donor.
   Loaded before app.js; uses its helpers and state at call time. Saved in S.ded:
   { race: { '1'…'26', '26.2': { name, did, note, told } }, train: { 'w12': { names: [], note, told } } } */
'use strict';

const RACE_SLOTS = [...Array.from({ length: 26 }, (_, i) => String(i + 1)), '26.2'];
const MILE_NOTES = {
  1: 'The start in Hopkinton, all downhill', 2: 'Ashland, still dropping', 3: 'Ashland, settling in', 4: 'Into Framingham',
  5: 'Framingham', 6: 'Framingham train depot', 7: 'Natick', 8: 'Natick, past Lake Cochituate', 9: 'Natick',
  10: 'Natick center', 11: 'Into Wellesley', 12: 'Wellesley College approach', 13: 'The Wellesley scream tunnel',
  14: 'Past halfway, Wellesley', 15: 'Wellesley Hills', 16: 'The big drop to Newton Lower Falls', 17: 'Firehouse turn, first Newton hill',
  18: 'Newton hills', 19: 'Newton hills', 20: 'Newton hills, building to Heartbreak', 21: 'Heartbreak Hill',
  22: 'Boston College crowds', 23: 'Cleveland Circle', 24: 'Beacon Street, Brookline', 25: 'Kenmore and the Citgo sign',
  26: 'Right on Hereford', '26.2': 'Left on Boylston to the finish',
};
// Order the "biggest gifts" auto-fill hands out miles in: the most meaningful first.
const MILE_PRIORITY = ['21', '26.2', '13', '26', '17', '25', '1', '20', '14', '18', '19', '16', '22', '24', '23', '12', '2', '10', '15', '11', '3', '6', '9', '5', '7', '4', '8'];

const dedSave = () => save('mt.ded', S.ded);
const raceDed = () => S.ded.race;
// Named donors, combined by name (some people give twice), biggest total first.
function donorList() {
  const out = {};
  for (const x of S.fund?.data?.donations || []) {
    if (!x.donor || x.donor === 'Anonymous') continue;
    const k = x.donor.trim();
    const o = (out[k] ||= { name: k, amount: 0, first: x.date, ids: [] });
    o.amount += x.amount; o.ids.push(x.id); if (x.date < o.first) o.first = x.date;
  }
  return Object.values(out).sort((a, b) => b.amount - a.amount);
}
const milesFor = name => {
  const n = (name || '').trim().toLowerCase(); if (!n) return [];
  return RACE_SLOTS.filter(k => (raceDed()[k]?.name || '').trim().toLowerCase() === n);
};
const trainFor = name => {
  const n = (name || '').trim().toLowerCase();
  return Object.entries(S.ded.train).filter(([, v]) => (v.names || []).some(x => x.trim().toLowerCase() === n)).map(([k]) => k);
};
const openMiles = () => RACE_SLOTS.filter(k => !raceDed()[k]?.name).length;

// Upcoming and recent long runs in the plan, keyed by week.
function longRuns() {
  if (!S.plan) return [];
  return weekStats().map(w => {
    const s = w.sessions.find(x => x.kind === 'long'); if (!s) return null;
    return { key: 'w' + w.wk, wk: w.wk, mi: s.mi, date: s.done ? s.run.date : addDays(w.start, 6), done: s.done, run: s.run, past: w.past, notes: s.notes, phase: w.phase };
  }).filter(Boolean);
}
// Which name a training mile belongs to: names split the run into equal chunks, in order.
function trainMileName(key, mileIdx, totalMi) {
  const names = S.ded.train[key]?.names || []; if (!names.length) return '';
  const per = Math.max(1, Math.ceil(totalMi / names.length));
  return names[Math.min(names.length - 1, Math.floor(mileIdx / per))];
}
function trainKeyForRun(a) {
  const lr = longRuns().find(l => l.done && l.run && String(l.run.id) === String(a.id));
  return lr ? lr.key : null;
}

/* ---------- messages ---------- */
// "Sarah Jones" -> "Sarah"; group names ("The Hendersons", "Bob & Sue") stay whole.
const firstName = n => (/^the |family|&| and /i.test(n) || n.trim().split(/\s+/).length !== 2 ? n.trim() : n.trim().split(/\s+/)[0]);
// Name as shown on public images: first name + last initial unless full names are switched on.
const publicName = n => { n = n.trim(); if (S.ded.fullNames || /^the |family|&| and /i.test(n)) return n; const w = n.split(/\s+/); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : n; };
function raceMsg(slot) {
  const d = raceDed()[slot], first = firstName(d.name);
  const where = MILE_NOTES[slot];
  return `${first}, thank you so much for supporting my Boston Marathon run for the Boys & Girls Club of Lawrence! I'm dedicating mile ${slot} to you (${where}).${slot === '21' ? ' That\'s Heartbreak Hill, so I\'ll be thinking of you all the way up.' : slot === '26.2' ? ' You\'re bringing me home.' : ''} Race day is ${fmtDate(S.plan.race.date)}.`;
}
function trainMsg(key) {
  const d = S.ded.train[key], lr = longRuns().find(l => l.key === key); if (!lr) return '';
  const first = d.names.map(firstName);
  const names = first.length > 1 ? first.slice(0, -1).join(', ') + ' and ' + first[first.length - 1] : first[0];
  const ran = lr.done;
  return `${names}, ${ran ? `my ${mi1(lr.run.miles)}-mile long run on ${fmtDate(lr.date)} was` : `my ${lr.mi}-mile long run this ${DOW[parseISO(lr.date).getDay()]} is`} dedicated to you. Thank you for backing my Boston Marathon run for the Boys & Girls Club of Lawrence!`;
}
async function sendDed(kind, key) {
  const text = kind === 'race' ? raceMsg(key) : trainMsg(key);
  const rec = kind === 'race' ? raceDed()[key] : S.ded.train[key];
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast('Message copied. Paste it into a text or email'); }
    rec.told = true; dedSave(); render();
  } catch (e) { if (e && e.name !== 'AbortError') toast('Could not open sharing'); }
}

/* ---------- auto-fill ---------- */
function autoFill(mode) {
  const used = new Set(RACE_SLOTS.map(k => raceDed()[k]?.name?.trim().toLowerCase()).filter(Boolean));
  let pool = donorList().filter(d => !used.has(d.name.toLowerCase()));
  if (mode === 'order') pool.sort((a, b) => (a.first < b.first ? -1 : 1));
  if (mode === 'random') for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const slots = (mode === 'size' ? MILE_PRIORITY : RACE_SLOTS).filter(k => !raceDed()[k]?.name);
  let n = 0;
  slots.forEach(k => { const d = pool.shift(); if (d) { raceDed()[k] = { name: d.name, did: d.ids[0], told: false }; n++; } });
  dedSave(); render();
  toast(n ? `Dedicated ${n} mile${n > 1 ? 's' : ''}` : pool.length ? 'Every mile already has someone' : 'Every named donor already has a mile');
}

/* ---------- views ---------- */
function viewMiles() {
  if (!S.plan) return emptyPlan();
  const dl = donorList(), R = raceDed();
  const assigned = RACE_SLOTS.filter(k => R[k]?.name), told = assigned.filter(k => R[k].told).length;
  const named = new Set(assigned.map(k => R[k].name.toLowerCase()));
  Object.values(S.ded.train).forEach(v => (v.names || []).forEach(n => named.add(n.toLowerCase())));
  const waiting = dl.filter(d => !named.has(d.name.toLowerCase()));
  const segs = racePlan(S.plan.race.goalSec);
  const clockAt = k => fmtDur(segs.find(s => String(s.mile) === k)?.elapsed || 0);
  const rows = RACE_SLOTS.map(k => {
    const d = R[k], big = ['21', '26.2', '13', '17', '25', '1'].includes(k);
    return `<div class="dm-row${d?.name ? '' : ' open'}">
      <button class="dm-num${big ? ' big' : ''}" data-dslot="${k}" aria-label="Mile ${k}">${k}</button>
      <button class="dm-main" data-dslot="${k}"><div class="dm-name">${d?.name ? esc(d.name) : '<span class="muted">Open, tap to dedicate</span>'}</div>
        <div class="dm-where">${esc(MILE_NOTES[k])} · ${clockAt(k)}${d?.note ? ' · ' + esc(d.note) : ''}</div></button>
      ${d?.name ? `<button class="dm-told${d.told ? ' on' : ''}" data-dtold="race:${k}" aria-label="${d.told ? 'Told' : 'Mark as told'}">${d.told ? '✓' : ''}</button>
        <button class="chip-btn" data-dsend="race:${k}">Share</button>` : ''}</div>`;
  }).join('');
  const lrs = longRuns().filter(l => !l.past || S.ded.train[l.key]);
  const trows = lrs.map(l => {
    const d = S.ded.train[l.key];
    return `<div class="dm-row${d ? '' : ' open'}">
      <div class="dm-num wk">W${l.wk}</div>
      <button class="dm-main" data-dtrain="${l.key}"><div class="dm-name">${d ? esc(d.names.join(', ')) : '<span class="muted">Dedicate this run</span>'}</div>
        <div class="dm-where">${l.done ? '✓ ' + mi1(l.run.miles) : l.mi} mi long run · ${DOW[parseISO(l.date).getDay()]} ${fmtDate(l.date)}${d && d.names.length > 1 ? ` · ${Math.ceil(l.mi / d.names.length)} mi each` : ''}</div></button>
      ${d ? `<button class="dm-told${d.told ? ' on' : ''}" data-dtold="train:${l.key}" aria-label="${d.told ? 'Told' : 'Mark as told'}">${d.told ? '✓' : ''}</button>
        <button class="chip-btn" data-dsend="train:${l.key}">Share</button>` : ''}</div>`;
  }).join('');
  return `<button class="chip-btn" data-act="goto-fund" style="margin:4px 0 10px">‹ Fundraising</button>
    <div class="card"><div class="dm-head"><div><div class="hero-num">${assigned.length}<span class="dm-of"> / 27</span></div><div class="hero-sub">Boston miles dedicated · ${told} told</div></div>
      ${ringsSVG([{ k: 'Dedicated', p: assigned.length / 27, st: null, v: assigned.length, of: 27 }, { k: 'Told', p: told / 27, st: told === 27 ? 'good' : null, v: told, of: 27 }], 84)}</div>
      ${!S.fund?.data ? '<div class="note" style="margin-top:8px">Add your GivenGain page in Settings → Fundraising to pick from your donor list. You can still type names by hand.</div>' : waiting.length ? `<div class="note" style="margin-top:8px">${waiting.length} named donor${waiting.length > 1 ? 's don\'t' : ' doesn\'t'} have a mile yet${waiting.length <= 3 ? ': ' + waiting.map(w => esc(w.name)).join(', ') : ''}.</div>` : ''}
      ${openMiles() && dl.length ? `<div class="dm-fill"><span class="note">Fill the open miles:</span>
        <button class="chip-btn" data-act="ded-fill" data-mode="size">Biggest gifts → biggest miles</button>
        <button class="chip-btn" data-act="ded-fill" data-mode="order">In order they gave</button>
        <button class="chip-btn" data-act="ded-fill" data-mode="random">Random draw</button></div>` : ''}
      <button class="btn" data-act="ded-board" style="margin-top:12px">📣 Share the miles board</button>
      <div class="note" style="margin-top:6px">A story-sized image of all 27 miles: who has each one and which are still open to claim. ${openMiles() ? `Open miles are the hook: ${openMiles()} open is a good reason to post now.` : 'Tip: leave a few miles open so people have something to claim.'}</div>
      <label class="dm-opt"><input type="checkbox" data-act="ded-fullnames"${S.ded.fullNames ? ' checked' : ''}> Full last names on images <span class="muted">(off: “Lynn L.”)</span></label></div>

    <h2>Race day · Boston</h2>
    <div class="card list dm-list">${rows}</div>
    ${assigned.length ? '<button class="link dm-clear" data-act="ded-clear">Clear all race miles</button>' : ''}

    <h2>Training long runs</h2>
    <p class="note" style="margin:-2px 4px 8px">Dedicate a long run to one person, or to several and the miles are split between them in order. Their names show on the run's mile splits.</p>
    <div class="card list dm-list">${trows || '<div class="empty">No long runs left in the plan.</div>'}</div>`;
}

function donorPicker(current) {
  const dl = donorList();
  if (!dl.length) return '';
  const opts = dl.map(d => {
    const m = milesFor(d.name);
    return `<option value="${esc(d.name)}"${current && current.toLowerCase() === d.name.toLowerCase() ? ' selected' : ''}>${esc(d.name)} · ${money(d.amount)}${m.length ? ' · mile ' + m.join(', ') : ''}</option>`;
  }).join('');
  return `<label class="f" for="dpick">Donor</label><select id="dpick" name="pick"><option value="">Choose a donor…</option>${opts}</select>`;
}
function editRaceMile(k) {
  const d = raceDed()[k] || {};
  const inList = d.name && donorList().some(x => x.name.toLowerCase() === d.name.toLowerCase());
  const f = openSheet(`${sheetHead('Mile ' + k)}
    <div class="note" style="margin:8px 0">${esc(MILE_NOTES[k])}</div>
    ${donorPicker(inList ? d.name : '')}
    <label class="f" for="dname">${donorList().length ? 'Or type a name' : 'Name'}</label><input id="dname" name="name" type="text" value="${esc(inList ? '' : d.name || '')}" placeholder="e.g. Grandma, the Smith family">
    <label class="f" for="dnote">Note (optional)</label><input id="dnote" name="note" type="text" value="${esc(d.note || '')}" placeholder="e.g. in memory of…">
    ${d.name ? '<button type="button" class="btn danger" id="dremove" style="margin-top:16px">Remove dedication</button>' : ''}`, fd => {
    const name = (fd.get('name') || '').trim() || (fd.get('pick') || '').trim();
    if (!name) { delete raceDed()[k]; dedSave(); return 'Mile ' + k + ' is open'; }
    const other = milesFor(name).filter(x => x !== k);
    const dn = donorList().find(x => x.name.toLowerCase() === name.toLowerCase());
    raceDed()[k] = { name, did: dn?.ids[0] || null, note: (fd.get('note') || '').trim(), told: d.name === name ? !!d.told : false };
    dedSave();
    return `Mile ${k} is for ${name}${other.length ? ` (also mile ${other.join(', ')})` : ''}`;
  });
  f.querySelector('#dpick')?.addEventListener('change', () => { if (f.elements.pick.value) f.elements.name.value = ''; });
  f.querySelector('#dremove')?.addEventListener('click', () => { delete raceDed()[k]; dedSave(); closeSheet(); render(); toast('Mile ' + k + ' is open'); });
}
function editTrainRun(key) {
  const lr = longRuns().find(l => l.key === key); if (!lr) return;
  const d = S.ded.train[key] || { names: [] };
  const dl = donorList();
  const f = openSheet(`${sheetHead(`Week ${lr.wk} long run`)}
    <div class="note" style="margin:8px 0">${lr.done ? mi1(lr.run.miles) : lr.mi} mi · ${DOW[parseISO(lr.date).getDay()]} ${fmtDate(lr.date)}. Add one or more people; with several, the miles are split between them in order.</div>
    ${dl.length ? `<label class="f" for="dpick">Add a donor</label><select id="dpick"><option value="">Choose a donor…</option>${dl.map(x => `<option value="${esc(x.name)}">${esc(x.name)} · ${money(x.amount)}${trainFor(x.name).length ? ' · has a run' : ''}</option>`).join('')}</select>` : ''}
    <label class="f" for="dnames">Names, one per line</label><textarea id="dnames" name="names" rows="4" placeholder="Sarah&#10;The Hendersons">${esc(d.names.join('\n'))}</textarea>
    ${d.names.length ? '<button type="button" class="btn danger" id="dremove" style="margin-top:16px">Remove dedication</button>' : ''}`, fd => {
    const names = String(fd.get('names') || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) { delete S.ded.train[key]; dedSave(); return 'Dedication removed'; }
    S.ded.train[key] = { names, told: d.told && d.names.join() === names.join() };
    dedSave();
    return `Week ${lr.wk} long run is for ${names.join(', ')}`;
  });
  f.querySelector('#dpick')?.addEventListener('change', e => {
    const v = e.target.value; if (!v) return;
    const ta = f.elements.names, cur = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!cur.some(c => c.toLowerCase() === v.toLowerCase())) ta.value = [...cur, v].join('\n');
    e.target.value = '';
  });
  f.querySelector('#dremove')?.addEventListener('click', () => { delete S.ded.train[key]; dedSave(); closeSheet(); render(); toast('Dedication removed'); });
}

/* ---------- small pieces used elsewhere ---------- */
function milesCard() {
  if (!S.plan || !S.fund?.data) return '';
  const n = 27 - openMiles();
  return `<button class="card race-link" data-act="goto-miles"><span>🎽</span><div><b>Donor miles · ${n} of 27 dedicated</b>
    <div class="note">${n ? 'Each Boston mile run for someone who backed you' : 'Dedicate each Boston mile to a donor'}</div></div><span class="chev">›</span></button>`;
}
const mileBadge = name => { const m = milesFor(name); return m.length ? ` <span class="dm-badge">mile ${m.join(', ')}</span>` : ''; };
const openMilesLine = () => { const n = openMiles(); return n ? ` ${n} of my 27 Boston miles are still open: donate and I'll run one for you.` : ''; };

/* ---------- social images: miles board + per-donor shout-outs ---------- */
const IMG = { bg: '#0f1b2d', panel: '#1b3150', ink: '#ffffff', soft: '#c3cede', hot: '#ff7a3d', blue: '#4a90e2' };
const fundUrl = () => S.fund?.url || '';
function wrapText(g, text, x, y, maxW, lh, maxLines = 9) {
  const words = String(text).split(' '); let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(t).width > maxW && line) {
      if (++n === maxLines) { while (line && g.measureText(line + '…').width > maxW) line = line.slice(0, -1); g.fillText(line + '…', x, y); return y + lh; }
      g.fillText(line, x, y); y += lh; line = words[i];
    } else line = t;
  }
  if (line) { while (g.measureText(line).width > maxW && line.length > 1) line = line.slice(0, -2) + '…'; g.fillText(line, x, y); y += lh; }
  return y;
}
function drawProfile(g, x, y, w, h, hi) {
  const px = mi => x + (mi / 26.2) * w, py = e => y + h - (e / 520) * h;
  const pts = BOS_ELEV.map((e, i) => [px(Math.min(i, 26.2)), py(e)]);
  const shape = () => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); };
  shape(); g.fillStyle = 'rgba(74,144,226,.22)'; g.fill();
  if (hi != null) {
    const from = hi === '26.2' ? 26 : +hi - 1, to = hi === '26.2' ? 26.2 : +hi;
    g.save(); g.beginPath(); g.rect(px(from), y - 20, Math.max(6, px(to) - px(from)), h + 20); g.clip(); shape(); g.fillStyle = IMG.hot; g.fill(); g.restore();
  }
  g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
  g.strokeStyle = IMG.blue; g.lineWidth = 5; g.lineJoin = 'round'; g.stroke();
}
function newCanvas(W, H) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.fillStyle = IMG.bg; g.fillRect(0, 0, W, H);
  return { cv, g, F: getComputedStyle(document.body).fontFamily };
}
const rrect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
async function shareCanvas(cv, fileName, caption) {
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const file = new File([blob], fileName, { type: 'image/png' });
  // Instagram and some others drop the text, so put the caption on the clipboard too.
  try { await navigator.clipboard?.writeText(caption); } catch {}
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: caption }); toast('Caption copied too. Paste it into your post', 3500); return true; }
    catch (e) { return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Image saved and caption copied'); return true;
}

// The whole board: 27 tiles, claimed or open. Story size (1080×1920).
function drawBoard() {
  const W = 1080, H = 1920, { cv, g, F } = newCanvas(W, H), R = raceDed(), open = openMiles(), d = S.fund?.data;
  g.fillStyle = IMG.hot; g.font = `800 30px ${F}`; g.fillText(`BOSTON MARATHON · ${fmtDate(S.plan.race.date).toUpperCase()}, ${parseISO(S.plan.race.date).getFullYear()}`, 80, 150);
  g.fillStyle = IMG.ink; g.font = `900 96px ${F}`; g.fillText('Run Boston', 80, 262); g.fillText('with me', 80, 366);
  g.fillStyle = IMG.soft; g.font = `500 38px ${F}`;
  wrapText(g, 'Every mile I run is dedicated to someone who gives to the Boys & Girls Club of Lawrence.', 80, 440, 920, 50, 3);
  drawProfile(g, 80, 560, 920, 120, null);
  const cols = 4, gap = 16, tw = (920 - gap * (cols - 1)) / cols, th = 124, y0 = 730;
  RACE_SLOTS.forEach((k, i) => {
    const x = 80 + (i % cols) * (tw + gap), y = y0 + Math.floor(i / cols) * (th + gap), name = R[k]?.name;
    g.save(); rrect(g, x, y, tw, th, 18);
    if (name) { g.fillStyle = IMG.panel; g.fill(); }
    else { g.fillStyle = 'rgba(255,122,61,.10)'; g.fill(); g.setLineDash([12, 9]); g.strokeStyle = IMG.hot; g.lineWidth = 4; g.stroke(); g.setLineDash([]); }
    g.fillStyle = IMG.hot; g.font = `800 24px ${F}`; g.fillText('MILE ' + k, x + 18, y + 38);
    if (name) { g.fillStyle = IMG.ink; g.font = `700 30px ${F}`; wrapText(g, publicName(name), x + 18, y + 76, tw - 30, 34, 2); }
    else { g.fillStyle = IMG.hot; g.font = `900 40px ${F}`; g.fillText('OPEN', x + 18, y + 94); }
    g.restore();
  });
  const yf = y0 + 7 * (th + gap) + 40;
  g.fillStyle = IMG.hot; g.font = `900 64px ${F}`;
  g.fillText(open ? `${open} mile${open > 1 ? 's' : ''} still open` : 'Every mile is spoken for', 80, yf + 40);
  g.fillStyle = IMG.ink; g.font = `600 38px ${F}`;
  g.fillText(open ? 'Donate and I\'ll run one for you.' : 'Thank you. Let\'s get to Boylston.', 80, yf + 100);
  if (d) {
    const by = yf + 150, top = Math.max(d.target || 0, d.total || 0) || 1;
    g.fillStyle = 'rgba(255,255,255,.14)'; rrect(g, 80, by, 920, 22, 11); g.fill();
    g.fillStyle = IMG.blue; rrect(g, 80, by, Math.max(22, 920 * Math.min(1, d.total / top)), 22, 11); g.fill();
    g.fillStyle = IMG.soft; g.font = `600 30px ${F}`; g.fillText(`${money(d.total)} raised of ${money(d.target)}`, 80, by + 66);
  }
  return cv;
}
// One donor's mile (or a training long run), 4:5 feed size (1080×1350).
function drawShout(kind, key) {
  const W = 1080, H = 1350, { cv, g, F } = newCanvas(W, H), open = openMiles();
  if (kind === 'race') {
    const d = raceDed()[key];
    g.fillStyle = IMG.hot; g.font = `800 30px ${F}`; g.fillText('BOSTON MARATHON · MILE DEDICATIONS', 80, 130);
    g.font = `900 200px ${F}`; g.fillText('MILE ' + key, 72, 335);
    g.fillStyle = IMG.ink; g.font = `700 50px ${F}`; wrapText(g, MILE_NOTES[key], 80, 420, 920, 60, 2);
    drawProfile(g, 80, 520, 920, 200, key);
    g.fillStyle = IMG.soft; g.font = `600 46px ${F}`; g.fillText('This mile is for', 80, 830);
    g.fillStyle = IMG.ink; g.font = `900 100px ${F}`; let y = wrapText(g, publicName(d.name), 80, 945, 920, 108, 2);
    if (d.note) { g.fillStyle = IMG.soft; g.font = `italic 500 40px ${F}`; wrapText(g, d.note, 80, y + 6, 920, 50, 2); }
  } else {
    const t = S.ded.train[key], lr = longRuns().find(l => l.key === key), mi = lr.done ? mi1(lr.run.miles) : lr.mi;
    g.fillStyle = IMG.hot; g.font = `800 30px ${F}`; g.fillText('BOSTON MARATHON TRAINING · LONG RUN', 80, 130);
    g.font = `900 220px ${F}`; g.fillText(`${mi} mi`, 72, 350);
    g.fillStyle = IMG.ink; g.font = `700 50px ${F}`; g.fillText(`${DOW[parseISO(lr.date).getDay()]} ${fmtDate(lr.date)} · week ${lr.wk}`, 80, 430);
    g.fillStyle = IMG.soft; g.font = `600 46px ${F}`; g.fillText(lr.done ? 'These miles were for' : 'These miles are for', 80, 560);
    const big = t.names.length <= 3;
    g.fillStyle = IMG.ink; g.font = `900 ${big ? 92 : 62}px ${F}`;
    let y = 670; t.names.slice(0, 6).forEach(n => { y = wrapText(g, publicName(n), 80, y, 920, big ? 104 : 74, 1); });
  }
  g.fillStyle = IMG.soft; g.font = `600 34px ${F}`; g.fillText('Running for the Boys & Girls Club of Lawrence', 80, H - 150);
  g.fillStyle = IMG.hot; g.font = `800 40px ${F}`; g.fillText(open ? `${open} Boston mile${open > 1 ? 's' : ''} still open. Want one?` : 'Thank you for getting me to Boston', 80, H - 90);
  return cv;
}
function boardCaption() {
  const open = openMiles(), u = fundUrl();
  return `I'm dedicating every mile of the Boston Marathon to someone who backs the Boys & Girls Club of Lawrence. ` +
    (open ? `${open} of my 27 miles are still open. Donate and one is yours (tell me which mile you want!) ${u}` : `All 27 are spoken for. Thank you! ${u}`);
}
function shoutCaption(kind, key) {
  const u = fundUrl(), open = openMiles(), tail = open ? ` ${open} miles are still open if you want one: ${u}` : ` ${u}`;
  if (kind === 'race') { const d = raceDed()[key]; return `Mile ${key} of Boston (${MILE_NOTES[key]}) is for ${publicName(d.name)}. Thank you for backing the Boys & Girls Club of Lawrence!${tail}`; }
  const t = S.ded.train[key], lr = longRuns().find(l => l.key === key);
  return `${lr?.done ? 'Today\'s' : 'This week\'s'} long run is for ${t.names.map(publicName).join(', ')}. Every mile of my Boston build is for the people backing the Boys & Girls Club of Lawrence.${tail}`;
}
async function shareBoard() { await shareCanvas(drawBoard(), 'boston-miles.png', boardCaption()); }
function shareChoices(kind, key) {
  const rec = kind === 'race' ? raceDed()[key] : S.ded.train[key]; if (!rec) return;
  const who = kind === 'race' ? publicName(rec.name) : rec.names.map(publicName).join(', ');
  const cv = drawShout(kind, key);
  closeSheet();
  document.body.insertAdjacentHTML('beforeend', `<div class="sheet-bg" id="sheet"><div class="sheet">
    <div class="sheet-h"><span></span><b>${kind === 'race' ? 'Mile ' + key : 'Long run'} · ${esc(who)}</b><button type="button" class="link strong" data-close>Done</button></div>
    <img class="shout-prev" alt="Shout-out image preview" src="${cv.toDataURL('image/png')}">
    <button class="btn" id="sh-post">📣 Post a shout-out</button>
    <button class="btn secondary" id="sh-msg">💬 Message ${esc(kind === 'race' ? firstName(rec.name) : 'them')} privately</button>
    <div class="note" style="margin-top:8px">The shout-out shares this image to Instagram, Facebook and the rest, and copies a caption with your donation link. The message opens Messages or Mail with a thank-you note.</div></div></div>`);
  document.body.style.overflow = 'hidden';
  const bg = document.getElementById('sheet');
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
  document.getElementById('sh-post').onclick = async () => { await shareCanvas(cv, `boston-${kind === 'race' ? 'mile-' + key : key}.png`, shoutCaption(kind, key)); };
  document.getElementById('sh-msg').onclick = () => { closeSheet(); sendDed(kind, key); };
}

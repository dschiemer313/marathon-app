/**
 * Marathon Trainer: Google Sheet link
 *
 * Paste this into your Google Sheet: Extensions › Apps Script (replace everything there).
 * Change KEY below to a long random phrase, then:
 *   Deploy › New deployment › type "Web app" › Execute as: Me › Who has access: Anyone › Deploy.
 * Copy the Web app URL. In the Marathon app (Settings › Google Sheet) paste:
 *   <Web app URL>#<KEY>
 *
 * The app reads the "Training" sheet and can change only the plan inputs
 * (phase, runs, miles, long-run notes, cross-train target) and three goal settings.
 * Cells with formulas are never overwritten.
 */
const KEY = 'CHANGE-ME-to-a-long-random-phrase';
const SHEET = 'Training';
// Leave blank if this script was created from the sheet (Extensions › Apps Script).
// For a standalone script, paste the sheet's ID (the long code in its URL between /d/ and /edit).
const SHEET_ID = '';

const WEEK_FIELDS = {
  phase: 'Phase', run1: 'Run 1:', run1Mi: 'Run 1 Mi', run2: 'Run 2:', run2Mi: 'Run 2 Mi',
  longMi: 'Run 3', longNotes: 'Long Run Notes', xtTarget: 'Cross-Train',
};
const SETTINGS = ['Goal finish time', 'Easy pace offset', 'Quicker-run offset'];

function doGet(e) { return handle_(e.parameter || {}, null); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle_(e.parameter || {}, body);
}

function handle_(params, body) {
  const key = (body && body.key) || params.key;
  if (key !== KEY) return out_({ ok: false, error: 'Wrong key: check the part after # in your link' });
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET) || ss.getSheets()[0];
  const lock = LockService.getScriptLock();
  try {
    if (body && body.action) {
      lock.waitLock(10000);
      if (body.action === 'updateWeek') updateWeek_(sh, body.wk, body.fields || {});
      else if (body.action === 'updateSettings') updateSettings_(sh, body.values || {});
      else throw new Error('Unknown action ' + body.action);
      SpreadsheetApp.flush();
    }
    return out_({ ok: true, name: ss.getName(), rows: readRows_(sh, ss.getSpreadsheetTimeZone()), at: new Date().toISOString() });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Dates and durations go back as spreadsheet serial numbers (days since 1899-12-30), like Excel.
function readRows_(sh, tz) {
  return sh.getDataRange().getValues().map(r => r.map(c => (c instanceof Date ? toSerial_(c, tz) : c === '' ? null : c)));
}
function toSerial_(d, tz) {
  const m = Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss').match(/(\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)/);
  return (Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - Date.UTC(1899, 11, 30)) / 864e5;
}

function updateWeek_(sh, wk, fields) {
  const v = sh.getDataRange().getValues();
  const h = v.findIndex(r => r.some(c => String(c).trim() === 'Wk') && r.some(c => String(c).trim() === 'Week Start'));
  if (h < 0) throw new Error('Plan header row not found');
  const head = v[h].map(c => String(c).trim());
  const wkCol = head.indexOf('Wk');
  let row = -1;
  for (let i = h + 1; i < v.length; i++) if (v[i][wkCol] !== '' && Number(v[i][wkCol]) === Number(wk)) { row = i; break; }
  if (row < 0) throw new Error('Week ' + wk + ' not found');
  Object.keys(fields).forEach(k => {
    const prefix = WEEK_FIELDS[k];
    if (!prefix) return;
    const col = head.findIndex(c => c.toLowerCase().indexOf(prefix.toLowerCase()) === 0);
    if (col < 0) return;
    const cell = sh.getRange(row + 1, col + 1);
    if (cell.getFormula()) return;
    cell.setValue(fields[k]);
  });
}

// Values are day fractions (e.g. 3:30:00 = 0.145833).
function updateSettings_(sh, values) {
  const v = sh.getDataRange().getValues();
  Object.keys(values).forEach(label => {
    if (SETTINGS.indexOf(label) < 0) return;
    for (let r = 0; r < v.length; r++) for (let c = 0; c < v[r].length - 1; c++) {
      if (String(v[r][c]).trim().indexOf(label) === 0) { sh.getRange(r + 1, c + 2).setValue(Number(values[label])); return; }
    }
  });
}

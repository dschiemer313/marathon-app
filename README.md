# Marathon Trainer

An iPhone home-screen app for Boston 2027 training. Your **plan lives in a Google Sheet** that stays in sync both ways. Runs and cross-training come from **Strava**, where your Apple Watch workouts already sync. The app shows plan-vs-actual charts and coaching tips.

**App:** https://dschiemer313.github.io/marathon-app/

No personal data is stored in this repo. Your sheet link, Strava keys, and runs are stored only on your phone.

---

## How the data flows

| Data | Source |
|---|---|
| Weekly plan, goal time, paces | Google Sheet "Marathon 2027" (Training tab), live |
| Runs up to the last date in the sheet's run log | Google Sheet run log |
| Runs after that date | Strava: Run, Trail Run, Virtual Run |
| Cross-training after that date | Strava: Workout (F45 / functional strength), Weight Training, HIIT, CrossFit |
| Ignored | Walks, hikes, rides, everything else |

- **Edit the plan anywhere.** In the app, go to Plan → tap a week → **Edit week**, or Settings → **Change goal & paces**. Changes save straight to the Google Sheet. Edits made in Google Sheets show up in the app the next time you open it or tap ⟳.
- The app only writes plan inputs: phase, run descriptions, miles, long-run notes, cross-train target, goal time, and pace offsets. It never overwrites cells with formulas, so Plan Mi, paces, and everything else keep recalculating in the sheet.
- If you change a run's miles and its description says "Easy 2 mi", the description updates to match.

## Setting up on your iPhone

1. Open the app link above in **Safari**. Tap **Share → Add to Home Screen → Add**.
2. Open **Marathon** from your home screen and go to **Settings → Google Sheet**. Paste your sheet link (the web app URL, then `#`, then your key) and tap **Link Google Sheet**.
   Your personal link isn't stored in this repo. Keep it somewhere private, like Notes.
3. **Settings → Strava.** Paste your Client ID and Client Secret, then tap **Connect with Strava**. See the Strava setup below.

**If Strava sends you back to Safari instead of the app:** the page shows a code with a **Copy code** button. Open the Marathon app, go to **Settings → Strava → "Connected in Safari but the app didn't pick it up?"**, paste the code, and tap **Use code** within a few minutes.

## Strava API app (one time)

At **strava.com/settings/api** create an app:
- **Website:** `https://dschiemer313.github.io/marathon-app/`
- **Authorization Callback Domain:** `dschiemer313.github.io`

## The Google Sheet link (already set up)

- **Sheet:** "Marathon 2027" in your Google Drive (dschiemer313@gmail.com)
- **Script:** Apps Script project "Marathon Trainer link" at script.google.com, deployed as a web app (Execute as: Me, Access: Anyone). It only answers requests that include your private key. Source: [`google-apps-script.js`](google-apps-script.js).
- **To change the key:** edit `KEY` in the script, then go to **Deploy → Manage deployments → ✎ → Version: New version → Deploy**. Re-link the app with the new key.
- **To rebuild from scratch:** create a new Apps Script project. Paste in `google-apps-script.js` and set `KEY` and `SHEET_ID` (the code in the sheet's URL between `/d/` and `/edit`). Deploy it as a Web app with access set to Anyone and authorize it.

The sheet needs these labels, which it already has:
- a **Training** tab with a plan table whose header row includes `Wk`, `Week Start`, `Phase`, `Run 1: …`, `Run 1 Mi`, `Run 2: …`, `Run 2 Mi`, `Run 3: Long (mi)`, `Long Run Notes`, `Plan Mi`, and `Cross-Train Target`
- a run log with `Date`, `Miles`, `Time`, and `F45` columns
- assumption cells labelled `Race date (Patriots' Day)`, `Goal finish time`, `Easy pace offset…`, and `Quicker-run offset…`

## What's in the app

| Tab | What you get |
|---|---|
| **Today** | Days to Boston, this week's mileage ring, planned runs and cross-training checked off automatically, goal vs predicted finish, coaching tips |
| **Plan** | All weeks by phase with planned vs actual miles. Tap a week for its runs, notes, and **Edit week**. |
| **Charts** | Weekly mileage, cumulative miles, pace per run (with goal and easy pace lines), long-run progression, cross-training vs target, predicted marathon time, Apple Watch heart rate |
| **Runs** | Every run and cross-training session, filterable |
| **Settings** | Google Sheet link, race goal and paces, Strava, data export |

**Coaching tips** are rule-based, using your sheet's paces:
- The next workout and the pace to run it at
- Too many runs left for the days left in the week
- Injury-risk warning when the last 7 days are well above your 4-week average
- Easy runs or long runs run too fast
- A long run that jumps a lot past your recent longest
- Miles ahead of or behind plan
- Predicted finish (Riegel formula) vs goal
- Cross-training: sessions left this week and when to fit them in, plus a flag if you keep missing the target
- Heart-rate efficiency
- Tips for each phase

## Updating the app

Upload changed files to this repo. Phones pick up the new version the next time the app opens with a connection.

## Run it locally (optional)

```powershell
python -m http.server 8765 --directory marathon-app
```

Then open http://localhost:8765. Strava allows `localhost` as a callback domain.

# Marathon Trainer

An iPhone home-screen app for Boston 2027 training. **The app holds your plan and workouts**, and you can edit all of it there. Your spreadsheet supplies the starting data, and **Strava** (where your Apple Watch workouts sync) adds new runs and cross-training automatically. The app shows plan-vs-actual charts and coaching tips.

**App:** https://dschiemer313.github.io/marathon-app/

No personal data is stored in this repo. Your plan, workouts, sheet link, and Strava keys are stored only on your phone.

---

## How the data flows

| Data | Source |
|---|---|
| Starting plan, goal time, paces, run history | Imported once from the Google Sheet "Marathon 2027" (or an .xlsx file) |
| New runs after the imported history | Strava: Run, Trail Run, Virtual Run |
| New cross-training | Strava: Workout (F45 / functional strength), Weight Training, HIIT, CrossFit |
| Anything else | **+ Log workout** in the app (Strava-style: type, title, distance, time, pace, heart rate, effort, notes) |
| Ignored | Walks, hikes, rides |

- **Edit anything in the app:**
  - A week of the plan: Plan → tap a week → **Edit week**, or Today → This week → **Edit**
  - Goal and paces: Settings → **Change goal & paces**
  - Any workout you logged or imported: tap it on the Runs tab to edit or delete it
- If you change a run's miles and its description says "Easy 2 mi", the description updates to match.
- **Re-importing** from the sheet (Settings → Starting data) replaces the plan and the imported history. Workouts you logged in the app are kept.
- **Back up** with Settings → Your data → **Back up to a file**. You can restore from that file. Removing the app from your home screen erases its data.

## Setting up on your iPhone

1. Open the app link above in **Safari**. Tap **Share → Add to Home Screen → Add**.
2. Open **Marathon** from your home screen, go to **Settings → Starting data**, paste your Google Sheet link (the web app URL, then `#`, then your key), and tap **Import from Google Sheet**.
   Your personal link isn't stored in this repo. Keep it somewhere private, like Notes.
3. **Settings → Strava.** Enter Client ID `300161` and your Client Secret (strava.com/settings/api → Client Secret → Show), then tap **Connect with Strava** → **Authorize**.

**If Strava sends you back to Safari instead of the app:** the page shows a code with a **Copy code** button. Open the Marathon app, go to **Settings → Strava → "Connected in Safari but the app didn't pick it up?"**, paste the code, and tap **Use code** within a few minutes.

## Fundraising tracker (GivenGain)

In **Settings → Fundraising**, paste your GivenGain page link. The Today screen then shows:
- your total raised vs target, with the $20,000 minimum marked
- the latest donor, plus a **Share** button

Tap the card for the **Fundraising** screen: a raised-over-time chart, days left, and every donor and message, each with a thank-you checkbox.

GivenGain doesn't let other websites read its data directly, so the Google Apps Script link fetches the public totals and donor list for the app (cached for 10 minutes). Data refreshes when you open the app (at most every 30 minutes) and when you tap *refresh* on the Fundraising screen.

## Strava API app (already created)

"Marathon Trainer" at **strava.com/settings/api**: Client ID `300161`, Website `https://dschiemer313.github.io/marathon-app/`, Authorization Callback Domain `dschiemer313.github.io`. Since June 2026, Strava's API requires an active Strava subscription.

## The Google Sheet link (used for importing)

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

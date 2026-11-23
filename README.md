# Marathon Trainer: setup guide

An iPhone home-screen app for Boston 2027 training. It reads your **Marathon 2027.xlsx** plan, pulls runs from **Strava** (your Apple Watch runs already sync there), and shows plan-vs-actual charts plus coaching tips.

Total setup time is about 15 minutes, done once.

---

## 1. Put the app online (GitHub Pages, free)

The app is a few static files. It needs an `https://` address so your iPhone can install it and Strava can send you back to it.

1. Sign in or sign up at **github.com**.
2. Click **+ → New repository**. Name it `marathon-app`, set it to **Public**, and click **Create**.
3. On the new repo page, click **uploading an existing file**. Drag in everything in this folder (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `README.md`, and the three `icon-*.png` files), then click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch*, pick `main` and `/ (root)`, then click **Save**.
5. After about a minute your app is live at:
   `https://YOUR-GITHUB-USERNAME.github.io/marathon-app/`

> No personal data is in these files. Your spreadsheet, Strava keys, and runs are stored only on your phone.

## 2. Create a Strava API app (free)

1. Go to **strava.com/settings/api** (signed in to Strava).
2. Fill in the form:
   - **Application Name:** Marathon Trainer
   - **Category:** Training
   - **Website:** your GitHub Pages URL from step 1
   - **Authorization Callback Domain:** `YOUR-GITHUB-USERNAME.github.io` (the domain only, with no `https://` and no path)
3. Save. Keep this page open. You'll need the **Client ID** and **Client Secret** in step 4.

## 3. Install on your iPhone

1. Open your GitHub Pages URL in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open **Marathon** from your home screen. It runs full-screen like a normal app.

## 4. First-time setup inside the app

1. **Settings → Import spreadsheet.** Pick `Marathon 2027.xlsx` from Files or OneDrive.
2. **Settings → Strava.** Paste your Client ID and Client Secret, then tap **Connect with Strava**. Tap **Authorize**, and leave "View data about your activities" checked.
3. You'll land back in the app and it syncs your runs.

**If Strava sends you back to Safari instead of the app** (iOS sometimes does this): the page shows a code with a **Copy code** button. Copy it, open the Marathon app from the home screen, go to **Settings → Strava → "Connected in Safari but the app didn't pick it up?"**, paste the code, and tap **Use code**. Do it within a few minutes, because codes expire.

## Day to day

- The app syncs Strava automatically when you open it (at most every 30 minutes). Tap ⟳ to sync now.
- Changed the plan in Excel? Use **Settings → Re-import spreadsheet**.
- **Your spreadsheet is the history; Strava fills in from there.** Runs come from the spreadsheet log up to its last date. Strava only adds runs dated after that. Settings shows the handoff date.
- From Strava the app takes **runs** (Run, Trail Run, Virtual Run) and **cross-training**: F45 and functional strength (Strava calls these *Workout*), traditional strength (*Weight Training*), HIIT, and CrossFit. Walks, hikes, rides, and everything else are ignored.
- Cross-training counts toward each week's **Cross-Train Target** from your spreadsheet. F45 sessions marked in the spreadsheet log count too.
- If you log more runs in the spreadsheet and re-import, the handoff date moves forward with it.

## What's in it

| Tab | What you get |
|---|---|
| **Today** | Days to Boston, this week's mileage ring, planned runs checked off automatically, goal vs predicted finish, coaching tips |
| **Plan** | All 31 weeks by phase, with planned vs actual miles. Tap a week for its runs and notes. |
| **Charts** | Weekly mileage, cumulative miles, pace per run (with goal and easy pace lines), long-run progression, cross-training sessions vs target, predicted marathon time, and Apple Watch heart rate |
| **Runs** | Every run and cross-training session, filterable by type |

**How the coaching tips work.** They're rule-based and built on your spreadsheet's paces (goal 8:01, easy 9:16, quicker 7:36):

- The next workout to do, with the pace to run it at
- Warnings when you have more runs left than days left in the week
- Injury-risk warnings when the last 7 days are well above your 4-week average
- A flag when your "easy" runs are too fast, or a long run was run near race pace
- A caution when the long run jumps a lot past your recent longest run
- How far you are ahead of or behind the plan's mileage
- A finish-time prediction from your best recent effort (Riegel formula), and how much faster you need to get
- Cross-training: sessions left this week, when to fit them in (not heavy legs or HIIT the day before the long run), and a flag if you keep missing the target
- Heart-rate efficiency: are you getting faster at the same heart rate?
- Tips for each phase: Base, Build, Peak, Taper, Injury, Return, Race

## Updating the app

Edit the files, then upload them to the GitHub repo again. The phone picks up the new version the next time you open the app with a connection.

## Run it on your PC (optional)

```powershell
python -m http.server 8765 --directory marathon-app
```

Then open http://localhost:8765. Strava allows `localhost` as a callback domain, so connecting works locally too.

# Daily Tracker — simple follow-up tracker

Note a task, its current status and who you're waiting on. When that person gets back to you, write the new status and pass the task to whoever gives the next update. Finish with **Completed** or **Failed**.

- **Automatic dates:** a new task gets today's date. Every open task moves to the next day automatically until it's completed or failed.
- **Weekends are holidays:** Saturday and Sunday show a holiday banner and don't count towards "days open".
- **On hold until a date:** if someone says "I'll reply in 10 days", enter that date in **Update**. Quick buttons cover 3 days, 1 week, 10 days, 2 weeks and 1 month. The task is hidden from the daily list until then, and on that day it pops back up with a blue **Follow-up due** badge. A date on Saturday or Sunday moves to Monday. **⋯ → Bring back now** ends a hold early.
- **Every day tasks:** tick **Every day** when adding a task (for example "Check mail"), or use **⋯ → Make it an everyday task**. These show as a tick list at the top of Today on every working day and come back unticked the next day. **⋯ → Stop repeating** turns one back into a normal task.
- **Critical:** a task waiting for **more than 5 working days** gets a red CRITICAL badge, is sorted to the top and appears on the dashboard. Days on hold don't count, and everyday tasks are never critical.
- **Closed tasks:** Completed and Failed tasks are struck through and stop moving to the next day. Undo or **⋯ → Reopen** fixes mistakes.
- **Departments and people:** the app starts with 8 departments that you can rename or delete. Add your own departments and people, set a phone number for one-tap calling, and change a person's department at any time; their open tasks move with them.
- **History:** every update is kept. Tap a task title to see its timeline.
- **Dashboard:** open, critical, **on hold**, everyday (done today), updated today, added today, completed and failed counts; critical tasks; an **On hold** column with each task's return date; who you're waiting on; open tasks by department; outcome; recent activity.
- **Phones:** works on any phone and installs to the home screen. Changes made offline sync when you reconnect.
- **Safety:** sign-in required; only your authorised account can read or write your data (Firebase security rules); everything you type is shown as plain text; **⋯ → Download backup** saves a JSON copy.

## Updating from the previous Daily Tracker (adds On hold + Every day)
1. Publish the new `database.rules.json` (Firebase → Realtime Database → Rules → paste → **Publish**). Without this, saving a follow-up date or ticking an everyday task fails.
2. Upload these changed files to GitHub: `css/app.css`, `sw.js`, `README.md`, `database.rules.json`, `js/app.js`, `js/components.js`, `js/data.js`, `js/icons.js`, `js/workdays.js`, `js/views/all.js`, `js/views/dashboard.js`, `js/views/today.js`. Don't touch `js/firebase-config.js`.
3. Open the site. A "new version" message may appear; tap **Reload**. Your existing tasks stay as they are.

## Switching from the old app (one time, about 10 minutes)

> This replaces the old Flightdeck app. If you want to keep anything from it, open the **old** app first, go to **Settings → Data → Download JSON**, and keep that file.

### 1. Publish the new database rules
Firebase Console → **Realtime Database** → **Rules** → delete everything → paste the full contents of `database.rules.json` → **Publish**.

The new rules allow only `/tracker/<your UID>` and lock the old `/users` data completely.

### 2. Delete the old data
Realtime Database → **Data** → hover over the **`users`** row → click the **trash/delete** icon (or **⋮ → Delete**) → confirm.

⚠️ **Do not delete `roles`.** It holds your access (`roles → <your UID>: "owner"`). Without it you'll see "Account not authorised".

### 3. Upload the new app to GitHub
1. Open your repository on GitHub → **Add file → Upload files**.
2. Drag in **everything** from the unzipped `daily-tracker` folder, **except** `js/firebase-config.js`. Your existing copy holds your Firebase keys, so keep it.
3. **Commit changes**, wait 1–2 minutes, and open your site.

Same-named files are replaced. Old Flightdeck files left in the repository (for example `css/style.css` or `js/views/kanban.js`) are no longer used and do no harm.

**Optional cleanup:** on your repository page, press the **.** (full stop) key to open the web editor, right-click and delete the old files and folders, then commit.

### 4. Open the site
Sign in as before. On first sign-in, the app creates the starter departments. Phones that installed the old app update automatically. If an old screen sticks, reload once (Ctrl+Shift+R on a PC).

## Daily use

1. Tap **Add task** (or **+** on a phone). Write the task, the current status, and pick the department and the person to contact. New departments and people can be added right from the drop-downs.
2. When someone replies, tap **Update** → write what they said → change **Next update from** if someone else now owes you the update → if they gave you a date, pick it under **Follow up again on** → **Save update**.
3. When it's finished, tap **Completed** or **Failed** and add an optional final note. The task is struck through and stops moving forward.
4. Tick your **Every day** tasks at the top of Today as you do them.
5. Check the **Dashboard** for critical tasks and who you're waiting on. Use **All tasks** to search everything, including finished tasks.

## Files

```
index.html, login.html       pages
css/app.css                  all styles (dark default, light from the ⋯ menu)
js/firebase-config.js        your Firebase web config (keep your existing copy)
js/firebase.js, auth.js      Firebase start-up and sign-in
js/data.js                   database reads/writes, offline queue, departments/people/tasks
js/workdays.js               dates, weekends, carry-over, on hold, everyday tasks, 5-day critical rule
js/components.js             task card, add/update/complete/fail forms, history
js/views/                    today, dashboard, all (tasks), people
js/app.js                    navigation and menu
database.rules.json          security rules (publish in Firebase)
sw.js, manifest.json         install + offline support
```

## Database layout
```
/roles/{uid}: "owner"                      (set by you in the console; users can't change it)
/tracker/{uid}/meta                        { seeded }
/tracker/{uid}/departments/{id}            { name, createdAt }
/tracker/{uid}/people/{id}                 { name, departmentId, phone?, createdAt, updatedAt }
/tracker/{uid}/tasks/{id}                  { title, status: open|completed|failed, currentStatus, personId, personName,
                                             departmentId, departmentName, createdDate, createdAt, updatedAt,
                                             lastUpdateAt, closedAt?, closedDate?, holdUntil?, daily?, dailySince?,
                                             doneDates/{YYYY-MM-DD}: time ticked (everyday tasks),
                                             updates/{id}: { at, date, type, note?, holdUntil?, personName?, departmentName? } }
```

## Testing done
- 33 tests of the date rules (weekends, carry-over, more than 5 working days = critical, on-hold dates, everyday tasks), run in two time zones.
- 31 security-rule tests: no access without sign-in or role, no access to other accounts, old data locked, invalid fields rejected.
- 34 browser tests on desktop, iPhone and Android sizes: add, update, hand over, complete, fail, undo; next-day carry-over; Saturday holiday; on hold until a date and pop-up on that day; everyday tick list; critical on list and dashboard; department changes; delete protection; search; offline then reconnect; sign-out/sign-in; script injection.
- A check that the installed app opens with no network.

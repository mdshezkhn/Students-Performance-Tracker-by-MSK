# MONDAY TESTING GUIDE — SPR demo classes

**Where:** https://spr-school-demo.pages.dev
**What:** the real SPR app with two demo classes full of **dummy students** (no real data anywhere). Works on laptop, phone or tablet. Nothing is sent anywhere: everything stays in the browser you test on.

---

## 1. Get the demo (once, about 1 minute)

1. Open **https://spr-school-demo.pages.dev** (first load can take a few seconds).
2. Read the privacy note, tick the box, press **I understand**.
3. On the sign-in card press **Just looking? Try the demo classes (dummy students)**.
4. Type a password you will remember (8+ characters) and press **Add demo classes**.
   Setup takes several seconds (it is creating real encrypted classes).
5. You land signed in as **fet-demo** — the foreign teacher.

A small **"Demo classes: dummy students only"** banner stays on screen. **Remove demo data** (on the banner) wipes it all.

## 2. The two demo sign-ins

| Sign-in | Who they are | What they can do |
|---|---|---|
| `fet-demo` | Foreign English teacher (class owner) | Observations, scores, approve changes, reports |
| `cet-demo` | Chinese English teacher assistant | Spelling / tests / daily scores; proposes observation changes for the FET to approve |

Both use the **same password you chose** in step 1.

## 3. FET walkthrough (10 minutes)

1. You are on **Choose your class**: open **P4-A Demo** (22 students, full September + October data).
2. Look around: **Dashboard** (class overview), **Students** (the roster), **Enter scores**, **Report Cards**.
3. Change something real: **Enter scores** → any student → change an observation number → **Save**. The save is local and instant (look for the save confirmation).
4. Open **Report Cards** and open one student's report: real grades calculated by the school's formula (Written 20%, everything else 10% each).
5. There is **one waiting approval** in P4-A Demo (the demo CET proposed an observation change for Demo Student 08, October, Speaking). Find the review queue and **approve or reject** it.
6. Press **Sign out** (bottom of the class list).

## 4. CET walkthrough (10 minutes)

1. Sign in as `cet-demo` (same password).
2. Open **P4-A Demo** → you see the same students.
3. **Enter scores**: enter a spelling score, a test score, a daily assignment score. Save.
4. Try to change an **observation** — as the assistant you get "propose a change" instead: the FET must approve it. Send one proposal.
5. Open a report card: your new scores are already in the averages.

## 5. The strong demo story: offline (try this!)

1. Sign in as either teacher, open a class, enter a score.
2. Turn Wi-Fi off (or phone airplane mode). Refresh the page — **the app still opens** (it is installed as an offline app after the first visit).
3. Enter another score while offline.
4. Wi-Fi back on, refresh — your data is still there (everything in this demo is local, so "sync" here means: your data survives, nothing is lost).

## 6. Two-teacher sharing (at HOME, not at school)

School Wi-Fi blocks the SPR cloud (measured 11 Nov). At home, on a second device/browser you can join the same class via **Key & link** on the class list — but for Monday, the honest story is: "the two roles and their permissions are shown on one device; live two-device sync is a home demo."

## 7. Excel round trip (optional, 5 minutes)

1. In a class: **Export** → SPR Excel file → opens/downloads.
2. Then **Import SPR Excel file** on the class list → choose the file you just exported → the audit runs **locally in the browser** (your file is never uploaded) and reports what it finds before anything is imported.

## 8. If something goes wrong

| You see | Do this |
|---|---|
| Page will not load | Refresh once; try the Cloudflare mirror https://spr-with-mo.pages.dev (older build, no demo button) or your phone's hotspot |
| Demo install seems stuck | Wait — it does several seconds of encryption work. If still stuck after 30 s, refresh and retry |
| Forgot the demo password | Press **Remove demo data** and add the demo again with a new password |
| Anything else | **Remove demo data** and re-add it — the demo is disposable by design |

**No real student names, ever.** The demo students are literally called "Demo Student 01…24".

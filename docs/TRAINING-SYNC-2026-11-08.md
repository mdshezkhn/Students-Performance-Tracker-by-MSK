# Training materials vs. the app — sync review (2026-11-08)

Reviewed against: **live build `915dcf6c77`** (round10 + demo fixes). Materials:
- `media/manual/SPR-with-Mo_Teachers-Operation-Manual.docx` v1.2 (Oct 2026)
- `media/manual/SPR-Video-Voiceover-Script.docx` + `SPR-with-Mo_Teacher-Video-Guide.mp4` (4:23, recorded ~Oct 21)

Method: full text extraction of both docs; 17 frames extracted from the video and inspected; every
claim checked against the current build. Frames saved in `docs/qa/demo/training-frames/`.

---

## Verdict

**The app tour is still accurate. The sign-in story is dead wrong. The manual needs a v1.3.**

| Material | Status |
|---|---|
| Video — app tour (Dashboard, Students, Scores, Grading, Analysis, Report Cards, Manage) | ✅ still matches the current UI (verified frame-by-frame) |
| Video — sign-in segment (0:25–1:27) | ❌ **WRONG**: teaches the removed shared accounts |
| Manual — §4 first-run | ⚠️ says "three things"; round10 made it **five** |
| Manual — §17 privacy / §19 FAQ | ⚠️ missing the owner disclosure (same honesty point as notice v2) |
| Manual — §14/§15 | ⚠️ Users sheet + roster import not documented (admin-only, but the pilot shows it) |

---

## 1. VIDEO — what must change

### TAKE 02 (0:06–0:43, The website) — small fix
Current: "…you'll see a short privacy notice. It explains that your data stays inside your own browser."
**Problem:** the notice (v2) now also says the school owner account can open every class and can switch
the app to read-only/locked. One sentence to add, keeping the calm tone:

> "It also says that the school's owner account — that's me — can open every class, and can pause or
> lock the app if it's ever needed. It never deletes anything."

The on-screen subtitles must be updated to match (the notice card itself is shown at 0:30 in the video;
the burned-in text shows the OLD notice).

### TAKE 03 (0:43–1:27, Signing in with your shared account) — DEAD, rewrite
Current script teaches: "Two accounts are ready on this computer — ZFYBLS, and XFLS. Type your username…
and the password shared with you."
**This is the removed public-password flow (round 9 removed it).** The video frames at 0:25 and 1:15
show the old sign-in card advertising "ZFYBLS or XFLS" — that card no longer exists.

**Replacement (same time slot, first-run instead):**
> "The first time, you create your own sign-in. Click 'First time using SPR? Set up this browser'.
> Pick a username — I'll use my name — and a password of eight characters or more. Then SPR asks for a
> master password: a second key that can rescue your account if the password is ever forgotten. Set it,
> and download the recovery file it offers — keep that file safe, with the school records. Then choose
> how to start: a new class, an Excel import, or the sample class. Let's load the sample."

(On-screen: the flow to record is now Open the App → notice v2 → "First time using SPR?" → setup card →
master password → **owner kit download** → "Set up your first class". The old clips must be re-recorded
or cut; the current ones show screens that no longer exist.)

### TAKE 04 (1:27–1:45, Signing in) — keep, one word
"Every time you come back, just sign in with your username and password" — still true. The old frames
show the ZFYBLS card; re-record the screen capture, the words are fine.

### TAKE 11 (3:52–4:12, Manage, backup & sharing) — still true
Backup + Share & Sync wording still matches (verified in the build). Optional add: one clause —
"Admins will also find the Users sheet here: one row per person and class."

### The QR share dialog (4:05 in the video)
The frame shows the old "Share this class" QR dialog. The current flow is Share & sync → **Save & Share**
with the token link. Re-capture this screen; the narration line "A window opens with a link and a QR
code… Copy link" is still close enough if the new dialog keeps a link — verify when re-recording.

---

## 2. MANUAL v1.2 — exact edits for v1.3

1. **Cover/version line** → `Manual version 1.3 · November 2026`.

2. **§4 heading + intro** — "it asks you to do three things" → **five things**:
   > "…it asks you to do five things: read the privacy notice, create your sign-in (username +
   > password), set a master password, download your recovery kit file, and then choose how to start
   > your first class."

   Insert two new steps after "Step 3 — Create your sign-in":
   > **Step 4 — Set a master password.** "This is a second password. If you ever forget your sign-in
   > password, the master password can restore your account. Choose it carefully and keep it on paper."
   > **Step 5 — Download your recovery kit.** "The app offers a small file. Download it and keep it
   > somewhere safe (school drive or USB). It can restore your account on a new computer, and it lets
   > the school owner control the app in an emergency. You must download it before you can continue."

   (Old Step 4 "Choose how to start" becomes Step 6.)

3. **§17 Privacy and safety** — add after the first bullet:
   > "The school's owner account (Teacher Mo) can open every class and can switch the app to read-only
   > or locked for everyone. It never deletes data, and it never sends your marks anywhere."

4. **§19 FAQ "I forgot my password"** — after "…the data is locked forever." add:
   > "(The school owner can restore access with the recovery kit and master password — that is why the
   > kit file matters.)"

5. **§14 (new short section) — "Users (admin only)"**:
   > "Admins see a Users tab: one row per person and class, with roles and paired partners. You can
   > add accounts, disable/enable them, reset a teacher's password, and import a roster CSV — SPR asks
   > one question per teaching pair (who is the EAL teacher) and never guesses."

6. **§14.4 Settings and sign-ins** — add: "The owner also sees **Owner controls** here: the school-wide
   read-only / lock switch (signed, published as a small file), and the **owner recovery kit**
   re-download."

7. **§16 Share & sync** — confirm the current dialog wording when re-capturing screenshots (round 7
   changed the flow to Save & Share with a share token; update Figure 12 if it shows the old QR card).

8. **Screenshots**: §4 figures show the old first-run (3 steps). Re-shoot Figures 2–4 with the v2
   notice + setup card + master-password/kit step. All other screenshots (Dashboard, Students, Scores,
   Grading, Analysis, Report Cards) still match — verified against the current build.

---

## 3. Demo-day wording (Thursday)

- Say the notice out loud: *"Your data stays in your browser. I, as the school owner, can open any
  class and can pause the app if ever needed — but nothing is ever deleted or sent anywhere."*
- The first-run demo now includes the kit download: **do it for real on stage** (it's a required click)
  and say "this file is the school's master key — it goes in the school safe."
- If someone asks "can two accounts share one computer?" — yes: Manage → Advanced → sign-ins; each
  person has their own username and password.

---

## 4. What was verified so you don't have to

Full end-to-end rehearsal against the live site (34 checks, 0 page errors): landing → notice v2 →
first-run (sign-in + master password + kit download) → sample class → all six pages → Users sheet with
per-pair roster import → Owner controls → backup download → sign-out/in → 390 px phone. Two real bugs
were found by this rehearsal and are fixed and deployed in `915dcf6c77`:
1. **Load-sample downgraded the session** (silent reload → no password in memory) → roster import said
   "Sign in again". First-run journey now works end to end.
2. **Owner controls were unreachable in class mode** (cards only on the legacy Manage panel) → now
   rendered on the class-mode Manage too.

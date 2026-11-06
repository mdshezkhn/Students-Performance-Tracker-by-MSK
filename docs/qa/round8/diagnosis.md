# round8 diagnosis — why the S8 reset push never reached the data row

Trace: `SPR_DS_TRACE=1` (off by default; set only by the test harness into
`window.__SPR_DS_TRACE`). Every push decision logs time, reason (`why=`),
outcome (sent / skipped: already-current, held-by-pull-check, signed-out /
failed: status) and the `sum`/`asum`/`wsig` compared. Full logs:
`/tmp/r8-diag-run5.log` (excerpt below).

## The mechanism (answers to a / b / c)

**(a) Was a push for the reset ever requested? YES.**
`acct-reset` ends with `if (dsCanPush()) scheduleSyncPush(0, 'account event:
password reset')` — the prompt timer fires within milliseconds and the trace
shows the want armed (`push done: pending cleared | why=account event:
password reset` in healthy runs).

**(b) Requested but never sent: it was HELD, not skipped, not dropped.**
The hold is `dsHoldPush`, set for the whole duration of `dsPullCheck` —
INCLUDING its decision dialog. The background (non-interactive) sign-in check
can open that dialog because the "A newer copy is in the cloud"
`confirmDlg` (source/app.js, dsPullCheckInner) had **no `interactive` guard**:
when the row's seal ts is newer than the device's boot floor (it always is by
the push-debounce delta: the floor is the last LOCAL save, the seal happens
seconds later) and the sums differ *at compare time*, a modal opens. The sums
differ exactly when the reset's `saveAuth()` lands while the check is still
reading/digesting — on a slow machine the check's `sbGet`+HMAC+AES queue
behind the reset's own PBKDF2-310k chain, so the compare happens AFTER the
local users array changed. Nobody answers that dialog (in the suite the drain
loop ran before it appeared; in a school, the teacher is mid-task), so:

- every retry logs `skip: a pull-check is deciding local-vs-cloud … → retry 4s`
  forever — the pointer re-seal (`dsWritePointer`) does not need the push
  path, which is why "password reset re-sealed the pointer row" still PASSES
  while "reset also pushed the re-keyed account … to the data row" fails;
- the deletion's tombstone push and every later union push are held the same
  way, which is the remaining 7 failures (S8 bootstrap, S8/S10 tombstone,
  S11 no-resurrection, self-correction) — one event, seven consequences.

**(c) Can the guard hold a push forever? YES — that is the bug.**
Two unguarded paths (`newer copy` and the integrity-fail adopt dialog) park
`dsHoldPush` on an unanswered modal from a *background* check; the 4 s retry
chain keeps retrying but can never win. The lost-update guard
(`dsWantedSeq`) and dialog sequencing from b3577df correctly prevent DROPS
(the want survives in cfg and would eventually push once the dialog is
answered) — "eventually" is never, when nobody answers.

## Deterministic reproduction (S12 R1a, this build, unfixed)

The suite now replays it on demand: stretch the background check's row read
(mock `__SB_SLOW_GET = 6000`), start the admin's password reset *while the
check is mid-flight*, and the sums-differ + cloud-newer condition is met
deterministically instead of by machine-speed luck.

## Excerpt (one failing run, unfixed build — `/tmp/r8-diag-run5.log`, trace on)

Natural occurrence inside S8 itself (window w14 = Bt, admin sign-in; the
drain loop barely caught the modal 2 s later, so THIS run survived — on the
reviewer's slow box the modal appears after the drain and the run fails):

```
15:31:17.906 pull-check: start (interactive=0) | pushes held
15:31:17.916 pull-check: opening NEWER-COPY dialog (interactive=0, modal, pushes stay held) | cloudTs=15:30:59 boot=15:30:47
15:31:19.502 pull-check: done | pushes released
15:31:20.991 send: state differs ... | env(asum=sDMCCCcDBizRz1yXj8P1vI) row(asum=fvzWlaSH_Moj49qf0DUEWG) | why=pull-check resume
15:31:20.991 sent ok: row accepted the new copy | asum=sDMCCCcDBizRz1yXj8P1vI | why=pull-check resume
```

Deterministic replay (S12 R1a, window w23; the reset's push is requested,
then held forever — nobody answers the background modal):

```
15:34:16.293 pull-check: start (interactive=0) | pushes held
15:34:18.789 skip: held by pull-check | why=sign-in repair → retry 4s
15:34:22.302 pull-check: opening NEWER-COPY dialog (interactive=0, modal, pushes stay held) | cloudTs=15:34:11 boot=15:31:16
  FAIL: R1: background pull-check opened NO decision dialog (passive notice instead)
15:34:22.795 skip: held by pull-check | why=account event: password reset → retry 4s
15:34:26.799 skip: held by pull-check | why=retry → retry 4s
15:34:30.813 skip: held by pull-check | why=retry → retry 4s
15:34:34.827 skip: held by pull-check | why=retry → retry 4s
15:34:38.834 skip: held by pull-check | why=retry → retry 4s
  ... every 4 s for the full 60 s window; the row's asum never changes ...
  FAIL: R1(reset): re-keyed account reached the data row (not dropped by any hold)
  FAIL: R5: reset landed in 66463 ms
```

Same shape as the reviewer's 8 S8 failures: the pointer re-seal needs no push
path (passes), the data-row push is held forever (fails), and the tombstone /
union / no-resurrection chain behind it fails with it.

## Fix

`docs/qa/round8/apply-fix.py`: a non-interactive pull-check NEVER opens a
modal — it records `cfg.cloudAhead`, shows a passive toast, and returns, so
the hold always releases (interactive "Check for newer copy" keeps its
dialog). Plus in-flight coalescing (R1/R2) and the 4/8/16/30 s retry ladder
with the 2-minute quiet period (R4).

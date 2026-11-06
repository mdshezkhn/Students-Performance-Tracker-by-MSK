#!/usr/bin/env python3
"""round8 FIX (R1-R5). Apply to source/app.js after the diagnosis build.
A: background (non-interactive) pull-checks never open a modal -> passive
   cfg.cloudAhead notice; hold always releases. Interactive checks unchanged.
B: in-flight push coalescing (direct calls mark a re-run; timer uses it too).
C: (already present: read-merge-then-put + tombstones-win; proven by S12)
D: retry ladder 4/8/16/30 s + failSince/failCount + 2-minute silence, then
   the honest sentence in the sync card.
E: prompt account pushes stay at 0 ms (R5 number = one 4 s retry ceiling)."""
import io, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
P = ROOT / 'source' / 'app.js'
s = io.open(P, encoding='utf-8').read()
n = 0

def sub(old, new, tag):
    global s, n
    assert s.count(old) == 1, 'anchor not unique (%d): %s' % (s.count(old), tag)
    s = s.replace(old, new); n += 1

# ---------- B: coalescing state + wrapper guard + re-run after flight -------
sub("""  let dsTimerAt = 0;                           /* when the armed timer will fire */
  let dsPushBusy = false;                      /* a push is in flight (diagnostics; R2 coalescing) */
""",
    """  let dsTimerAt = 0;                           /* when the armed timer will fire */
  let dsPushBusy = false, dsRerunAfterFlight = false;   /* in-flight coalescing (R1/R2) */
""", 'B1 state')

sub("""    if (!dsCanPush()) { dsLog('skip: cannot push (signed out / sync off) | why=' + dsWhy); return 'held'; }
    if (dsHoldPush) { dsLog('skip: a pull-check is deciding local-vs-cloud (dialog open) | why=' + dsWhy); return 'held'; }   /* never overwrite mid-decision */
    dsPushBusy = true;
    try {
      return await dsPushNowInner(interactive);
    } finally { dsPushBusy = false; }
  }""",
    """    if (!dsCanPush()) { dsLog('skip: cannot push (signed out / sync off) | why=' + dsWhy); return 'held'; }
    if (dsHoldPush) { dsLog('skip: a pull-check is deciding local-vs-cloud (dialog open) | why=' + dsWhy); return 'held'; }   /* never overwrite mid-decision */
    if (dsPushBusy) { dsRerunAfterFlight = true; dsLog('skip: a push is already in flight — coalesced, re-runs after it finishes | why=' + dsWhy); return 'held'; }
    dsPushBusy = true;
    try {
      return await dsPushNowInner(interactive);
    } finally {
      dsPushBusy = false;
      if (dsRerunAfterFlight) { dsRerunAfterFlight = false; scheduleSyncPush(0, 'coalesced after in-flight'); }
    }
  }""", 'B2 wrapper')

# timer: drop the separate busy check (the wrapper coalesces now)
sub("""      if (dsHoldPush) { dsLog('skip: held by pull-check | why=' + dsWhy + ' → retry 4s'); scheduleSyncPush(4000, 'retry'); return; }
      if (dsPushBusy) { dsLog('skip: a push is already in flight | why=' + dsWhy + ' → re-run after it finishes'); scheduleSyncPush(4000, 'in-flight'); return; }
""",
    """      if (dsHoldPush) { dsLog('skip: held by pull-check | why=' + dsWhy + ' → retry 4s'); scheduleSyncPush(4000, 'retry'); return; }
""", 'B3 timer lean')

# ---------- D: retry ladder --------------------------------------------------
sub("""  let dsWantedSeq = 0;   /* bumped on every request: lets the timer tell a stale completion from a fresh change */""",
    """  let dsWantedSeq = 0;   /* bumped on every request: lets the timer tell a stale completion from a fresh change */
  /* R4: failed-push retry ladder 4 s → 8 s → 16 s, capped at 30 s (the count
     lives in the cfg, so the ladder survives a reload too) */
  function dsBackoffDelay(failCount) { return failCount <= 1 ? 4000 : failCount === 2 ? 8000 : failCount === 3 ? 16000 : 30000; }""", 'D1 ladder')

# timer backoff uses the ladder
sub("""      else if (okPush === 'held') scheduleSyncPush(4000, 'retry');   /* transient: retry soon, not dropped */
      else scheduleSyncPush(30000, 'backoff');  /* read/save failed: back off, keep trying */""",
    """      else if (okPush === 'held') scheduleSyncPush(4000, 'retry');   /* transient: retry soon, not dropped */
      else scheduleSyncPush(dsBackoffDelay(((dsCfg() || {}).failCount) || 1), 'backoff');   /* failed: ladder backoff, keep trying */""", 'D2 timer ladder')

# success paths: reset the failure state, clear a stale cloud-ahead notice
sub("""        await dsAdoptChan(cfg, chan);
        cfg.lastPush = row.pushed_at || new Date().toISOString(); cfg.lastResult = 'ok'; dsSaveCfg(cfg);
        if (interactive) toast('Cloud copy already up to date');
        return true;""",
    """        await dsAdoptChan(cfg, chan);
        cfg.lastPush = row.pushed_at || new Date().toISOString(); cfg.lastResult = 'ok';
        cfg.failCount = 0; delete cfg.failSince; delete cfg.cloudAhead; dsSaveCfg(cfg);
        if (interactive) toast('Cloud copy already up to date');
        return true;""", 'D3 skip-success')

sub("""      dsLog('sent ok: row accepted the new copy | sum=' + env.sum + ' asum=' + env.asum + ' | why=' + dsWhy);
      await dsAdoptChan(cfg, chan);
      cfg = dsCfg() || cfg;
      cfg.lastPush = at; cfg.lastResult = 'ok'; dsSaveCfg(cfg);""",
    """      dsLog('sent ok: row accepted the new copy | sum=' + env.sum + ' asum=' + env.asum + ' | why=' + dsWhy);
      await dsAdoptChan(cfg, chan);
      cfg = dsCfg() || cfg;
      cfg.lastPush = at; cfg.lastResult = 'ok'; cfg.failCount = 0; delete cfg.failSince; delete cfg.cloudAhead; dsSaveCfg(cfg);""", 'D4 send-success')

# failure bookkeeping in the catch (retries are armed by the timer, ladder now)
sub("""      const reason = String((e && e.message) || e || 'unknown error').replace(/\\s+/g, ' ').slice(0, 160);
      const c2 = dsCfg();
      if (c2) { c2.lastResult = 'fail'; c2.lastError = 'Cloud copy not updated: ' + reason + '. Your data on this device is safe.'; dsSaveCfg(c2); }
      if (interactive) toast('Cloud copy not updated: ' + reason + '. Your data on this device is safe.', true);
      /* auto-retry a failed push after 30s — a flaky link shouldn't need a new
         edit to get the data out; scheduleSyncPush keeps retrying (30s backoff)
         until the row accepts it */
      scheduleSyncPush(30000, 'retry after failure');
      return false;""",
    """      const reason = String((e && e.message) || e || 'unknown error').replace(/\\s+/g, ' ').slice(0, 160);
      dsLog('fail: ' + reason + ' | why=' + dsWhy);
      const c2 = dsCfg();
      if (c2) {
        c2.lastResult = 'fail'; c2.lastError = 'Cloud copy not updated: ' + reason + '. Your data on this device is safe.';
        c2.failCount = (c2.failCount || 0) + 1;
        if (!c2.failSince) c2.failSince = new Date().toISOString();   /* R4: the 2-minute quiet clock starts here */
        dsSaveCfg(c2);
      }
      if (interactive) toast('Cloud copy not updated: ' + reason + '. Your data on this device is safe.', true);
      /* auto-retry via the ladder (4/8/16/30 s) — a flaky link shouldn't need
         a new edit to get the data out; the want stays armed until it lands */
      scheduleSyncPush(dsBackoffDelay((c2 && c2.failCount) || 1), 'retry after failure');
      if (location.hash === '#/manage') renderManage();
      return false;""", 'D5 catch')

# row-read failure path: same bookkeeping (it returns false; the timer retries)
sub("""      if (rowReadErr) {
        dsLog('fail: row read error ' + rowReadErr);
        cfg.lastResult = 'fail'; dsSaveCfg(cfg);""",
    """      if (rowReadErr) {
        dsLog('fail: row read error ' + rowReadErr + ' | why=' + dsWhy);
        cfg.lastResult = 'fail'; cfg.failCount = (cfg.failCount || 0) + 1; if (!cfg.failSince) cfg.failSince = new Date().toISOString(); dsSaveCfg(cfg);""", 'D6 read-fail')

# ---------- A: background pull-check never opens a modal --------------------
sub("""      if (/integrity check/.test(e.message || '') && SESSION.pw) {
        let hit = null;
        try { hit = await dsAccountLookup(SESSION.user, SESSION.pw); } catch (e2) { hit = null; }
        if (hit) {
          const okA = await confirmDlg('Cloud data found for ' + U.esc(SESSION.user),""",
    """      if (/integrity check/.test(e.message || '') && SESSION.pw) {
        let hit = null;
        try { hit = await dsAccountLookup(SESSION.user, SESSION.pw); } catch (e2) { hit = null; }
        if (hit) {
          if (!interactive) { cfg.cloudAhead = { at: new Date().toISOString(), by: 'another device' }; dsSaveCfg(cfg); toast('This device\\u2019s pairing is out of date: Manage \\u2192 Device sync \\u2192 Check for newer copy'); return; }
          const okA = await confirmDlg('Cloud data found for ' + U.esc(SESSION.user),""", 'A1 integrity')

sub("""      if (!interactive) return;
      dsLog('pull-check: opening DIFFERS dialog (modal, pushes stay held)');""",
    """      if (!interactive) { cfg.cloudAhead = { at: new Date().toISOString(), by: row.pushed_by || 'another device' }; dsSaveCfg(cfg); toast('The cloud copy differs from this device: Manage \\u2192 Device sync \\u2192 Check for newer copy'); return; }
      dsLog('pull-check: opening DIFFERS dialog (interactive only, pushes stay held)');""", 'A2 differs')

sub("""    dsLog('pull-check: opening NEWER-COPY dialog (interactive=' + (interactive ? 1 : 0) + ', modal, pushes stay held) | cloudTs=' + new Date(cloudTs).toISOString().slice(11, 19) + ' boot=' + new Date(DS_BOOT_TS).toISOString().slice(11, 19));
    const ok = await confirmDlg('A newer copy is in the cloud',""",
    """    /* R1 root cause: a BACKGROUND check must never park pushes on a modal
       that may never be answered. Interactive checks keep the dialog. */
    if (!interactive) {
      dsLog('pull-check: newer cloud copy found — passive notice, NO dialog (R1) | cloudTs=' + new Date(cloudTs).toISOString().slice(11, 19) + ' boot=' + new Date(DS_BOOT_TS).toISOString().slice(11, 19));
      cfg.cloudAhead = { at: new Date().toISOString(), by: row.pushed_by || 'another device' }; dsSaveCfg(cfg);
      toast('A newer cloud copy is waiting: Manage \\u2192 Device sync \\u2192 Check for newer copy');
      return;
    }
    dsLog('pull-check: opening NEWER-COPY dialog (interactive, modal, pushes stay held) | cloudTs=' + new Date(cloudTs).toISOString().slice(11, 19) + ' boot=' + new Date(DS_BOOT_TS).toISOString().slice(11, 19));
    const ok = await confirmDlg('A newer copy is in the cloud',""", 'A3 newer')

# ---------- D (UI): sync card status — silence, then the honest sentence ----
sub("""      (cfg.lastResult === 'fail' ? '<span style="color:#b45309">Last cloud save failed: it will retry automatically.</span>'
                                  : 'An encrypted copy of everything is updated after each change.') + '</p>' +""",
    """      status + '</p>' +""", 'D7 card status expr')

sub("""    return '<div class="panel" style="margin-top:10px"><p class="small" style="margin-bottom:8px"><b>Device sync is on.</b> ' +
      status + '</p>' +""",
    """    /* R4: retries are silent for the first 2 minutes; after that, one honest
       sentence. A waiting newer copy shows a passive notice (never a modal). */
    const failing = cfg.lastResult === 'fail' && cfg.failSince && (Date.now() - Date.parse(cfg.failSince)) >= 120000;
    const status = failing ? '<span style="color:#b45309">Cloud copy is behind. Your data on this device is safe.</span>'
      : cfg.cloudAhead ? '<span style="color:#b45309">A newer cloud copy is waiting: press Check for newer copy.</span>'
      : 'An encrypted copy of everything is updated after each change.';
    return '<div class="panel" style="margin-top:10px"><p class="small" style="margin-bottom:8px"><b>Device sync is on.</b> ' +
      status + '</p>' +""", 'D7 card')

io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('applied', n, 'fix edits')

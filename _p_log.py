import io
p = 'source/app.js'
s = io.open(p, encoding='utf-8', newline='').read().replace('\r\n', '\n')
def rep(old, new, n=1):
    global s
    assert old in s, 'MISSING: ' + old[:90]
    assert s.count(old) == n, 'AMBIG x%d: %s' % (s.count(old), old[:60])
    s = s.replace(old, new, n)

# ---- push-decision log: ring buffer + console.warn, so a stalled sync can be
# diagnosed from the console or from tests. Cheap: only strings.
rep("""  let DS_BOOT_TS = 0, dsTimer = null, dsHoldPush = false;""",
    """  let DS_BOOT_TS = 0, dsTimer = null, dsHoldPush = false;
  /* push-decision log: one line per attempt — held / retry / skip / sent /
     error — with the reason. Ring of 40. Read from tests via
     SPR_SYNC_TEST.pushLog(); humans see it in the console. */
  const DS_PUSH_LOG = [];
  function dsLog(reason) {
    const line = new Date().toISOString().slice(11, 19) + ' ' + reason;
    DS_PUSH_LOG.push(line); if (DS_PUSH_LOG.length > 40) DS_PUSH_LOG.shift();
    try { console.warn('[spr-sync] ' + line); } catch (e2) {}
  }""")

rep("""  function scheduleSyncPush(delay) {
    if (!dsOn()) return;
    dsSetPushWanted(true);                     /* remembered across reloads */
    const at = Date.now() + (delay || 4000);
    if (dsTimer && dsTimerAt <= at) return;    /* already armed sooner: keep it (a 30s backoff never delays a fresh edit) */
    clearTimeout(dsTimer);""",
    """  function scheduleSyncPush(delay) {
    if (!dsOn()) return;
    dsSetPushWanted(true);                     /* remembered across reloads */
    const at = Date.now() + (delay || 4000);
    if (dsTimer && dsTimerAt <= at) return;    /* already armed sooner: keep it (a 30s backoff never delays a fresh edit) */
    if (dsTimer) dsLog('reschedule: was ' + Math.max(0, dsTimerAt - Date.now()) + 'ms away, now ' + (delay || 4000) + 'ms');
    clearTimeout(dsTimer);""")

rep("""      dsTimer = null; dsTimerAt = 0;
      if (!dsPushWanted()) return;
      if (!dsCanPush() || dsHoldPush) { scheduleSyncPush(4000); return; }   /* not now: retried, not dropped */
      dsPushNow().then(function (res) {
        if (res === true) dsSetPushWanted(false);
        else scheduleSyncPush(30000);
      }).catch(function () { scheduleSyncPush(30000); });""",
    """      dsTimer = null; dsTimerAt = 0;
      if (!dsPushWanted()) { dsLog('timer: nothing pending'); return; }
      if (!dsCanPush()) { dsLog('retry 4s: cannot push now (signed out / sync off)'); scheduleSyncPush(4000); return; }
      if (dsHoldPush) { dsLog('retry 4s: held by a pull-check'); scheduleSyncPush(4000); return; }
      dsPushNow().then(function (res) {
        if (res === true) { dsLog('push done: pending cleared'); dsSetPushWanted(false); }
        else { dsLog('retry 30s: push failed'); scheduleSyncPush(30000); }
      }).catch(function (e) { dsLog('retry 30s: push error ' + ((e && e.message) || e)); scheduleSyncPush(30000); });""")

rep("""  async function dsPushNow(interactive) {
    if (!dsCanPush()) return false;
    if (dsHoldPush) return false;   /* a pull-check is deciding local-vs-cloud; never overwrite mid-decision */""",
    """  async function dsPushNow(interactive) {
    if (!dsCanPush()) { dsLog('abort: cannot push (signed out / sync off)'); return false; }
    if (dsHoldPush) { dsLog('abort: held by a pull-check'); return false; }   /* a pull-check is deciding local-vs-cloud; never overwrite mid-decision */""")

rep("""      if (rowReadErr) {
        cfg.lastResult = 'fail'; dsSaveCfg(cfg);""",
    """      if (rowReadErr) {
        dsLog('fail: row read error ' + rowReadErr);
        cfg.lastResult = 'fail'; dsSaveCfg(cfg);""")

rep("""        if (!rowOurs) {
          try { console.warn('row ownership check failed: adopting instead of overwriting (channel mismatch after adoption?)'); } catch (e5) {}""",
    """        if (!rowOurs) {
          dsLog('fail: row sealed under a different sync key (adopt first)');
          try { console.warn('row ownership check failed: adopting instead of overwriting (channel mismatch after adoption?)'); } catch (e5) {}""")

rep("""      if (row && row.payload && row.payload.sum === env.sum && row.payload.asum === env.asum && !wrapRepair) {
        await dsAdoptChan(cfg, chan);""",
    """      if (row && row.payload && row.payload.sum === env.sum && row.payload.asum === env.asum && !wrapRepair) {
        dsLog('skip: row already has this exact state (sum+asum match)' + (wrapRepair ? '' : ', no wrap repair needed'));
        await dsAdoptChan(cfg, chan);""")

rep("""      const at = new Date().toISOString();
      const who = (cfg && cfg.device ? cfg.device : 'device') + ': ' + SESSION.user;""",
    """      dsLog('send: state differs (content/accounts/wrap repair) or no row yet');
      const at = new Date().toISOString();
      const who = (cfg && cfg.device ? cfg.device : 'device') + ': ' + SESSION.user;""")

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('push-decision log wired')

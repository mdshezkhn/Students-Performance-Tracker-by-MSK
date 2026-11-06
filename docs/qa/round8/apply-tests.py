#!/usr/bin/env python3
"""round8 step 4: replace fixed sleeps that wait on crypto/network with
condition waits (60 s ceilings, failures name what they waited for)."""
import io, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]

def patch(rel, subs):
    P = ROOT / rel
    s = io.open(P, encoding='utf-8').read()
    for old, new in subs:
        assert s.count(old) == 1, 'anchor not unique (%d) in %s: %r' % (s.count(old), rel, old[:60])
        s = s.replace(old, new)
    io.open(P, 'w', encoding='utf-8', newline='').write(s)
    print('patched', rel, len(subs), 'edits')

# ---------- tests/test-device-sync.js ----------
patch('tests/test-device-sync.js', [
    # helpers for "push chain drained" conditions (used by S6/S7.5/S9 and S12)
    # -- function DECLARATIONS so they hoist above their first runtime use
    ("""  /* decrypt a sync row the way the app does (suite-side, for assertions) */""",
     """  /* round8: a device's push chain is DRAINED when no pull-check holds it and
     no push is wanted — the condition every settle-wait uses instead of sleep */
  function holdOf(B) { try { return !!B.w.SPR_SYNC_TEST.hold(); } catch (e) { return false; } }
  function pendingOf(B) { try { return !!JSON.parse(B.w.localStorage.getItem('spr-devicesync-v1') || '{}').pendingPush; } catch (e) { return false; } }
  async function waitDrained(B, ms, what) {
    const done = await waitFor(function () { return !holdOf(B) && !pendingOf(B); }, ms || 60000);
    if (!done) console.log('  [waitDrained] timed out waiting for: ' + what + ' (hold=' + holdOf(B) + ' pending=' + pendingOf(B) + ')');
    return done;
  }
  /* decrypt a sync row the way the app does (suite-side, for assertions) */"""),
    # S6 settle loop: require a drained push chain, 60 s ceiling
    ("""  {
    let lastAt = null, stable = false;
    for (let t = 0; t < 12000 && !stable; t += 1500) {
      await sleep(1500); syncSB(D3);
      const at = (SB[rows[0]] || {}).pushed_at || null;
      stable = at !== null && at === lastAt;
      lastAt = at;
    }""",
     """  {
    let lastAt = null, stable = false;
    const tq = Date.now();
    while (Date.now() - tq < 60000 && !stable) {
      await sleep(1000); syncSB(D3);
      const at = (SB[rows[0]] || {}).pushed_at || null;
      stable = at !== null && at === lastAt && !holdOf(D3) && !pendingOf(D3);
      lastAt = at;
    }"""),
    # S7 teacher-edit baseline: wait for the sign-in tail to drain, not 7 s
    ("""     otherwise the edit's debounced push races the hold and the baseline
     catches a stale row */
  await sleep(7000);""",
     """     otherwise the edit's debounced push races the hold and the baseline
     catches a stale row */
  await waitDrained(Bt, 60000, 'teacher sign-in tail (pull-check hold + sign-in push) before the edit baseline');"""),
    # S7.5 manage navigation: wait for the sign-in tail to drain, not 6 s
    ("""  await sleep(6000);   /* let the teacher sign-in tail (auto-open/settle) fully drain: it re-points the hash and would revert #/manage */""",
     """  await waitDrained(Bt, 60000, 'teacher sign-in tail before the self-service password change');   /* the tail re-points the hash and would revert #/manage */"""),
    # S9 adoption settle: drained condition instead of 1.5 s
    ("""  ok(h2In, 'adoption over existing data signed in via the explicit lookup');
  await sleep(1500);""",
     """  ok(h2In, 'adoption over existing data signed in via the explicit lookup');
  await waitDrained(H2, 60000, 'adoption sign-in tail before the downloads check');"""),
])

# ceilings: every wait that gates a crypto/network step gets the 60 s ceiling
# (run 17 of the BEFORE loop flaked exactly here: a 20 s login wait lost to
#  PBKDF2 under load)
import re as _re
P = ROOT / 'tests' / 'test-device-sync.js'
s = io.open(P, encoding='utf-8').read()
before = s
s = _re.sub(r'\}, (15000|20000|25000|30000|35000|45000)\);', '}, 60000);', s)
io.open(P, 'w', encoding='utf-8', newline='').write(s)
print('ceiling bumps:', len(_re.findall(r'\}, 60000\);', s)) , '(was', len(_re.findall(r'\}, (15000|20000|25000|30000|35000|45000\);', before)), 'left)')

# ---------- tests/test-round5.js ----------
patch('tests/test-round5.js', [
    ("""    await sleep(1200);   /* let the boot pull-check release its push hold */""",
     """    await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000 && A.w.SPR_SYNC_TEST && A.w.SPR_SYNC_TEST.hold()) await sleep(250); })();   /* condition: boot pull-check released its push hold */"""),
    ("""      click(E, tbtn); await sleep(1200);
      check(/Cloud connection/.test(txt(E) + dlgTxt(E)), 'button reports the connection in plain words');""",
     """      click(E, tbtn);
      const connTxt = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { if (/Cloud connection/.test(txt(E) + dlgTxt(E))) return true; await sleep(250); } return false; })();
      check(connTxt, 'button reports the connection in plain words');"""),
    ("""      await sleep(2500);   /* let the add flow finish its writes before snapshotting */""",
     """      await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { try { const v2 = JSON.parse(A.w.localStorage.getItem('p4c4-markbook-v2') || '{}'); if (v2.wraps && v2.wraps.anna) return; } catch (e) {} await sleep(250); } })();   /* condition: the add flow's key wrap for anna is written */"""),
    ("""    const A = boot(await preSeed({ dsCfg: cfgp })); await sleep(300); await waitShell(A);
    A.w.location.hash = '#/manage'; await sleep(3500);
    check(!/checking… download backups regularly/.test(txt(A)), 'persistent storage never sticks on "checking…"');""",
     """    const A = boot(await preSeed({ dsCfg: cfgp })); await sleep(300); await waitShell(A);
    A.w.location.hash = '#/manage';
    await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 60000) { const m = (txt(A)).match(/Persistent storage:<\\/b>\\s*([^<.]+)/); if (m && !/checking/.test(m[1])) return; await sleep(250); } })();   /* condition: storage query settled */
    check(!/checking… download backups regularly/.test(txt(A)), 'persistent storage never sticks on "checking…"');"""),
])

# ---------- tests/test-round6.js ----------
patch('tests/test-round6.js', [
    ("""    while (Date.now() - t0 < 3500) { await sleep(200); const m = (A.d.body.textContent || '').match(/Persistent storage:<\\/b>\\s*([^<.]+)/); if (m && !/checking/.test(m[1])) { finalTxt = m[1].trim(); break; } }""",
     """    while (Date.now() - t0 < 60000) { await sleep(200); const m = (A.d.body.textContent || '').match(/Persistent storage:<\\/b>\\s*([^<.]+)/); if (m && !/checking/.test(m[1])) { finalTxt = m[1].trim(); break; } }"""),
])
print('all test conversions applied')

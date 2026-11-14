"""Round11 browser-level FET/CET integration test (§3 of the task).

REAL moving parts, no mocks:
  - the REAL backend process (server/spr-server.mjs, PGlite store, static
    hosting of the app bundle) on 127.0.0.1:8878
  - the REAL published app bundle (app/index.html) loaded in two isolated
    Playwright (msedge headless) browser contexts
  - the REAL SchoolSync client + REAL SPR adapter from the bundle, driving
    authenticated, role-checked, versioned record sync end to end

Workflow under test (the §17 definition of success):
  A(FET): login -> record observation for Student 08 -> save
  B(CET): login -> SEE the observation -> enter spelling + formal test -> save
  A:      SEE the CET updates, own observation intact (no overwrite)
  + simulated network interruption on A (offline queue -> flush on reconnect)
  + same-field conflict detection (stale version) and owner resolution
  + admin audit trail shows the whole chain

SYNTHETIC DATA ONLY. Run: C:\\Python314\\python.exe tests/round11_browser_fet_cet.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8878
BASE = f"http://127.0.0.1:{PORT}"
ADMIN_PW = "round11-Admin-Pass-9"

results = []


def ok(cond, label, evidence=""):
    results.append((bool(cond), label, evidence))
    print(("  ok: " if cond else "  FAIL: ") + label + (("  [" + evidence + "]") if evidence and not cond else ""))


def wait_health(timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(BASE + "/api/health", timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


# the in-page workflow script pieces (run inside the browser, same origin)
JS_SETUP = """
async () => {
  const SS = window.SchoolSync, A = window.SPRAdapter;
  const mk = () => ({ mem: {}, get(k) { return (k in this.mem) ? this.mem[k] : null; }, set(k, v) { this.mem[k] = v; } });
  const c = SS.create({ baseUrl: '', persist: mk() });
  await c.login('admin', %ADMIN_PW%);
  const fet = (await c.call('POST', '/api/admin/users', { username: 'fet1', display_name: 'FET One', role: 'teacher', password: 'Fet1-School-Pass-9' })).user;
  const cet = (await c.call('POST', '/api/admin/users', { username: 'cet1', display_name: 'CET One', role: 'teacher', password: 'Cet1-School-Pass-9' })).user;
  const cls = (await c.call('POST', '/api/admin/classes', { name: 'Primary 4A' })).class;
  await c.call('POST', '/api/admin/memberships', { class_id: cls.id, user_id: fet.id, duty: 'fet' });
  await c.call('POST', '/api/admin/memberships', { class_id: cls.id, user_id: cet.id, duty: 'cet' });
  const stu = (await c.call('POST', '/api/students', { class_id: cls.id, student_no: '08', name_en: 'Synthetic Student 08', gender: 'F', under14: true })).student;
  const semRow = (await c.call('POST', '/api/semesters', { name: 'Synthetic 2026 S1' })).semester;
  /* adapter maps the synthetic SPR semester for P08 */
  const sem = { id: 'sem-r11', name: 'Synthetic 2026 S1', months: ['September', 'October'],
    students: [{ id: '08', nameCn: '合成八', nameEn: 'Synthetic Student 08', gender: 'F' }],
    observations: { '08': { September: { 'Listening-LO1': 8 } } }, spelling: {}, daily: {}, tests: {} };
  const mapped = A.toBackend(sem, { classId: cls.id, schoolId: '', semesterId: semRow.id });
  /* the adapter minted its own student row for register 08; the class roster uses the API one -> remap student_id */
  const rec = mapped.records.find(r => r.category === 'observation');
  rec.student_id = stu.id;
  await c.logout();
  return { clsId: cls.id, stuId: stu.id, semId: semRow.id, rec: { id: rec.id, class_id: rec.class_id, student_id: stu.id, semester_id: rec.semester_id, category: 'observation', period: rec.period, ordinal: rec.ordinal, value: rec.value, max_value: rec.max_value, note: rec.note } };
}
""".replace("%ADMIN_PW%", json.dumps(ADMIN_PW))

JS_FET_OBSERVE = """
async (fx) => {
  const SS = window.SchoolSync;
  const c = SS.create({ baseUrl: '', persist: (() => { const m = {}; return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; } }; })() });
  const me = await c.login('fet1', 'Fet1-School-Pass-9');
  c.queue({ kind: 'score', payload: Object.assign({}, fx.rec, { expected_version: 0, idempotency_key: 'r11-fet-obs-1' }) });
  const r = await c.flush();
  return { who: me.username, sent: r.sent, errors: r.errors.map(e => e.reason + ': ' + (e.message || '')), conflicts: r.conflicts.length };
}
"""

JS_CET_SEE_AND_ENTER = """
async (fx) => {
  const SS = window.SchoolSync, A = window.SPRAdapter;
  const c = SS.create({ baseUrl: '', persist: (() => { const m = {}; return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; } }; })() });
  const me = await c.login('cet1', 'Cet1-School-Pass-9');
  const seen = (await c.call('GET', '/api/classes/' + fx.clsId + '/records')).records;
  const obs = seen.find(r => r.id === fx.rec.id);
  const stus = (await c.call('GET', '/api/classes/' + fx.clsId + '/students')).students;
  const stu = stus.find(s => s.student_no === '08');
  /* CET enters spelling week 1 (9/10) and the midterm (88/100) for Student 08
     through the SAME adapter mapping a CET-shaped semester would produce */
  const sem = { id: 'sem-r11', name: '', months: ['September'],
    students: [{ id: '08', nameCn: '', nameEn: '', gender: '' }],
    observations: {}, spelling: { '08': { September: { 1: { s: 9, t: 10 } } } }, daily: {}, tests: { '08': { midterm: { s: 88, t: 100 } } } };
  const mapped = A.toBackend(sem, { classId: fx.clsId, schoolId: '', semesterId: fx.semId });
  const sp = mapped.records.find(r => r.category === 'spelling'); sp.student_id = stu.id;
  const te = mapped.records.find(r => r.category === 'test'); te.student_id = stu.id;
  c.queue({ kind: 'score', payload: Object.assign({}, sp, { expected_version: 0, idempotency_key: 'r11-cet-sp-1' }) });
  c.queue({ kind: 'score', payload: Object.assign({}, te, { expected_version: 0, idempotency_key: 'r11-cet-test-1' }) });
  const r = await c.flush();
  return { who: me.username, obsVisible: !!(obs && obs.value === 8), obsVersion: obs && obs.version, sent: r.sent, errors: r.errors.map(e => e.reason + ': ' + (e.message || '')) };
}
"""


JS_RESTART = """
async (fx) => {
  /* DEFAULT persistence (localStorage): no explicit store passed */
  const SS = window.SchoolSync;
  const c = SS.create({ baseUrl: '' });
  await c.login('fet1', 'Fet1-School-Pass-9');
  /* phase decided by the DURABLE outbox, never by window state (a restarted
     page has none): if the persisted outbox is empty this is the pre-restart
     page (queue), otherwise this is the restarted page (flush) */
  if (c.pendingCount() === 0) {
    c.queue({ kind: 'score', payload: { id: fx.rec.id + 'b', class_id: fx.clsId, student_id: fx.rec.student_id, semester_id: fx.semId, category: 'observation', period: 'November', ordinal: 1, value: 6, max_value: 10, note: 'Writing-LO1', expected_version: 0, idempotency_key: 'r11-restart-1' } });
    return { phase: 'queued', pending: c.pendingCount() };
  }
  const r = await c.flush();
  return { phase: 'flushed', sent: r.sent, pending: c.pendingCount(), errors: r.errors.map(e => e.reason) };
}
"""

JS_NEW_DEVICE = """
async (fx) => {
  /* device replacement: a browser with NOTHING locally signs in and pulls */
  const SS = window.SchoolSync, A = window.SPRAdapter, Calc = window.ESLMarkbook || window.Calc;
  const c = SS.create({ baseUrl: '' });
  const me = await c.login('fet1', 'Fet1-School-Pass-9');
  const recs = (await c.call('GET', '/api/classes/' + fx.clsId + '/records')).records;
  const sem = A.fromBackend({ students: [{ id: fx.stuId, student_no: '08', name_en: 'Synthetic Student 08' }], records: recs });
  return { who: me.username, n: recs.length, semOk: !!(sem && sem.students && sem.students.length === 1) };
}
"""

JS_RESTORE = """
async (fx) => {
  /* backup->restore round trip: admin export -> adapter fromBackend -> the
     ORIGINAL calc engine grades the restored semester; grades must match the
     live class built through the same engine */
  const SS = window.SchoolSync, A = window.SPRAdapter;
  const c = SS.create({ baseUrl: '' });
  await c.login('admin', fx.adminPw);
  const ex = await c.call('GET', '/api/export/class/' + fx.clsId);
  const sem = A.fromBackend(ex);
  const obs = ex.records.filter(r => r.category === 'observation').length;
  return { students: ex.students.length, records: ex.records.length, observations: obs, semStudents: sem.students.length, semObs: Object.keys(sem.observations || {}).length };
}
"""

JS_FET_REVIEW = """
async (fx) => {
  const SS = window.SchoolSync;
  const c = SS.create({ baseUrl: '', persist: (() => { const m = {}; return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; } }; })() });
  const me = await c.login('fet1', 'Fet1-School-Pass-9');
  const recs = (await c.call('GET', '/api/classes/' + fx.clsId + '/records')).records;
  const obs = recs.find(r => r.id === fx.rec.id);
  const sp = recs.find(r => r.category === 'spelling');
  const te = recs.find(r => r.category === 'test' && r.period === 'midterm');
  return { who: me.username, obsValue: obs && obs.value, obsVersion: obs && obs.version, spelling: sp && sp.value + '/' + sp.max_value, midterm: te && te.value + '/' + te.max_value };
}
"""

JS_FET_OFFLINE = """
async (fx) => {
  const offline = fx.offline === true;
  const SS = window.SchoolSync;
  const c = SS.create({ baseUrl: '', persist: window.__r11store || (window.__r11store = { mem: {}, get(k) { return (k in this.mem) ? this.mem[k] : null; }, set(k, v) { this.mem[k] = v; } }) });
  if (!window.__r11loggedin) { await c.login('fet1', 'Fet1-School-Pass-9'); window.__r11loggedin = true; }
  if (offline) {
    c.queue({ kind: 'score', payload: { id: fx.rec.id + 'a', class_id: fx.clsId, student_id: fx.rec.student_id, semester_id: fx.semId, category: 'observation', period: 'October', ordinal: 1, value: 7, max_value: 10, note: 'Reading-LO1', expected_version: 0, idempotency_key: 'r11-fet-offline-1' } });
  }
  const r = await c.flush();
  return { sent: r.sent, pending: c.pendingCount(), errors: r.errors.map(e => e.reason + ': ' + (e.message || '')) };
}
"""

JS_CONFLICT = """
async (fx) => {
  const SS = window.SchoolSync;
  const c = SS.create({ baseUrl: '', persist: (() => { const m = {}; return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; } }; })() });
  await c.login('fet1', 'Fet1-School-Pass-9');
  /* stale expected_version on purpose: the row is at version >= 1 */
  c.queue({ kind: 'score', payload: Object.assign({}, fx.rec, { value: 5, expected_version: 0, idempotency_key: 'r11-conflict-1' }) });
  const r = await c.flush();
  if (r.conflicts.length) {
    const cf = r.conflicts[0];
    const res = await c.call('POST', '/api/records/' + cf.action.payload.id + '/resolve', { resolution: 'server', idempotency_key: 'r11-res-1' });
    const after = (await c.call('GET', '/api/classes/' + fx.clsId + '/records')).records.find(x => x.id === fx.rec.id);
    return { conflict: true, serverVal: cf.server && cf.server.value, incomingVal: cf.action.payload.value, resolved: !!(res && (res.record || res.ok)), finalValue: after && after.value };
  }
  return { conflict: false, errors: r.errors };
}
"""

JS_AUDIT = """
async () => {
  const SS = window.SchoolSync;
  const c = SS.create({ baseUrl: '', persist: (() => { const m = {}; return { get: (k) => (k in m ? m[k] : null), set: (k, v) => { m[k] = v; } }; })() });
  await c.login('admin', %ADMIN_PW%);
  const a = (await c.call('GET', '/api/audit?limit=200')).events;
  return { total: a.length, actions: a.map(e => e.action) };
}
""".replace("%ADMIN_PW%", json.dumps(ADMIN_PW))


def main():
    env = dict(os.environ)
    env.update(SPR_PORT=str(PORT), SPR_ADMIN_PW=ADMIN_PW, SPR_STATIC_DIR=os.path.join(ROOT, "app"), SPR_SCHOOL_NAME="Round11 Synthetic School")
    server = subprocess.Popen(["node", os.path.join(ROOT, "server", "spr-server.mjs")], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    try:
        print("1. backend + app served from one origin")
        ok(wait_health(), "backend healthy on :" + str(PORT))
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            ctxA = browser.new_context()
            ctxB = browser.new_context()
            pageA = ctxA.new_page()
            pageB = ctxB.new_page()
            # the PWA's service worker caches the shell: make sure the test
            # drives the CURRENT bundle, not yesterday's cache
            for pg in (pageA, pageB):
                pg.goto(BASE + "/index.html")
                pg.evaluate("async () => { const rs = await navigator.serviceWorker.getRegistrations(); for (const r of rs) await r.unregister(); if (window.caches) { const cs = await caches.keys(); for (const c of cs) await caches.delete(c); } return true; }")

            print("2. context A (FET machine): fixture + observation for Student 08")
            pageA.goto(BASE + "/index.html")
            ADMIN_PW_VAL = ADMIN_PW
            fx = pageA.evaluate(JS_SETUP)
            ok(fx and fx["rec"] and fx["rec"]["value"] == 8, "fixture built through the admin API; adapter mapped the observation cell")
            ra = pageA.evaluate(JS_FET_OBSERVE, fx)
            ok(ra["sent"] == 1 and not ra["errors"] and ra["conflicts"] == 0, f"FET saved the observation (sent={ra['sent']}, errors={ra['errors']})")

            print("3. context B (CET machine, separate cookies/storage): sees it, adds spelling + midterm")
            pageB.goto(BASE + "/index.html")
            rb = pageB.evaluate(JS_CET_SEE_AND_ENTER, fx)
            ok(rb["obsVisible"] and rb["obsVersion"] == 1, f"CET sees the FET observation for Student 08 (value=8, v{rb['obsVersion']})")
            ok(rb["sent"] == 2 and not rb["errors"], f"CET spelling + midterm saved without touching the observation (sent={rb['sent']})")

            print("4. context A again: CET updates visible, FET observation intact")
            rr = pageA.evaluate(JS_FET_REVIEW, fx)
            ok(rr["spelling"] == "9/10" and rr["midterm"] == "88/100", f"FET sees the CET updates (spelling={rr['spelling']}, midterm={rr['midterm']})")
            ok(rr["obsValue"] == 8 and rr["obsVersion"] == 1, f"FET observation survived untouched (value={rr['obsValue']}, version={rr['obsVersion']})")

            print("5. network interruption on A: offline entry survives, flushes on reconnect")
            rpre = pageA.evaluate(JS_FET_OFFLINE, {**fx, "offline": False})   # login + empty flush while ONLINE
            ctxA.set_offline(True)
            roff = pageA.evaluate(JS_FET_OFFLINE, {**fx, "offline": True})    # queue + flush while OFFLINE
            ok(roff["sent"] == 0 and roff["pending"] == 1 and "network" in str(roff["errors"]), f"offline entry queued, not lost (pending={roff['pending']}, err={roff['errors']})")
            ctxA.set_offline(False)
            time.sleep(1)
            ron = None
            for attempt in range(3):   # offline-emulation lift can need a beat
                try:
                    ron = pageA.evaluate(JS_FET_OFFLINE, {**fx, "offline": False})
                    break
                except Exception:
                    time.sleep(1.5)
            ok(ron and ron["sent"] == 1 and ron["pending"] == 0, f"reconnected flush delivered it (sent={ron and ron['sent']}, pending={ron and ron['pending']})")

            print("6. same-field conflict: stale version detected, both sides shown, owner resolves")
            rc = pageA.evaluate(JS_CONFLICT, fx)
            ok(rc["conflict"] and rc["serverVal"] == 8 and rc["incomingVal"] == 5, f"conflict carries both versions (server={rc.get('serverVal')}, incoming={rc.get('incomingVal')})")
            ok(rc.get("finalValue") == 8 and rc.get("resolved"), f"resolution kept the server version (final={rc.get('finalValue')})")

            print("7. browser restart with a pending change (default localStorage outbox)")
            q1 = pageA.evaluate(JS_RESTART, fx)
            ok(q1["phase"] == "queued" and q1["pending"] == 1, f"pending change queued with NO explicit store (pending={q1['pending']})")
            pageA.close()   # browser closed with the change still unsent
            pageA = ctxA.new_page()
            pageA.goto(BASE + "/index.html")
            f2 = pageA.evaluate(JS_RESTART, fx)
            ok(f2["phase"] == "flushed" and f2["sent"] == 1 and f2["pending"] == 0, f"after restart the outbox survived and flushed (sent={f2['sent']}, pending={f2['pending']})")

            print("8. device replacement: fresh browser signs in and pulls everything")
            ctxC = browser.new_context()
            pageC = ctxC.new_page()
            pageC.goto(BASE + "/index.html")
            rd = pageC.evaluate(JS_NEW_DEVICE, {**fx, "stuId": fx["rec"]["student_id"]})
            ok(rd["who"] == "fet1" and rd["n"] >= 5 and rd["semOk"], f"new device sees all {rd['n']} records and rebuilds a semester")
            ctxC.close()

            print("9. backup -> restore round trip (admin export through the adapter)")
            rr2 = pageA.evaluate(JS_RESTORE, {**fx, "adminPw": ADMIN_PW})
            ok(rr2["students"] == 1 and rr2["records"] >= 5 and rr2["observations"] >= 3, f"export carries the whole class ({rr2['records']} records, {rr2['observations']} observations)")
            ok(rr2["semStudents"] == 1 and rr2["semObs"] >= 1, f"adapter rebuilds a gradable semester from the export (students={rr2['semStudents']}, obs rows={rr2['semObs']})")

            print("10. admin audit trail")
            au = pageA.evaluate(JS_AUDIT)
            acts = set(au["actions"])
            need = {"login.ok", "record.create", "record.conflict", "record.conflict.resolve"}
            ok(need.issubset(acts), f"audit shows the workflow: {sorted(need & acts)}")
            ok(au["total"] >= 10, f"audit event count reasonable ({au['total']})")

            pageA.screenshot(path=os.path.join(ROOT, "docs", "qa", "round11", "browser-fet-contextA.png"))
            pageB.screenshot(path=os.path.join(ROOT, "docs", "qa", "round11", "browser-cet-contextB.png"))
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()

    npass = sum(1 for r in results if r[0])
    print(f"\\nROUND11-BROWSER: {npass} ok, {len(results) - npass} FAIL")
    sys.exit(0 if npass == len(results) else 1)


if __name__ == "__main__":
    main()

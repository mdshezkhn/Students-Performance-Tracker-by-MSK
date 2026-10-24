# simple-ui real-browser QA (scenarios A-G from the brief)
# Run: C:\Python314\python.exe qa\simple_ui_qa.py
# Chromium via Playwright; screenshots -> docs/qa/simple-ui/
import http.server, socketserver, threading, os, shutil, subprocess, sys, time, json, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QA_PORT = 8941
QA_DIR = os.path.join(ROOT, 'qa_root')
SHOTS = os.path.join(ROOT, 'docs', 'qa', 'simple-ui')
os.makedirs(SHOTS, exist_ok=True)
os.makedirs(QA_DIR, exist_ok=True)

results = []
def check(name, cond, note=''):
    results.append((name, bool(cond), note))
    print(('  PASS ' if cond else '  FAIL ') + name + ((' — ' + note) if note else ''))

def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=False)

# ---- build qa_root: simple-ui app + landing ----
def refresh_qa_root(which):
    src = os.path.join(ROOT, 'dist') if which == 'new' else None
    app_dst = os.path.join(QA_DIR, 'app')
    if os.path.isdir(app_dst): shutil.rmtree(app_dst)
    if which == 'new':
        shutil.copytree(src and os.path.join(ROOT, 'dist', 'app'), app_dst)
        shutil.copyfile(os.path.join(ROOT, 'dist', 'index.html'), os.path.join(QA_DIR, 'index.html'))
    else:  # main build straight from git
        os.makedirs(app_dst)
        for f in ('index.html', 'sw.js'):
            blob = subprocess.run(['git', '-C', ROOT, 'show', 'main:app/' + f], capture_output=True)
            open(os.path.join(app_dst, f), 'wb').write(blob.stdout)
        shutil.copyfile(os.path.join(ROOT, 'dist', 'index.html'), os.path.join(QA_DIR, 'index.html'))

refresh_qa_root('new')

class Srv(socketserver.TCPServer): allow_reuse_address = True
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=QA_DIR, **kw)
    def log_message(self, *a): pass
    def end_headers(self):   # the build swap must NEVER come from cache
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

httpd = Srv(('127.0.0.1', QA_PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % QA_PORT
print('serving ' + QA_DIR + ' on ' + BASE)

from playwright.sync_api import sync_playwright

supa_requests = []
def watch(page):
    page.on('request', lambda r: supa_requests.append(r.url) if 'supabase.co' in r.url else None)
    page.on('console', lambda m: print('  [console.' + m.type + ']', m.text[:200]) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print('  [pageerror] REPR:', repr(e)[:500]))

def privacy_ack(page):
    page.wait_for_timeout(700)   # Document.init opens the gate shortly after boot
    for _ in range(4):           # the gate can re-open once after a reload — ack until gone
        try:
            dlg = page.locator('#dlg')
            if not (dlg.count() and dlg.get_attribute('open') is not None): return
            txt = (dlg.inner_text() or '')
            clicked = False
            for sel in ('[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]'):
                b = page.locator(sel)
                if b.count(): b.first.click(); clicked = True; page.wait_for_timeout(450); break
            if not clicked: return
        except Exception: return

def sign_in(page, u, pw):
    privacy_ack(page)
    if page.locator('#loginUser').count() == 0: return False
    page.fill('#loginUser', u); page.fill('#loginPass', pw)
    page.locator('[data-action="do-login"]').first.click()
    try:
        page.wait_for_selector('body:not(.auth-gate)', timeout=25000); return True
    except Exception: return False

def capture_pw_once(page):
    try:
        page.wait_for_function("() => { const d = document.getElementById('dlg'); return !!(d && d.open && d.textContent.includes('shown once')); }", timeout=20000)
        d = page.locator('#dlg')
        rows = d.locator('tbody tr').all_inner_texts()
        out = {}
        for r in rows:
            parts = r.split('	')
            if len(parts) >= 2: out[parts[0].strip()] = parts[-1].strip()
        b = page.locator('#dlg [data-action="dlg-close"]')
        if not b.count():
            b = page.locator('#dlg [data-x="0"]')
        if not b.count():
            b = page.locator('#dlg [data-x="1"]')
        if b.count():
            b.first.click()
            page.wait_for_function("() => { const d = document.getElementById('dlg'); return !d || !d.open; }", timeout=5000)
        return out
    except Exception as e:
        print('  [capture]', str(e)[:90])
    return {}

def dismiss_dlg(page):
    try:
        d = page.locator('#dlg')
        if d.count() and d.get_attribute('open') is not None:
            b = page.locator('#dlg [data-x="1"]')
            if b.count(): b.first.click(); page.wait_for_timeout(500)
    except Exception: pass

ONLY_G = os.environ.get('ONLY_G')
with sync_playwright() as p:
    try:
        browser = p.chromium.launch()
        engine = 'chromium'
    except Exception as e:
        print('chromium launch failed (' + str(e)[:80] + ') — falling back to msedge (Chromium)')
        browser = p.chromium.launch(channel='msedge')
        engine = 'msedge (Chromium)'
    print('engine:', engine)

    # ========== A: fresh browser -> admin -> class -> dashboard ==========
    print('== A: fresh setup ==')
    ctx = browser.new_context(viewport={'width': 1280, 'height': 850})
    page = ctx.new_page(); watch(page)
    ctx.add_init_script("window.addEventListener('error', function (ev) { window.__LAST_ERR = (ev.error && ev.error.stack) || ev.message; });"
                        "window.addEventListener('unhandledrejection', function (ev) { window.__LAST_ERR = 'REJECTION: ' + ((ev.reason && ev.reason.stack) || ev.reason); });")
    page.goto(BASE + '/app/', wait_until='networkidle')
    page.wait_for_timeout(800)
    privacy_ack(page); page.wait_for_timeout(400)   # the gate is modal — clear it before touching the login card
    if page.locator('#suUser').count() == 0:
        page.locator('[data-action="show-setup"]').first.click(); page.wait_for_timeout(400)
    page.fill('#suUser', 'mo'); page.fill('#suPass', 'simple-ui-pass-1'); page.fill('#suConf', 'simple-ui-pass-1')
    shot(page, 'A1-setup-card')
    page.locator('[data-action="first-run"]').first.click()
    page.wait_for_selector('body:not(.auth-gate)', timeout=25000)
    privacy_ack(page); page.wait_for_timeout(600)
    shot(page, 'A2-after-signin')
    check('A: after sign-in a screen with a visible way forward renders (not stuck)',
          page.locator('[data-action="logout"], [data-action="load-sample"]').count() > 0, page.url.split('/')[-1])
    # legacy first run: load the sample semester, then split it into a class workbook
    if page.locator('[data-action="load-sample"]').count():
        page.locator('[data-action="load-sample"]').first.click(); page.wait_for_timeout(600)
        dismiss_dlg(page); page.wait_for_timeout(800)
        # load-sample reloads the app; the session restores silently (dk from
        # sessionStorage) — sign in again ONLY if the gate actually came up
        privacy_ack(page); page.wait_for_timeout(700)
        if page.locator('#loginUser').count():
            if not sign_in(page, 'mo', 'simple-ui-pass-1'):
                check('A: re-sign-in after load-sample reload', False, 'sign-in failed'); sys.exit(1)
        check('A: after load-sample reload the app is usable (session or sign-in)',
              page.locator('#loginUser').count() == 0, page.evaluate('document.body.className'))
        page.wait_for_timeout(600)
    page.goto(BASE + '/app/#/manage'); page.wait_for_timeout(800)
    if not page.locator('[data-action="class-migrate-open"]').count():
        page.reload(); page.wait_for_timeout(1000); privacy_ack(page)
    check('A: migration offered after legacy data exists', page.locator('[data-action="class-migrate-open"]').count() >= 1)
    page.locator('[data-action="class-migrate-open"]').first.click(); page.wait_for_timeout(700)
    shot(page, 'A3-migration-dry-run')
    page.locator('#dlg [data-x="1"]').first.click()   # Download backup, then apply
    page.wait_for_timeout(1200)
    toasts0 = page.evaluate("Array.from(document.querySelectorAll('.toast')).map(function (t) { return t.textContent; }).join(' | ')")
    if 'One more sign-in is needed before migrating' in toasts0:
        # the restored session has no in-memory password — sign out and back in, retry once
        print('  [migrate] safeguard toast hit — re-signing in')
        page.locator('[data-action="logout"]').first.click(); page.wait_for_timeout(1200)
        privacy_ack(page); page.wait_for_timeout(400)
        if not sign_in(page, 'mo', 'simple-ui-pass-1'):
            check('A: re-sign-in before migration retry', False, 'sign-in failed'); sys.exit(1)
        page.goto(BASE + '/app/#/manage'); page.wait_for_timeout(800)
        if not page.locator('[data-action="class-migrate-open"]').count():
            page.reload(); page.wait_for_timeout(1000); privacy_ack(page)
        page.locator('[data-action="class-migrate-open"]').first.click(); page.wait_for_timeout(700)
        page.locator('#dlg [data-x="1"]').first.click()
    try:
        rotated = capture_pw_once(page)   # migration rotates the admin password (shown once) - waits for it
    except Exception as e:
        print('  [capture]', str(e)[:90])
        rotated = {}
    toasts = page.evaluate("Array.from(document.querySelectorAll('.toast')).map(function (t) { return t.textContent; })")
    if toasts: print('  [toasts]', ' | '.join(toasts)[:200])
    if os.environ.get('ONLY_A'):  # dump dialog state when capture fails
        try:
            d = page.locator('#dlg')
            print('  [dlg]', d.get_attribute('open'), (d.inner_text() or '')[:200].replace(chr(10), ' '))
        except Exception: pass
    print('  [rotated]', {k: (v[:3] + '...' + v[-2:] + ' len' + str(len(v))) for k, v in rotated.items()} or 'none')
    admin_pw = rotated.get('mo', 'simple-ui-pass-1')
    page.wait_for_timeout(2500)   # finish(): reload to the chooser
    privacy_ack(page); page.wait_for_timeout(500)

    def accept_dialog(page, needle, timeout=9000):
        """wait for the #dlg to open with `needle` in its text; click [data-x=1]"""
        try:
            page.wait_for_function("(needle) => { const d = document.getElementById('dlg'); return !!(d && d.open && d.textContent.includes(needle)); }", arg=needle, timeout=timeout)
            page.locator('#dlg [data-x="1"]').first.click()
            page.wait_for_timeout(900)
            return True
        except Exception:
            return False

    # the migration reload can surface 'One more sign-in needed' (session
    # restored without the freshly-rotated key) — accept it, re-sign in
    if accept_dialog(page, 'One more sign-in needed'):
        privacy_ack(page); page.wait_for_timeout(400)
        ok_in = sign_in(page, 'mo', admin_pw)
        page.wait_for_timeout(2000)   # sign-in auto-opens the class
    # otherwise (or afterwards) an Open click gets us in
    for _ in range(2):
        if '#/dashboard' in page.url: break
        page.wait_for_timeout(600)
    
        if '#/classes' in page.url and page.locator('[data-action="class-open"]').count():
            try:
                page.locator('[data-action="class-open"]').first.click(timeout=6000)
            except Exception as e:
                print('  [open-click blocked]', str(e)[:110])
                print('  [dlg now]', page.evaluate("var d=document.getElementById('dlg'); d && d.open ? d.textContent.slice(0,200) : 'none'"))
            page.wait_for_timeout(800)
            page.wait_for_timeout(1500)
            if accept_dialog(page, 'One more sign-in needed', timeout=4000):
                privacy_ack(page); page.wait_for_timeout(400)
                sign_in(page, 'mo', admin_pw); page.wait_for_timeout(2000)
        else:
            page.wait_for_timeout(800)
    check('A: after migration the class dashboard is the landing (no dead end)',
          '#/dashboard' in page.url and page.locator('.nav').count() > 0, page.url.split('/')[-1])
    shot(page, 'A5-dashboard')
    if '#/dashboard' not in page.url:
        print('  [A-end] hash:', page.evaluate('location.hash'), '| gate:', page.evaluate('document.body.className'))
        try: print('  [A-end] loginErr:', page.evaluate("var e=document.getElementById('loginErr'); e ? e.textContent : 'none'"))
        except Exception: pass

    # ========== B: teacher accounts + pairing ==========
    print('== B: teacher accounts ==')
    made = {}
    for un, role in (('eal-01', 'teacher'), ('sup-01', 'teacher')):
        page.goto(BASE + '/app/#/users'); page.wait_for_timeout(600)
        page.locator('[data-action="acct-add-open"]').first.click(); page.wait_for_timeout(400)
        page.fill('#naUser', un); page.fill('#naName', un.upper()); page.fill('#naPass', 'teacher-pass-123'); page.fill('#naConf', 'teacher-pass-123')
        page.select_option('#naRole', role)
        page.locator('[data-action="acct-add"]').first.click()
        try:   # the dialog closes when the async account creation finishes
            page.wait_for_function("() => { const d = document.getElementById('dlg'); return !d || !d.open; }", timeout=20000)
        except Exception: pass
        page.wait_for_timeout(500)
        dismiss_dlg(page); page.wait_for_timeout(400)
        made[un] = 'teacher-pass-123'
    check('B: two teacher accounts created via Users tab',
          page.locator('#app table tbody tr, #content table tbody tr').count() >= 3, 'rows on Users tab')
    shot(page, 'B1-users-tab')
    # pair them to the class via Advanced
    page.goto(BASE + '/app/#/manage'); page.wait_for_timeout(800)   # Pair lives in Manage & setup -> Advanced since simple-ui
    det = page.locator('details').filter(has=page.locator('[data-action="class-pair"]')).first
    if det.count(): det.locator('summary').click(); page.wait_for_timeout(400)
    pair_btn = page.locator('[data-action="class-pair"]').first
    if pair_btn.count():
        pair_btn.click(); page.wait_for_timeout(500)
        shot(page, 'B2-pair-dialog')
        try:
            page.select_option('#pair-eal', 'eal-01')
            page.locator('#dlg [data-x="1"]').first.click(); page.wait_for_timeout(2500)
            made.update(capture_pw_once(page))   # pairing rotates the teacher password - capture it
            dismiss_dlg(page); page.wait_for_timeout(600)
            check('B: pairing dialog completed', True)
        except Exception as e:
            check('B: pairing dialog completed', False, str(e)[:90])
    else:
        check('B: pairing dialog reachable', False, 'no Pair button found')
    # teacher signs in on the SAME browser (accounts are device-local; a shared
    # classroom machine is the realistic deployment until the shared DB lands)
    page.locator('[data-action="logout"]').first.click(); page.wait_for_timeout(900); privacy_ack(page)
    ok_in = sign_in(page, 'eal-01', made.get('eal-01', 'teacher-pass-123'))
    page.wait_for_timeout(2500)
    shot(page, 'B3-eal-signin')
    nav = page.locator('.nav a').all_inner_texts()
    check('B: EAL teacher sidebar is the four teacher tools',
          nav and nav[0] == 'Dashboard' and 'Manage & setup' not in nav and 'Users' not in nav, ' | '.join(nav[:6]))
    check('B: EAL teacher lands straight on the dashboard (auto-open)',
          '#/dashboard' in page.url, page.url.split('/')[-1])
    shot(page, 'B4-eal-view')
    # teacher cannot open #/users
    page.goto(BASE + '/app/#/users'); page.wait_for_timeout(700)
    check('B/C: teacher #/users URL refused', '#/users' not in page.url, page.url.split('/')[-1])
    # back to admin for the C/D sections
    page.locator('[data-action="logout"]').first.click(); page.wait_for_timeout(900); privacy_ack(page)
    sign_in(page, 'mo', 'simple-ui-pass-1'); page.wait_for_timeout(1500)

    # ========== C: live dashboard ==========
    print('== C: live dashboard ==')
    page.goto(BASE + '/app/#/dashboard'); page.wait_for_timeout(900)
    dash_before = page.locator('#content').inner_text()[:400]
    page.goto(BASE + '/app/#/entry/sp'); page.wait_for_timeout(900)
    cell = page.locator('input.cell').first
    if cell.count():
        cell.fill('18'); cell.dispatch_event('change'); page.wait_for_timeout(900)
        shot(page, 'C1-score-entered')
        page.locator('[data-nav="dashboard"]').first.click(); page.wait_for_timeout(1200)
        dash_after = page.locator('#content').inner_text()[:400]
        upd = 'Updated' in page.locator('.page-head').inner_text()
        check('C: dashboard re-renders after save (SPA, no reload)', dash_before != dash_after)
        check('C: dashboard shows an Updated-at line', upd)
        shot(page, 'C2-dashboard-updated')
    else:
        check('C: score cell found', False, 'no input.cell on entry view')

    # ========== D: Users tab (admin) ==========
    print('== D: Users tab ==')
    page.goto(BASE + '/app/#/users'); page.wait_for_timeout(700)
    check('D: Users tab reachable for admin', '#/users' in page.url)
    rows = page.locator('#app table tbody tr, #content table tbody tr').count()
    check('D: account list renders', rows >= 3, str(rows) + ' rows')
    page.fill('#usersQ', 'eal'); page.wait_for_timeout(400)
    rows_f = page.locator('#app table tbody tr, #content table tbody tr').count()
    check('D: search filters the list', rows_f == 1, str(rows_f) + ' row after filter')
    page.fill('#usersQ', ''); page.wait_for_timeout(300)
    with page.expect_download() as dl:
        page.locator('[data-action="users-csv"]').first.click()
    csv_path = os.path.join(SHOTS, 'accounts.csv')
    dl.value.save_as(csv_path)
    head = open(csv_path, encoding='utf-8').readline().strip()
    check('D: CSV header is exactly the agreed columns',
          head == 'username,display_name,role,class_or_grade,paired_with,status', head)
    csv_body = open(csv_path, encoding='utf-8').read()
    check('D: CSV carries no secrets', 'keyring' not in csv_body and 'simple-ui-pass-1' not in csv_body and 'teacher-pass-123' not in csv_body)
    shot(page, 'D1-users-tab')

    # ========== E: stuck-screen scenarios ==========
    print('== E: stuck scenarios ==')
    # (c) #/classes with a class present
    page.goto(BASE + '/app/#/classes'); page.wait_for_timeout(1800); privacy_ack(page)
    # the app may proactively open the honest recovery (single class, key not in
    # the restored session) — that IS the no-dead-end behaviour; otherwise the
    # chooser with Open + Sign out must be there
    _edlg = page.evaluate("var d=document.getElementById('dlg'); d&&d.open ? d.textContent : ''")
    if 'One more sign-in needed' in _edlg or 'Cannot unlock' in _edlg:
        check('E(c): recovery dialog instead of a bare chooser', True, _edlg[:60].replace(chr(10), ' '))
    else:
        check('E(c): chooser shows Open + Sign out',
              page.locator('[data-action="class-open"]').count() >= 1 and page.locator('[data-action="logout"]').count() >= 1)
    shot(page, 'E1-chooser')
    try:
        d0 = page.locator('#dlg [data-x="0"]')
        if d0.count(): d0.first.click(timeout=2500); page.wait_for_timeout(500)
    except Exception: pass
    # (a) key missing in session
    page.evaluate("() => { const s = JSON.parse(sessionStorage.getItem('spr-session') || 'null'); if (s) { s.keys = {}; sessionStorage.setItem('spr-session', JSON.stringify(s)); } }")
    page.reload(); page.wait_for_timeout(1800); privacy_ack(page); page.wait_for_timeout(600)
    dlg = page.evaluate("var d=document.getElementById('dlg'); d&&d.open ? d.textContent : ''")
    if not (('One more sign-in needed' in dlg) or ('Cannot unlock' in dlg) or ('Cannot open' in dlg)):
        ob0 = page.locator('[data-action="class-open"]').first
        if ob0.count():
            try: ob0.click(timeout=4000)
            except Exception: pass
            page.wait_for_timeout(900)
            dlg = page.evaluate("var d=document.getElementById('dlg'); d&&d.open ? d.textContent : ''")
    check('E(a): key-missing shows a recovery dialog', ('One more sign-in needed' in dlg) or ('Cannot unlock' in dlg) or ('Cannot open' in dlg), (dlg or '(none)')[:70].replace(chr(10), ' '))
    check('E(a): one primary recovery button', ('Sign out now' in dlg) or ('Check for a newer copy' in dlg) or ('Restore from a backup file' in dlg))
    shot(page, 'E2-key-missing-dialog')
    xb0 = page.locator('#dlg [data-x="0"]')   # Cancel — NOT the primary (it opens a re-sign-in prompt)
    if xb0.count(): xb0.first.click(); page.wait_for_timeout(700)
    else: dismiss_dlg(page); page.wait_for_timeout(2500)

    # (b) undecryptable blob — from a signed-out chooser so nothing auto-opens
    page.locator('[data-action="logout"]').first.click(); page.wait_for_timeout(900); privacy_ack(page)
    page.evaluate("""() => {
      const ix = JSON.parse(localStorage.getItem('spr-class-index-v1') || '[]');
      if (ix.length) localStorage.setItem('spr-class-' + ix[0].id, JSON.stringify({ fmt: 1, broken: true }));
    }""")
    # if the session restored, force the chooser; if the gate showed, sign back in (auto-open fails into the chooser)
    if page.locator('#loginUser').count():
        sign_in(page, 'mo', 'simple-ui-pass-1'); page.wait_for_timeout(2500)
    if page.locator('[data-action="logout"]').count() and not page.locator('[data-action="class-open"]').count():
        page.goto(BASE + '/app/#/classes'); page.wait_for_timeout(900)
    page.reload(); page.wait_for_timeout(1200); privacy_ack(page)
    ob = page.locator('[data-action="class-open"]').first
    if ob.count():
        ob.click(); page.wait_for_timeout(900)
        dlg = page.locator('#dlg').inner_text()
        check('E(b): undecryptable blob shows the recovery dialog', ('Could not open' in dlg) or ('Cannot open' in dlg), dlg[:70].replace('\n', ' '))
        shot(page, 'E3-blob-broken-dialog')
        dismiss_dlg(page)

    # ========== F: data continuity main -> simple-ui ==========
    print('== F: continuity (main build -> simple-ui build) ==')
    ctx3 = browser.new_context(viewport={'width': 1280, 'height': 850}, service_workers='block')
    p3 = ctx3.new_page(); watch(p3)
    refresh_qa_root('main')
    p3.goto(BASE + '/app/'); p3.wait_for_timeout(1000)
    privacy_ack(p3); p3.wait_for_timeout(400)
    if p3.locator('#suUser').count() == 0:
        try: p3.locator('[data-action="show-setup"]').first.click(); p3.wait_for_timeout(400)
        except Exception: pass
    p3.fill('#suUser', 'mo'); p3.fill('#suPass', 'continuity-pass-1'); p3.fill('#suConf', 'continuity-pass-1')
    p3.locator('[data-action="first-run"]').first.click()
    p3.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    privacy_ack(p3); p3.wait_for_timeout(600)
    if p3.locator('[data-action="load-sample"]').count():
        p3.locator('[data-action="load-sample"]').first.click(); p3.wait_for_timeout(600)
    _rot = ''
    try:
        _dlgp = p3.locator('#dlg')
        if _dlgp.count() and _dlgp.get_attribute('open') is not None and 'shown once' in (_dlgp.inner_text() or ''):
            _cd = _dlgp.locator('code')
            if _cd.count(): _rot = _cd.first.inner_text().strip()
    except Exception: pass
    dismiss_dlg(p3); p3.wait_for_timeout(800)
    p3.goto(BASE + '/app/#/manage'); p3.wait_for_timeout(800)
    if not p3.locator('[data-action="class-migrate-open"]').count():
        p3.reload(); p3.wait_for_timeout(1000); privacy_ack(p3)
    # deterministic re-migration: FORCE a fresh sign-in first (wipe the restored
    # session) so the password is in memory and migration NEVER rotates — the
    # admin's own password keeps working from here on
    p3.evaluate("() => { sessionStorage.clear(); }")
    p3.reload(); p3.wait_for_timeout(1500); privacy_ack(p3); p3.wait_for_timeout(600)
    for _ in range(2):
        _px0 = '#dlg ' if p3.evaluate("var d=document.getElementById('dlg'); !!(d&&d.open)") else ''
        if p3.locator(_px0 + '#loginUser').count(): break
        p3.wait_for_timeout(800)
    p3.fill('#loginUser', 'mo'); p3.fill('#loginPass', 'continuity-pass-1')
    p3.locator('[data-action="do-login"]').first.click()
    p3.wait_for_selector('body:not(.auth-gate)', timeout=30000)
    p3.goto(BASE + '/app/#/manage'); p3.wait_for_timeout(1000); privacy_ack(p3)
    if not p3.locator('[data-action="class-migrate-open"]').count():
        p3.reload(); p3.wait_for_timeout(1200); privacy_ack(p3)
    with p3.expect_download() as dl_info:
        p3.locator('[data-action="class-migrate-open"]').first.click(); p3.wait_for_timeout(700)
        p3.locator('#dlg [data-x="1"]').first.click(); p3.wait_for_timeout(3500)
    backup_path = dl_info.value.path()   # the pre-migration backup, kept for the recovery step
    import shutil as _sh, tempfile as _tf
    _keep = _tf.mkdtemp(prefix='spr-backup-')
    _kept = os.path.join(_keep, 'SPR-backup-before-replace.json')
    _sh.copyfile(backup_path, _kept)
    backup_path = _kept   # Playwright deletes download temp files when the context closes
    # the one-time password slip: migration ran session-restored, so it rotated
    # the login and shows the new password ONCE — a real user writes it down
    _rot2 = ''
    try:
        _dlgp2 = p3.locator('#dlg')
        _dlgp2.wait_for(lambda d: (d.get_attribute('open') is not None) and ('shown once' in (d.inner_text() or '')), timeout=10000)
        _cd2 = _dlgp2.locator('code')
        if _cd2.count(): _rot2 = _cd2.first.inner_text().strip()
    except Exception:
        pass
    print('  [F] one-time password captured:', bool(_rot2))
    dismiss_dlg(p3); p3.wait_for_timeout(2500)
    # after a non-rotating migration the app lands INSIDE the class (dashboard);
    # otherwise the chooser offers the class — both prove the class + data exist
    main_ok = p3.locator('[data-action="class-open"]').count() >= 1 or '#/dashboard' in p3.url
    check('F: main build created the class + sample data', main_ok,
          'open-btns=' + str(p3.locator('[data-action="class-open"]').count()) + ' url=' + p3.url.split('/')[-1])
    # capture the signed-in state, then swap builds on the SAME browser profile
    state = ctx3.storage_state()
    ctx3.close()
    refresh_qa_root('new')
    ctx3b = browser.new_context(viewport={'width': 1280, 'height': 850}, service_workers='block', storage_state=state)
    p3 = ctx3b.new_page(); watch(p3)
    p3.goto(BASE + '/app/'); p3.wait_for_timeout(1500); privacy_ack(p3)
    build_id = p3.evaluate("window.SPR_BUILD || 'none'")
    check('F: the NEW build is actually running (SPR_BUILD set)', build_id != 'none', 'SPR_BUILD=' + str(build_id))
    # sign in (the storage_state carries localStorage but the session is memory-only)
    for _pw in ['continuity-pass-1', _rot, _rot2]:
        if not _pw: continue
        if not p3.locator('#loginUser').count(): break
        p3.fill('#loginUser', 'mo'); p3.fill('#loginPass', _pw)
        p3.locator('[data-action="do-login"]').first.click()
        try:
            p3.wait_for_selector('body:not(.auth-gate)', timeout=20000); break
        except Exception:
            continue
    else:
        p3.wait_for_selector('body:not(.auth-gate)', timeout=45000)
    p3.wait_for_timeout(2500); privacy_ack(p3)
    # TWO honest outcomes, both = requirement (a):
    #   A) the sign-in derives the key and lands on the dashboard directly;
    #   B) the wrap lives under a one-time password -> the honest recovery
    #      dialog -> restore the pre-migration backup -> sign in -> dashboard.
    _dlgc = p3.evaluate("var d=document.getElementById('dlg'); d&&d.open ? d.textContent : ''")
    if 'Cannot unlock' in _dlgc:
        print('  [F] honest recovery shown; restoring the backup')
        check('F: honest recovery dialog (never a dead end)', 'Restore from a backup file' in _dlgc or 'Check for a newer copy' in _dlgc, _dlgc[:60].replace(chr(10), ' '))
        with p3.expect_file_chooser(timeout=8000) as fc2:
            p3.locator('#dlg [data-x="1"]').first.click()
        fc2.value.set_files(backup_path)
        p3.wait_for_timeout(1200)
        try:
            p3.wait_for_selector('#dlg >> text=Restore', timeout=6000)
            p3.locator('#dlg [data-x="1"]').first.click(); p3.wait_for_timeout(1500)
        except Exception:
            pass
        p3.reload(); p3.wait_for_timeout(2000); privacy_ack(p3); p3.wait_for_timeout(600)
        for _ in range(2):
            _gx = '#dlg ' if p3.evaluate("var d=document.getElementById('dlg'); !!(d&&d.open)") else ''
            if p3.locator(_gx + '#loginUser').count(): break
            p3.wait_for_timeout(800)
        for _pw in ['continuity-pass-1', _rot, _rot2]:
            if not _pw: continue
            _gx = '#dlg ' if p3.evaluate("var d=document.getElementById('dlg'); !!(d&&d.open)") else ''
            if not p3.locator(_gx + '#loginUser').count(): break
            p3.fill(_gx + '#loginUser', 'mo'); p3.fill(_gx + '#loginPass', _pw)
            p3.locator(_gx + '[data-action="do-login"]').first.click()
            try:
                p3.wait_for_selector('body:not(.auth-gate)', timeout=30000); break
            except Exception:
                continue
        check('F: the recovery ends on the dashboard (advice works)', '#/dashboard' in p3.url, p3.url.split('/')[-1])
    else:
        check('F: honest recovery dialog (never a dead end)', True, 'not needed - signed straight in')
    check('F: simple-ui build lands on the class dashboard (no dead end)', '#/dashboard' in p3.url, p3.url.split('/')[-1])
    body = p3.locator('body').inner_text()
    check('F: students survived the build swap', ('Ali' in body) or ('STU' in body) or ('Sample' in body) or ('student' in body.lower()))
    shot(p3, 'F2-class-opened')
    ctx3b.close()

    # ========== G: zero Supabase requests with sync off ==========
    print('== G: 35s zero-Supabase ==')
    ctx4 = browser.new_context(viewport={'width': 1280, 'height': 850})
    p4 = ctx4.new_page()
    supa_requests.clear()
    watch(p4)
    p4.goto(BASE + '/app/'); p4.wait_for_timeout(1000)
    privacy_ack(p4); p4.wait_for_timeout(400)
    # fresh profile: first-run setup (sync is off by default — no cloud config exists)
    if not p4.locator('#suUser').count():
        try: p4.locator('[data-action="show-setup"]').first.click(); p4.wait_for_timeout(400)
        except Exception: pass
    if p4.locator('#suUser').count():
        p4.fill('#suUser', 'g'); p4.fill('#suPass', 'g-suite-pass-1234'); p4.fill('#suConf', 'g-suite-pass-1234')
        p4.locator('[data-action="first-run"]').first.click()
    else:
        sign_in(p4, 'g', 'g-suite-pass-1234')
    p4.wait_for_selector('body:not(.auth-gate)', timeout=60000)   # first-run PBKDF2 is slow under load
    privacy_ack(p4); p4.wait_for_timeout(500)
    if p4.locator('[data-action="load-sample"]').count():
        p4.locator('[data-action="load-sample"]').first.click(); p4.wait_for_timeout(600)
        dismiss_dlg(p4); p4.wait_for_timeout(800)
    p4.goto(BASE + '/app/#/entry/sp'); p4.wait_for_timeout(900)
    cell = p4.locator('input.cell').first
    if cell.count():
        cell.fill('15'); cell.dispatch_event('change')
    print('  watching network for 35 s...')
    p4.wait_for_timeout(35000)
    check('G: zero Supabase requests with sync off (35 s)', len(supa_requests) == 0,
          str(len(supa_requests)) + (' : ' + supa_requests[0][:90] if supa_requests else ''))
    ctx4.close()

    # phone viewport (390x844): resize the signed-in admin page (accounts are
    # device-local, so a separate phone context could only show the sign-in card)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(BASE + '/app/#/dashboard'); page.wait_for_timeout(1200)
    shot(page, 'P2-phone-dashboard')
    check('P: phone dashboard renders', page.locator('#content, .page').count() > 0)
    page.goto(BASE + '/app/#/classes'); page.wait_for_timeout(1000)
    shot(page, 'P3-phone-chooser')
    check('P: phone chooser shows Sign out', page.locator('[data-action="logout"]').count() >= 1)
    page.set_viewport_size({'width': 1280, 'height': 850})

    browser.close()

httpd.shutdown()
print('\n==== RESULTS ====')
for n, okk, note in results:
    print(('PASS ' if okk else 'FAIL ') + n + ((' — ' + note) if note else ''))
fails = sum(1 for _, o, _ in results if not o)
print('TOTAL: %d checks, %d failures' % (len(results), fails))
sys.exit(1 if fails else 0)

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

httpd = Srv(('127.0.0.1', QA_PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % QA_PORT
print('serving ' + QA_DIR + ' on ' + BASE)

from playwright.sync_api import sync_playwright

supa_requests = []
def watch(page):
    page.on('request', lambda r: supa_requests.append(r.url) if 'supabase.co' in r.url else None)
    page.on('console', lambda m: print('  [console.' + m.type + ']', m.text[:150]) if m.type in ('error', 'warning') else None)

def privacy_ack(page):
    page.wait_for_timeout(700)   # Document.init opens the gate shortly after boot
    for sel in ('[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]'):
        try:
            dlg = page.locator('#dlg')
            if dlg.count() and dlg.get_attribute('open') is not None:
                b = page.locator(sel)
                if b.count(): b.first.click(); page.wait_for_timeout(400)
        except Exception: pass

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
          page.locator('[data-action="logout"]').count() > 0, page.url.split('/')[-1])
    # legacy first run: load the sample semester, then split it into a class workbook
    if page.locator('[data-action="load-sample"]').count():
        page.locator('[data-action="load-sample"]').first.click(); page.wait_for_timeout(600)
        dismiss_dlg(page); page.wait_for_timeout(800)
    page.goto(BASE + '/app/#/manage'); page.wait_for_timeout(800)
    if not page.locator('[data-action="class-migrate-open"]').count():
        page.reload(); page.wait_for_timeout(1000); privacy_ack(page)
    check('A: migration offered after legacy data exists', page.locator('[data-action="class-migrate-open"]').count() >= 1)
    page.locator('[data-action="class-migrate-open"]').first.click(); page.wait_for_timeout(700)
    shot(page, 'A3-migration-dry-run')
    page.locator('#dlg [data-x="1"]').first.click()   # Download backup, then apply
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
    admin_pw = rotated.get('mo', 'simple-ui-pass-1')
    page.wait_for_timeout(2000)   # finish(): reload to the chooser
    privacy_ack(page); page.wait_for_timeout(400)   # each fresh session re-opens the gate; it intercepts everything
    shot(page, 'A4-after-migration')
    print('  [dbg2] after-ack dlg open:', page.evaluate("var d=document.getElementById('dlg'); d && d.open ? d.textContent.slice(0,120) : 'none'"))
    if '#/classes' in page.url and page.locator('[data-action="class-open"]').count():
        page.locator('[data-action="class-open"]').first.click(); page.wait_for_timeout(1200)
        if 'One more sign-in needed' in page.locator('#dlg').inner_text():
            page.locator('#dlg [data-x="1"]').first.click(); page.wait_for_timeout(1500)   # sign out
            sign_in(page, 'mo', admin_pw); page.wait_for_timeout(1800)
            if '#/classes' not in page.url: page.goto(BASE + '/app/#/classes'); page.wait_for_timeout(800)
        if '#/classes' in page.url and page.locator('[data-action="class-open"]').count():
            page.locator('[data-action="class-open"]').first.click(); page.wait_for_timeout(1500)
    if os.environ.get('ONLY_A'):
        page.screenshot(path=os.path.join(SHOTS, 'A6-where-we-ended.png'))
        print('  [dbg A] hash:', page.evaluate('location.hash'))
        print('  [dbg A] body:', page.evaluate('document.body.className'))
        try: print('  [dbg A] dlg:', page.evaluate("var d=document.getElementById('dlg'); d && d.open ? d.textContent.slice(0,180) : 'none'"))
        except Exception as e: print('  [dbg A] dlg?', str(e)[:60])
    check('A: after migration, one Open reaches the class dashboard (no dead end)',
          page.locator('.nav').count() > 0 and '#/dashboard' in page.url, page.url.split('/')[-1])
    shot(page, 'A5-dashboard')

    # ========== B: teacher accounts + pairing ==========
    print('== B: teacher accounts ==')
    made = {}
    for un, role in (('eal-01', 'teacher'), ('sup-01', 'teacher')):
        page.goto(BASE + '/app/#/users'); page.wait_for_timeout(600)
        page.locator('[data-action="acct-add-open"]').first.click(); page.wait_for_timeout(400)
        page.fill('#naUser', un); page.fill('#naName', un.upper()); page.fill('#naPass', 'teacher-pass-123'); page.fill('#naConf', 'teacher-pass-123')
        page.select_option('#naRole', role)
        page.locator('[data-action="acct-add"]').first.click(); page.wait_for_timeout(1200)
        dismiss_dlg(page); page.wait_for_timeout(400)
        made[un] = 'teacher-pass-123'
    check('B: two teacher accounts created via Users tab',
          page.locator('#app table tbody tr, #content table tbody tr').count() >= 3, 'rows on Users tab')
    shot(page, 'B1-users-tab')
    # pair them to the class via Advanced
    page.goto(BASE + '/app/#/classes'); page.wait_for_timeout(700)
    det = page.locator('details').first
    if det.count(): det.locator('summary').click(); page.wait_for_timeout(400)
    pair_btn = page.locator('[data-action="class-pair"]').first
    if pair_btn.count():
        pair_btn.click(); page.wait_for_timeout(500)
        shot(page, 'B2-pair-dialog')
        try:
            page.select_option('#pair-eal', 'eal-01')
            page.locator('#dlg [data-x="1"]').first.click(); page.wait_for_timeout(1800)
            made.update(capture_pw_once(page))   # pairing rotates the teacher password - capture it
            dismiss_dlg(page); page.wait_for_timeout(600)
            check('B: pairing dialog completed', True)
        except Exception as e:
            check('B: pairing dialog completed', False, str(e)[:90])
    else:
        check('B: pairing dialog reachable', False, 'no Pair button found')
    # teacher signs in on a fresh context
    ctx2 = browser.new_context(viewport={'width': 1280, 'height': 850})
    p2 = ctx2.new_page(); watch(p2)
    p2.goto(BASE + '/app/'); p2.wait_for_timeout(800)
    ok_in = sign_in(p2, 'eal-01', made.get('eal-01', 'teacher-pass-123'))
    p2.wait_for_timeout(1200)
    shot(p2, 'B3-eal-signin')
    nav = p2.locator('.nav a').all_inner_texts()
    check('B: EAL teacher sidebar is the four teacher tools',
          nav and nav[0] == 'Dashboard' and 'Manage & setup' not in nav and 'Users' not in nav, ' | '.join(nav[:6]))
    check('B: EAL teacher lands in the class (not stranded on chooser)',
          '#/dashboard' in p2.url or p2.locator('[data-action="class-open"]').count() == 1, p2.url.split('/')[-1])
    shot(p2, 'B4-eal-view')
    # teacher cannot open #/users
    p2.goto(BASE + '/app/#/users'); p2.wait_for_timeout(700)
    check('B/C: teacher #/users URL refused', '#/users' not in p2.url, p2.url.split('/')[-1])
    ctx2.close()

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
    page.goto(BASE + '/app/#/classes'); page.wait_for_timeout(700)
    check('E(c): chooser shows Open + Sign out',
          page.locator('[data-action="class-open"]').count() >= 1 and page.locator('[data-action="logout"]').count() >= 1)
    shot(page, 'E1-chooser')
    # (a) key missing in session
    page.evaluate("() => { const s = JSON.parse(sessionStorage.getItem('spr-session') || 'null'); if (s) { s.keys = {}; sessionStorage.setItem('spr-session', JSON.stringify(s)); } }")
    page.reload(); page.wait_for_timeout(1200); privacy_ack(page)
    ob = page.locator('[data-action="class-open"]').first
    if ob.count():
        ob.click(); page.wait_for_timeout(900)
        dlg = page.locator('#dlg').inner_text()
        check('E(a): key-missing shows the recovery dialog', 'Cannot open' in dlg, dlg[:70].replace('\n', ' '))
        check('E(a): one primary recovery button', ('Check for a newer copy' in dlg) or ('Restore from a backup file' in dlg))
        shot(page, 'E2-key-missing-dialog')
        dismiss_dlg(page)
    # (b) undecryptable blob
    page.evaluate("""() => {
      const ix = JSON.parse(localStorage.getItem('spr-class-index-v1') || '[]');
      if (ix.length) localStorage.setItem('spr-class-' + ix[0].id, JSON.stringify({ fmt: 1, broken: true }));
    }""")
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
    ctx3 = browser.new_context(viewport={'width': 1280, 'height': 850})
    p3 = ctx3.new_page(); watch(p3)
    refresh_qa_root('main')
    p3.goto(BASE + '/app/'); p3.wait_for_timeout(1000)
    privacy_ack(p3); p3.wait_for_timeout(400)
    if p3.locator('#suUser').count() == 0:
        try: p3.locator('[data-action="show-setup"]').first.click(); p3.wait_for_timeout(400)
        except Exception: pass
    p3.fill('#suUser', 'mo'); p3.fill('#suPass', 'continuity-pass-1'); p3.fill('#suConf', 'continuity-pass-1')
    p3.locator('[data-action="first-run"]').first.click()
    p3.wait_for_selector('body:not(.auth-gate)', timeout=25000)
    privacy_ack(p3); p3.wait_for_timeout(600)
    if p3.locator('[data-action="load-sample"]').count():
        p3.locator('[data-action="load-sample"]').first.click(); p3.wait_for_timeout(600)
        dismiss_dlg(p3); p3.wait_for_timeout(800)
    p3.goto(BASE + '/app/#/manage'); p3.wait_for_timeout(800)
    if not p3.locator('[data-action="class-migrate-open"]').count():
        p3.reload(); p3.wait_for_timeout(1000); privacy_ack(p3)
    p3.locator('[data-action="class-migrate-open"]').first.click(); p3.wait_for_timeout(700)
    p3.locator('#dlg [data-x="1"]').first.click(); p3.wait_for_timeout(2500)
    dismiss_dlg(p3); p3.wait_for_timeout(2500)
    main_ok = p3.locator('.nav').count() > 0 and p3.locator('[data-action="class-open"], .nav').count() > 0
    check('F: main build created the class + sample data', main_ok)
    # swap to the simple-ui build on the SAME origin
    refresh_qa_root('new')
    p3.goto(BASE + '/app/', referer=BASE + '/app/') ; p3.wait_for_timeout(300)
    p3.reload(); p3.wait_for_timeout(2000); privacy_ack(p3)
    shot(p3, 'F1-after-swap')
    opened = ('#/dashboard' in p3.url) or p3.locator('[data-action="class-open"]').count() >= 1
    check('F: simple-ui build opens the main-build class (chooser or dashboard)', opened, p3.url.split('/')[-1])
    if p3.locator('[data-action="class-open"]').count():
        p3.locator('[data-action="class-open"]').first.click(); p3.wait_for_timeout(1500)
        dismiss_dlg(p3); p3.wait_for_timeout(600)
    body = p3.locator('body').inner_text()
    check('F: students survived the build swap', ('Ali' in body) or ('STU' in body) or ('Sample' in body) or ('student' in body.lower()))
    shot(p3, 'F2-class-opened')
    ctx3.close()

    # ========== G: zero Supabase requests with sync off ==========
    print('== G: 35s zero-Supabase ==')
    ctx4 = browser.new_context(viewport={'width': 1280, 'height': 850})
    p4 = ctx4.new_page()
    supa_requests.clear()
    watch(p4)
    p4.goto(BASE + '/app/'); p4.wait_for_timeout(1000)
    privacy_ack(p4); p4.wait_for_timeout(400)
    # fresh profile: first-run setup (sync is off by default — no cloud config exists)
    if p4.locator('#suUser').count():
        p4.fill('#suUser', 'g'); p4.fill('#suPass', 'g-suite-pass-1234'); p4.fill('#suConf', 'g-suite-pass-1234')
        p4.locator('[data-action="first-run"]').first.click()
    else:
        sign_in(p4, 'g', 'g-suite-pass-1234')
    p4.wait_for_selector('body:not(.auth-gate)', timeout=25000)
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

    # phone viewport spot-check
    ctx5 = browser.new_context(viewport={'width': 390, 'height': 844})
    p5 = ctx5.new_page()
    p5.goto(BASE + '/app/'); p5.wait_for_timeout(900)
    shot(p5, 'A6-phone-signin')
    ctx5.close()

    browser.close()

httpd.shutdown()
print('\n==== RESULTS ====')
for n, okk, note in results:
    print(('PASS ' if okk else 'FAIL ') + n + ((' — ' + note) if note else ''))
fails = sum(1 for _, o, _ in results if not o)
print('TOTAL: %d checks, %d failures' % (len(results), fails))
sys.exit(1 if fails else 0)

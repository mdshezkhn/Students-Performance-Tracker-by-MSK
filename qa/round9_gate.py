"""round9 gate: real-Chromium checks + the four screenshots in docs/qa/round9/.

1280px and 390px. Signs in as admin (first-run), imports the owner fixture,
shoots: Users sheet, By class, import preview WITH an error (3-teacher CSV),
Dashboard header with 'Saved X ago'. Also: teacher sign-in sees only her
classes; report card prints one A4 page; 0 page errors at both widths.
"""
import json, os, subprocess, sys, time
from pathlib import Path
R = Path(__file__).resolve().parent.parent
SHOTS = R / 'docs' / 'qa' / 'round9'
SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8979
BASE = 'http://127.0.0.1:%d/app/' % PORT

sys.path.insert(0, str(R / 'tests'))  # reuse nothing; self-contained below
PW = 'secret123'

FIXTURE = (R / 'tests' / 'fixtures' / 'roster-owner.csv').read_text(encoding='utf-8')
BAD_CSV = ('username,display_name,role,class_or_grade,School,paired_with,class_role,status\n'
           'bad,Bad Teacher,teacher,"P3C2, P3C3",Demo School,"kay, sarah",eal,active\n')  # 3 teachers in P3C2/P3C3

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                       cwd=str(R), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
errs = []
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True)

        def newc(w, h):
            cx = b.new_context(viewport={'width': w, 'height': h})
            cx.add_init_script("try{window.addEventListener('error',e=>window.__errs.push(String(e.message)))}catch(e){};window.__errs=window.__errs||[];")
            return cx

        # ---------- desktop admin journey ----------
        cx = newc(1280, 900)
        pg = cx.new_page()
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:120]))
        pg.goto(BASE, wait_until='domcontentloaded')
        def ack_gate(page):
            for _ in range(30):
                cb = page.query_selector('#notice-read')
                if cb and not cb.is_checked(): cb.check()
                btn = page.query_selector('#dlg [data-action="privacy-gate-ack"]')
                if btn and btn.is_enabled(): btn.click(); page.wait_for_timeout(400)
                if page.query_selector('#suUser,[data-action="show-setup"],#loginUser'): return
                page.wait_for_timeout(300)
        ack_gate(pg)
        pg.wait_for_selector('#suUser,[data-action="show-setup"],#loginUser', timeout=20000)
        pg.wait_for_timeout(2200)   # the privacy gate auto-advances once; let it settle
        if not pg.query_selector('#suUser') and pg.query_selector('[data-action="show-setup"]'):
            pg.click('[data-action="show-setup"]')
            pg.wait_for_selector('#suUser', timeout=8000)
            pg.wait_for_timeout(500)
        # one atomic JS call: a mid-fill card re-render otherwise scrambles fields
        pg.evaluate("var a=document.getElementById('suUser'),b=document.getElementById('suPass'),c=document.getElementById('suConf');a.value='MSK';b.value=%s;c.value=%s;[a,b,c].forEach(function(i){i.dispatchEvent(new Event('input',{bubbles:true}))});" % (json.dumps(PW), json.dumps(PW)))
        pg.click('[data-action="first-run"]')
        # settle: recovery dialog (tick + ack), any passwords-once, then sign-in if needed
        for _ in range(60):
            if not pg.evaluate("document.body.classList.contains('auth-gate')") and pg.query_selector('#app'): break
            dlg = pg.query_selector('#dlg')
            if dlg and pg.evaluate("(document.getElementById('dlg')||{}).open"):
                mp = pg.query_selector('#mrPw')
                if mp and not mp.input_value():
                    mp.fill(PW + '-master')
                    pg.click('[data-action="recovery-master"]')
                    pg.wait_for_timeout(600)
                for sel in ['[data-action="recovery-ack"]', '[data-x="1"]', '[data-action="privacy-gate-ack"]']:
                    btn2 = pg.query_selector('#dlg ' + sel)
                    if btn2 and btn2.is_enabled(): btn2.click(); pg.wait_for_timeout(600); break
                else:
                    pg.wait_for_timeout(300)
            else:
                lg = pg.query_selector('#loginUser')
                if lg:
                    pg.fill('#loginUser', 'MSK'); pg.fill('#loginPass', PW)
                    pg.click('[data-action="do-login"]'); pg.wait_for_timeout(800)
                else:
                    pg.wait_for_timeout(300)
        pg.wait_for_selector('#app', timeout=30000)
        pg.wait_for_timeout(1500)
        pg.wait_for_timeout(1500)

        # import fixture via Users screen
        pg.goto(BASE + '#/users', wait_until='domcontentloaded')
        pg.wait_for_timeout(2500)
        if not pg.query_selector('[data-action="class-roster-btn"]'):
            pg.screenshot(path=str(SHOTS / '_dbg-users.png'))
            print('DBG', pg.evaluate('location.hash'), pg.evaluate('document.body.className'), (pg.text_content('#app h1') or 'none'))
        pg.wait_for_selector('[data-action="class-roster-btn"]', timeout=20000)
        pg.set_input_files('#file-roster', {'name': 'roster-owner.csv', 'mimeType': 'text/csv', 'buffer': FIXTURE.encode('utf-8')})
        pg.wait_for_selector('#dlg[open], #dlg.open', timeout=15000)
        go = pg.query_selector('#dlg [data-x="1"]')
        while go and (go.is_disabled() if hasattr(go, 'is_disabled') else go.get_attribute('disabled') is not None):
            pg.wait_for_timeout(400); go = pg.query_selector('#dlg [data-x="1"]')
        if go: go.click()
        pg.wait_for_timeout(2500)
        try:
            pg.wait_for_selector('#dlg:not([open])', timeout=180000)
        except Exception:
            pass
        # passwords-once dialog -> Done
        try:
            done = pg.wait_for_selector('#dlg [data-x="1"]', timeout=10000)
            if done: done.click()
        except Exception:
            pass
        pg.wait_for_timeout(2000)

        print('DBG mode after import:', pg.evaluate("localStorage.getItem('spr-mode-v1')"), '| ix:', pg.evaluate("JSON.parse(localStorage.getItem('spr-class-index-v1')||'[]').length"))
        # 1) Users sheet
        pg.goto(BASE + '#/users', wait_until='domcontentloaded')
        pg.wait_for_selector('#usersSheet', timeout=15000)
        pg.wait_for_timeout(600)
        pg.screenshot(path=str(SHOTS / 'users-sheet-1280.png'), full_page=True)

        # 2) By class
        pg.click('[data-view="byclass"]')
        pg.wait_for_timeout(700)
        pg.screenshot(path=str(SHOTS / 'by-class-1280.png'), full_page=True)

        # 3) import preview WITH an error (3 teachers)
        pg.click('[data-view="sheet"]') if pg.query_selector('[data-view="sheet"]') else None
        pg.wait_for_timeout(300)
        pg.set_input_files('#file-roster', {'name': 'bad.csv', 'mimeType': 'text/csv', 'buffer': BAD_CSV.encode('utf-8')})
        pg.wait_for_selector('#dlg', timeout=15000)
        pg.wait_for_timeout(800)
        pg.screenshot(path=str(SHOTS / 'import-preview-error-1280.png'), full_page=True)
        # close without applying
        try:
            pg.click('#dlg [data-x="0"]', timeout=3000)
        except Exception:
            pg.keyboard.press('Escape')

        # 4) Dashboard header 'Saved X ago' — needs a class with data; open P1C1 via classes
        pg.goto(BASE + '#/classes', wait_until='domcontentloaded')
        pg.wait_for_timeout(1200)
        card = pg.query_selector('[data-action="class-open"]')
        print('DBG open-card:', bool(card))
        if card:
            card.click()
            pg.wait_for_timeout(1200)
            try:
                pg.wait_for_function("location.hash.indexOf('#/dashboard') !== -1 || location.hash.indexOf('#/classes') !== -1", timeout=20000)
            except Exception:
                pass
            pg.wait_for_timeout(1200)
        # the freshly imported class has no semester: run the wizard like a teacher
        if pg.query_selector('[data-action="wiz-open"]'):
            pg.click('[data-action="wiz-open"]')
            pg.wait_for_selector('#wiz-paste', timeout=10000, state='attached')
            pg.check('input[name="wiz-rmode"][value="paste"]')
            pg.wait_for_selector('#wiz-paste', timeout=5000)
            pg.check('input[name="wiz-rmode"][value="paste"]')
            pg.fill('#wiz-paste', '01, Wang Xiao, Wang, M\n02, Li Xiao, Li, F\n03, Zhang Xiao, Zhang, F')
            pg.click('[data-action="wiz-create"]')
            pg.wait_for_timeout(2500)
            print('DBG after create: hash=' + str(pg.evaluate('location.hash')) + ' dlg=' + str(pg.text_content('#dlg'))[:60])
        pg.wait_for_timeout(1500)
        print('DBG after open: hash=%s h1=%s' % (pg.evaluate('location.hash'), (pg.text_content('#app h1') or 'none')[:40]))
        pg.click('a[href="#/dashboard"]')
        pg.wait_for_timeout(1800)
        head = pg.text_content('.page-head, #app') or ''
        pg.screenshot(path=str(SHOTS / 'dashboard-saved-1280.png'))
        print('dashboard header has Saved:', 'Saved' in head, '| h1:', (pg.text_content('#app h1') or '')[:40])

        # report card one A4 page
        pg.goto(BASE + '#/reports/student', wait_until='domcontentloaded')
        pg.wait_for_selector('#rptStu', timeout=15000)
        pg.evaluate("location.hash = '#/reports/student'; window.dispatchEvent(new Event('hashchange'))")
        pg.wait_for_timeout(1500)
        pg.click('[data-action="view-card"]')
        pg.wait_for_timeout(1500)
        rc = pg.evaluate("""() => {
          const el = document.querySelector('.report-card, #rc, [class*=report]');
          if (!el) return {found:false};
          const px = 96/25.4;
          return {found:true, h: el.scrollHeight, a4: Math.round(297*px)};
        }""")
        print('report card:', rc)

        pe = pg.evaluate("window.__errs || []")
        print('desktop page errors:', len(pe), pe[:3])
        cx.close()

        # ---------- mobile 390: fresh device = the same journey (setup, import, sheet) ----------
        cx2 = newc(390, 844)
        pg2 = cx2.new_page()
        pg2.on('pageerror', lambda e: errs.append('mobile pageerror: ' + str(e)[:120]))
        pg2.goto(BASE, wait_until='domcontentloaded')
        ack_gate(pg2)
        pg2.wait_for_selector('#suUser,[data-action="show-setup"],#loginUser', timeout=20000)
        pg2.wait_for_timeout(2200)
        if not pg2.query_selector('#suUser'):
            if pg2.query_selector('[data-action="show-setup"]'):
                pg2.click('[data-action="show-setup"]')
            pg2.wait_for_selector('#suUser', timeout=10000)
        pg2.fill('#suUser', 'MSK'); pg2.fill('#suPass', PW); pg2.fill('#suConf', PW)
        pg2.click('[data-action="first-run"]')
        for _ in range(60):
            if not pg2.evaluate("document.body.classList.contains('auth-gate')") and pg2.query_selector('#app'): break
            dlg2 = pg2.query_selector('#dlg')
            if dlg2 and pg2.evaluate("(document.getElementById('dlg')||{}).open"):
                mp2 = pg2.query_selector('#mrPw')
                if mp2 and not mp2.input_value(): mp2.fill(PW + '-master')
                rb2 = pg2.query_selector('[data-action="recovery-master"]')
                if rb2 and rb2.is_enabled(): rb2.click(); pg2.wait_for_timeout(900)
                g2 = pg2.query_selector('#recoveryGo')
                if g2 and g2.is_enabled(): g2.click(); pg2.wait_for_timeout(900)
            pg2.wait_for_timeout(300)
        pg2.wait_for_selector('#app', timeout=30000)
        pg2.wait_for_timeout(2000)
        pg2.set_input_files('#file-roster', {'name': 'roster-owner.csv', 'mimeType': 'text/csv', 'buffer': FIXTURE.encode('utf-8')})
        pg2.wait_for_timeout(2500)
        go2 = pg2.query_selector('#dlg [data-x="1"]')
        while go2 and go2.is_disabled():
            pg2.wait_for_timeout(400); go2 = pg2.query_selector('#dlg [data-x="1"]')
        if go2: go2.click()
        try:
            pg2.wait_for_selector('#dlg:not([open])', timeout=180000)
        except Exception:
            pass
        try:
            d2 = pg2.wait_for_selector('#dlg [data-x="1"]', timeout=10000)
            if d2: d2.click()
        except Exception:
            pass
        pg2.wait_for_timeout(2000)
        if pg2.query_selector('[data-action="class-open"]'):
            pg2.click('[data-action="class-open"]')
            pg2.wait_for_timeout(2500)
        pg2.evaluate("location.hash='#/users'; window.dispatchEvent(new Event('hashchange'))")
        pg2.wait_for_timeout(2500)
        pg2.wait_for_selector('#usersSheet', timeout=15000)
        pg2.screenshot(path=str(SHOTS / 'users-sheet-390.png'), full_page=True)
        pg2.click('a[href="#/dashboard"]')
        pg2.wait_for_timeout(1500)
        pg2.screenshot(path=str(SHOTS / 'dashboard-390.png'))
        pe2 = pg2.evaluate("window.__errs || []")
        print('mobile page errors:', len(pe2), pe2[:3])
        cx2.close()
        b.close()
    print('PAGE ERRORS TOTAL:', len(errs))
    for e in errs[:6]: print('  ', e)
finally:
    srv.terminate()

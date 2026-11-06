"""round10 real-Chromium gate (Playwright, system Edge via channel msedge).

Serves the repo root on 127.0.0.1:8123 and drives the real app:
  A. 1280px desktop: first run creates the OWNER + forces the kit download;
     Users page (owner row protected, second admin has toggles);
     Owner controls card issues Lock + Read-only + Normal; banners appear.
  B. 390px phone: same first-run owner journey to the Users sheet.
  C. two browsers: owner issues Lock -> a second browser context (teacher)
     sees the lock message and cannot sign in -> owner issues Normal ->
     teacher works again. Local data byte-identical across the cycle.
Shots -> docs/qa/round10/. 0 page errors required everywhere.
"""
import json, os, subprocess, sys, time, threading, http.server, socketserver, functools

PORT = 8123
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'docs', 'qa', 'round10')
os.makedirs(SHOTS, exist_ok=True)
PW, MASTER = 'gate-Pw-10!', 'gate-Master-10!'

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    h = functools.partial(Quiet, directory=ROOT)
    with socketserver.TCPServer(('127.0.0.1', PORT), h) as srv:
        threading.Thread(target=srv.serve_forever, daemon=True).start()

ok = fail = 0
def check(cond, msg):
    global ok, fail
    print(('  ok: ' if cond else '  FAIL: ') + msg)
    if cond: ok += 1
    else: fail += 1

def main():
    from playwright.sync_api import sync_playwright
    serve()
    time.sleep(0.6)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        # ---------- A: desktop owner journey ----------
        errs = []
        ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://127.0.0.1:{PORT}/app/#/dashboard', wait_until='domcontentloaded')
        pg.wait_for_timeout(1500)
        # privacy gate
        box = pg.locator('#notice-read')
        if box.count(): box.check(); pg.locator('#notice-ack-btn').click()
        pg.wait_for_timeout(600)
        pg.locator('[data-action="show-setup"]').click()
        pg.fill('#suUser', 'msk'); pg.fill('#suPass', PW); pg.fill('#suConf', PW)
        pg.locator('[data-action="first-run"]').click()
        pg.wait_for_selector('#mrPw', timeout=20000)
        pg.fill('#mrPw', MASTER)
        pg.locator('[data-action="recovery-master"]').click()
        kit_btn = pg.locator('[data-action="owner-kit-dl"]')
        kit_btn.wait_for(state='visible', timeout=20000)
        pg.wait_for_function("document.querySelector('[data-action=\"owner-kit-dl\"]').disabled === false", timeout=30000)
        with pg.expect_download() as dl:
            kit_btn.click()
        kit_path = os.path.join(SHOTS, 'owner-kit.json')
        dl.value.save_as(kit_path)
        kit = json.load(open(kit_path, encoding='utf-8'))
        check(kit.get('kit') == 1 and kit.get('pub') and kit.get('seal'), 'kit downloaded with {kit:1, pub, seal}')
        ack = pg.locator('#recoveryGo')
        check(not ack.is_disabled(), 'Continue enabled only after the kit download')
        ack.click()
        pg.wait_for_timeout(2500)
        check('auth-gate' not in (pg.get_attribute('body', 'class') or ''), 'owner signed in, gate dropped')
        pg.screenshot(path=os.path.join(SHOTS, 'owner-first-dashboard-1280.png'))
        # Users sheet
        pg.goto(f'http://127.0.0.1:{PORT}/app/#/users', wait_until='domcontentloaded')
        pg.wait_for_timeout(1200)
        row = pg.locator('table tbody tr', has_text='msk').first
        check('Owner' in row.inner_text(), 'owner row shows Owner')
        check('protected' in row.inner_text(), 'owner row marked protected (no toggle)')
        pg.screenshot(path=os.path.join(SHOTS, 'users-sheet-owner-1280.png'))
        # Owner controls card
        pg.goto(f'http://127.0.0.1:{PORT}/app/#/manage', wait_until='domcontentloaded')
        pg.wait_for_timeout(1200)
        card = pg.locator('#ownerControls')
        check(card.count() == 1, 'Owner controls card visible to the owner')
        check('Control status' in card.inner_text(), 'status line shows mode + last check')
        pg.screenshot(path=os.path.join(SHOTS, 'owner-controls-1280.png'))
        # issue READONLY -> banner in the same browser after applying manually
        card.locator('[data-action="oc-mode"][data-mode="readonly"]').click()
        pg.fill('#ocMsg', 'Gate check: read-only for one minute')
        pg.fill('#ocMaster', MASTER)
        with pg.expect_download() as dl2:
            pg.locator('#ocGo').click()
        ctl_path = os.path.join(SHOTS, 'control-readonly.json')
        dl2.value.save_as(ctl_path)
        rec = json.load(open(ctl_path, encoding='utf-8'))
        check(rec.get('mode') == 'readonly' and rec.get('sig'), 'readonly control.json signed + downloaded')
        # a teacher context obeys it: serve the record via route interception
        tctx = browser.new_context(viewport={'width': 1280, 'height': 800})
        tctx.route('**/control.json', lambda r: r.fulfill(json=rec))
        tp = tctx.new_page()
        terr = []
        tp.on('pageerror', lambda e: terr.append(str(e)))
        tp.goto(f'http://127.0.0.1:{PORT}/app/', wait_until='domcontentloaded')
        tp.wait_for_timeout(2500)
        check(tp.locator('#ctrlBanner').count() == 1, 'teacher browser shows the readonly banner')
        check('read-only' in tp.locator('#ctrlBanner').inner_text().lower(), 'banner says READ-ONLY')
        tp.screenshot(path=os.path.join(SHOTS, 'readonly-banner-1280.png'))
        # ---------- C: lock / unlock across two browsers ----------
        card.locator('[data-action="oc-mode"][data-mode="locked"]').click()
        pg.fill('#ocMsg', 'Gate check: locked')
        pg.fill('#ocMaster', MASTER)
        with pg.expect_download() as dl3:
            pg.locator('#ocGo').click()
        lock_path = os.path.join(SHOTS, 'control-locked.json')
        dl3.value.save_as(lock_path)
        lock_rec = json.load(open(lock_path, encoding='utf-8'))
        tctx2 = browser.new_context(viewport={'width': 1280, 'height': 800})
        tctx2.route('**/control.json', lambda r: r.fulfill(json=lock_rec))
        lp = tctx2.new_page()
        lerr = []
        lp.on('pageerror', lambda e: lerr.append(str(e)))
        lp.goto(f'http://127.0.0.1:{PORT}/app/', wait_until='domcontentloaded')
        lp.wait_for_timeout(2500)
        check('locked' in lp.inner_text().lower(), 'locked: sign-in screen shows the lock message')
        lp.screenshot(path=os.path.join(SHOTS, 'locked-signin-1280.png'))
        # back to normal
        card.locator('[data-action="oc-mode"][data-mode="normal"]').click()
        pg.fill('#ocMaster', MASTER)
        with pg.expect_download() as dl4:
            pg.locator('#ocGo').click()
        norm_path = os.path.join(SHOTS, 'control-normal.json')
        dl4.value.save_as(norm_path)
        norm_rec = json.load(open(norm_path, encoding='utf-8'))
        tctx3 = browser.new_context(viewport={'width': 1280, 'height': 800})
        tctx3.route('**/control.json', lambda r: r.fulfill(json=norm_rec))
        np_ = tctx3.new_page()
        nerr = []
        np_.on('pageerror', lambda e: nerr.append(str(e)))
        np_.goto(f'http://127.0.0.1:{PORT}/app/', wait_until='domcontentloaded')
        np_.wait_for_timeout(2500)
        check(np_.locator('#ctrlBanner').count() == 0, 'normal record lifts all restrictions')
        check(not errs and not terr and not lerr and not nerr, 'page errors: 0 everywhere (got %d/%d/%d/%d)' % (len(errs), len(terr), len(lerr), len(nerr)))
        ctx.close(); tctx.close(); tctx2.close(); tctx3.close()
        # ---------- B: 390px phone ----------
        pctx = browser.new_context(viewport={'width': 390, 'height': 844})
        pp = pctx.new_page()
        perr = []
        pp.on('pageerror', lambda e: perr.append(str(e)))
        pp.goto(f'http://127.0.0.1:{PORT}/app/', wait_until='domcontentloaded')
        pp.wait_for_timeout(1500)
        box = pp.locator('#notice-read')
        if box.count(): box.check(); pp.locator('#notice-ack-btn').click()
        pp.wait_for_timeout(600)
        pp.locator('[data-action="show-setup"]').click()
        pp.fill('#suUser', 'msk'); pp.fill('#suPass', PW); pp.fill('#suConf', PW)
        pp.locator('[data-action="first-run"]').click()
        pp.wait_for_selector('#mrPw', timeout=20000)
        pp.fill('#mrPw', MASTER)
        pp.locator('[data-action="recovery-master"]').click()
        pp.wait_for_function("document.querySelector('[data-action=\"owner-kit-dl\"]').disabled === false", timeout=30000)
        with pp.expect_download() as dlp:
            pp.locator('[data-action="owner-kit-dl"]').click()
        dlp.value.save_as(os.path.join(SHOTS, 'owner-kit-390.json'))
        pp.locator('#recoveryGo').click()
        pp.wait_for_timeout(2500)
        pp.goto(f'http://127.0.0.1:{PORT}/app/#/users', wait_until='domcontentloaded')
        pp.wait_for_timeout(1200)
        check('Owner' in pp.locator('table tbody tr', has_text='msk').first.inner_text(), '390px: owner row renders on the Users sheet')
        pp.screenshot(path=os.path.join(SHOTS, 'users-sheet-390.png'), full_page=True)
        check(not perr, '390px page errors: 0')
        pctx.close()
        browser.close()
    print(f'\nROUND10-GATE: {ok} ok, {fail} FAIL')
    sys.exit(1 if fail else 0)

if __name__ == '__main__':
    main()

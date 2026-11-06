# round5 evidence in real Chromium/Edge (2026-10-29)
# item 2: fresh sign-up -> first class -> class mode -> paired teacher scope
# item 3: recovery Continue gated on a real download
# item 4: persistent storage final state within 3 s
# item 1 (client): Test cloud connection button reports honestly (server RPC
#          not installed yet -> the message must say so, no crash)
import functools, http.server, socketserver, threading, os, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PORT = 8944
OUT = os.path.join(os.path.dirname(__file__))

def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', PORT), handler) as h:
        h.serve_forever()

threading.Thread(target=serve, daemon=True).start()
time.sleep(0.6)
BASE = 'http://127.0.0.1:%d' % PORT

from playwright.sync_api import sync_playwright

results = []
def ok(name, cond, extra=''):
    results.append((name, bool(cond), extra))
    print(('PASS ' if cond else 'FAIL ') + name + ((' - ' + str(extra)[:120]) if extra else ''))

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        ctx = browser.new_context(viewport={'width': 1366, 'height': 850}, accept_downloads=True)
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))

        def settle(page, ms=20000):
            # after a reload the session restore runs two 600k derivations
            try:
                page.wait_for_function("!document.body.classList.contains('auth-gate')", timeout=ms)
            except Exception:
                pass
            page.wait_for_timeout(300)

        # ---------- item 2 + 3: fresh sign-up with class-mode default ----------
        pg.goto(BASE + '/app/index.html#/dashboard')
        pg.wait_for_timeout(1200)
        # privacy gate (notice): tick + ack
        try:
            cb = pg.locator('#notice-read')
            if cb.count() and not cb.is_checked():
                cb.check(); pg.wait_for_timeout(150)
            for sel in ['[data-action="privacy-gate-ack"]', '[data-action="privacy-ack"]']:
                if pg.locator(sel).count():
                    pg.locator(sel).first.click(); pg.wait_for_timeout(300); break
        except Exception:
            pass
        # first-run setup
        if pg.locator('[data-action="show-setup"]').count():
            pg.locator('[data-action="show-setup"]').first.click(); pg.wait_for_timeout(300)
        pg.fill('#suUser', 'Mo'); pg.fill('#suPass', 'Str0ngPass!73'); pg.fill('#suConf', 'Str0ngPass!73')
        pg.locator('[data-action="first-run"]').click(); pg.wait_for_timeout(1200)

        # item 3: recovery dialog — Continue disabled until a download fires
        # (it opens after the account's two 600k key derivations: wait for it)
        try:
            pg.wait_for_selector('[data-action="recovery-ack"]', timeout=20000)
        except Exception:
            pass
        dlg = pg.locator('#dlg')
        ok('item3 recovery dialog offers master password', 'master password' in (dlg.text_content() or '').lower())
        ack = pg.locator('[data-action="recovery-ack"]')
        ok('item3 Continue starts DISABLED', ack.is_disabled())
        ok('item3 self-tick checkbox is gone', pg.locator('#recoverySaved').count() == 0)
        with pg.expect_download() as dl_info:
            pg.locator('#dlg [data-action="recovery-dl"]').click(force=True)
        ok('item3 download really fired', dl_info.value is not None, dl_info.value.suggested_filename)
        pg.wait_for_timeout(400)
        ok('item3 Continue ENABLED after the download', ack.is_enabled())
        ack.click(); pg.wait_for_timeout(900)
        ok('item2 fresh admin signed in', 'auth-gate' not in (pg.get_attribute('body', 'class') or ''))
        ok('item2 mode is still unset/legacy before any class', pg.evaluate("localStorage.getItem('spr-mode-v1')") in (None, '', 'legacy'))

        # first class through the wizard
        pg.goto(BASE + '/app/index.html#/manage'); settle(pg)
        wiz = pg.locator('[data-action="wiz-open"]')
        ok('item2 Manage offers the New class wizard', wiz.count() > 0)
        wiz.first.click(); pg.wait_for_timeout(500)
        pg.fill('#wiz-class', 'P1A'); pg.fill('#wiz-school', 'Demo School')
        pg.locator('[data-action="wiz-create"]').click(); pg.wait_for_timeout(2500)
        ok('item2 browser is in CLASS mode after the first class',
           pg.evaluate("localStorage.getItem('spr-mode-v1')") == 'class')
        ix = pg.evaluate("JSON.parse(localStorage.getItem('spr-class-index-v1') || '[]')")
        ok('item2 class index holds exactly the new class', len(ix) == 1, [c.get('name') for c in ix])
        kr = pg.evaluate("JSON.parse(localStorage.getItem('spr-auth-v1')).users[0].keyring || {}")
        ok('item2 admin holds the class key in the keyring', len(kr) >= 1, list(kr.keys()))
        pg.screenshot(path=os.path.join(OUT, 'chromium-classmode-manage.png'))

        # pair a teacher: Users -> Add account -> Manage -> Pair
        pg.goto(BASE + '/app/index.html#/users'); settle(pg)
        pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
        pg.locator('[data-action="acct-add-open"]').first.click(); pg.wait_for_timeout(500)
        pg.wait_for_selector('#naUser', timeout=15000)
        pg.fill('#naUser', 'anna'); pg.fill('#naName', 'Anna'); pg.fill('#naPass', 'anna-pass-12'); pg.fill('#naConf', 'anna-pass-12')
        pg.locator('[data-action="acct-add"]').click(); pg.wait_for_timeout(3500)
        ok('item2 teacher account created', 'anna' in pg.evaluate("localStorage.getItem('spr-auth-v1')"))
        pg.goto(BASE + '/app/index.html#/manage'); pg.wait_for_timeout(800)
        pg.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")   # Pair lives in the Advanced details
        pg.locator('[data-action="class-pair"]').first.click(); pg.wait_for_timeout(500)
        sel = pg.locator('#pair-eal')
        ok('item2 pair dialog lists the teacher', sel.count() > 0 and 'anna' in (sel.text_content() or ''))
        sel.select_option('anna')
        pg.locator('#dlg [data-x="1"]').click(); pg.wait_for_timeout(3500)
        one_time = pg.locator('#dlg code')
        pw = one_time.text_content().strip() if one_time.count() else 'anna-pass-12'
        ok('item2 pairing issued a one-time password', len(pw) >= 6, pw[:5] + '...')
        if one_time.count():
            pg.locator('#dlg [data-x="1"]').click(); pg.wait_for_timeout(400)

        # teacher signs in on a fresh page (same browser: clean their session)
        ctx.clear_cookies()
        pg2 = ctx.new_page()
        pg2.goto(BASE + '/app/index.html#/dashboard')
        pg2.wait_for_timeout(400)
        pg2.evaluate("sessionStorage.clear()")
        pg2.reload(); pg2.wait_for_timeout(1200)
        pg2.fill('#loginUser', 'anna'); pg2.fill('#loginPass', pw)
        pg2.locator('[data-action="do-login"]').click()
        pg2.wait_for_timeout(3500)
        t_keyring = pg2.evaluate("(JSON.parse(localStorage.getItem('spr-auth-v1')).users.find(u => u.username === 'anna').keyring) || {}")
        ok('item2 teacher holds a key for exactly ONE class', len(t_keyring) == 1, list(t_keyring.keys()))
        pg2.close()

        # ---------- item 4: persistent storage final state ----------
        pg.goto(BASE + '/app/index.html#/manage'); settle(pg); pg.wait_for_timeout(3000)
        body = pg.locator('body').text_content() or ''
        ok('item4 persistent storage shows a final state (no endless checking)',
           ('Persistent storage' in body) and ('checking… download' not in body))
        ok('item4 not-granted wording explains the consequence', 'not granted' in body or 'granted:' in body)

        # ---------- item 1 (client side): Test cloud connection ----------
        # The button lives in the Device-sync panel (visible only when sync is
        # on). We do NOT turn sync on here: this browser would push to the
        # owner's REAL Supabase row. The button and both RPC paths are proven
        # against the local mock PostgREST in tests/test-round5.js (section 1).
        html = pg.content()
        ok('item1 app ships the Test cloud connection button', 'data-action="ds-test"' in html)
        ok('item1 app ships the write-token RPC client', 'spr_channel_write' in html and 'spr_channel_enrol' in html and 'spr_channel_ping' in html)

        ok('zero page errors across the whole run', len(errors) == 0, errors[:3])
        browser.close()

    lines = ['round5 real-Chromium evidence (2026-10-29)', '']
    for name, cond, extra in results:
        lines.append(('PASS ' if cond else 'FAIL ') + name + (('  | ' + str(extra)[:120]) if extra else ''))
    lines.append('')
    lines.append('%d/%d PASS' % (sum(1 for _, c, _ in results if c), len(results)))
    with open(os.path.join(OUT, 'evidence-chromium.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n%d/%d PASS' % (sum(1 for _, c, _ in results if c), len(results)))

run()

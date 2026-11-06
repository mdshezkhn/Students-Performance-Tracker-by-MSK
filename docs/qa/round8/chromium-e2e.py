#!/usr/bin/env python3
"""round8 gate (e): real Chromium end-to-end, Supabase mocked at the network
layer (no production cloud is touched). Edge/Chromium via Playwright.

Flow: sign up -> create a class -> add a teacher -> pair (capture the issued
one-time password) -> teacher signs in on a second browser via the explicit
cloud lookup and sees ONLY their class -> admin resets the teacher password ->
a fresh browser signs in with the new password -> admin deletes the teacher ->
a third browser is rejected. Success = all checks pass AND 0 page errors.
"""
import json, subprocess, sys, time, threading, http.server, socketserver, functools, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
APP = 'http://127.0.0.1:8934/app/index.html'
PORT = 8934

# ---------------- in-memory Supabase (shared by every context) ----------------
ROWS = {}
def sb_route(route):
    req = route.request
    url = req.url
    method = req.method
    body = req.post_data or ''
    import re as _re
    m = _re.search(r'/rest/v1/([a-z_]+)(?:\?id=eq\.([0-9a-f\-]+))?', url)
    table, row_id = (m.group(1), m.group(2)) if m else (None, None)
    def H(status, body_json=None):
        return route.fulfill(status=status, content_type='application/json',
                             body=json.dumps(body_json) if body_json is not None else '')
    if table == 'rpc':       # SQL not "run" in this mock: client falls back to direct writes
        return H(404, {'message': 'rpc-missing'})
    if table != 'spr_channels':
        return H(200, [])
    if method == 'GET':
        if row_id and row_id in ROWS:
            return H(200, [ROWS[row_id]])
        return H(200, [])
    if method == 'POST':
        b = json.loads(body or '{}')
        if b.get('id') in ROWS:
            return H(409, {'message': 'exists'})
        ROWS[b['id']] = b
        return H(201, {})
    if method == 'PATCH':
        if not row_id or row_id not in ROWS:
            return H(404, {})
        b = json.loads(body or '{}')
        ROWS[row_id].update(b)
        return H(204)
    if method == 'DELETE':
        ROWS.pop(row_id, None)
        return H(204)
    return H(400, {})

# ---------------- tiny local file server ----------------
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Q, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

CHECKS, FAILED, PAGE_ERRORS = [], [], []
def check(cond, name):
    CHECKS.append((bool(cond), name))
    print(('  ok: ' if cond else '  FAIL: ') + name)
    if not cond: FAILED.append(name)

def poll(page, js, timeout=45000, step=300):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if page.evaluate(js): return True
        except Exception: pass
        page.wait_for_timeout(step)
    try: return bool(page.evaluate(js))
    except Exception: return False

def new_page(ctx, name):
    page = ctx.new_page()
    page.on('pageerror', lambda e: PAGE_ERRORS.append(f'{name}: {e}'))
    page.route('**/rest/v1/**', sb_route)
    page.goto(APP)
    return page

def click(page, sel, timeout=15000):
    page.locator(sel).first.click(timeout=timeout)

def fill(page, sel, val):
    loc = page.locator(sel).first
    loc.fill(val)

def dlg_text(page):
    return page.evaluate("() => (document.getElementById('dlg')||{}).textContent || ''")

def ack_privacy(page):
    page.wait_for_timeout(400)
    for _ in range(6):
        if page.locator('[data-action="privacy-ack"]').count():
            click(page, '[data-action="privacy-ack"]'); page.wait_for_timeout(500)
        else: break

def sign_in_lookup(page, user, pw, expect_ok=True):
    """the explicit 'I use SPR on another device' flow"""
    click(page, '[data-action="login-other-device"]')
    page.wait_for_timeout(400)
    fill(page, '#odUser', user); fill(page, '#odPass', pw)
    click(page, '#dlg [data-x="1"]')
    ok = poll(page, "() => /Open the cloud copy here/.test((document.getElementById('dlg')||{}).textContent||'')", 60000)
    if ok:
        click(page, '#dlg .dlg-actions [data-x="1"]')
        ok = poll(page, "() => !document.body.classList.contains('auth-gate')", 90000)
        ack_privacy(page)
    return ok

ADMIN, TEA = 'mo-e2e', 'tea-e2e'
PW0, PW2 = 'e2e-admin-pass-1', 'e2e-teacher-pass-2'

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    ctxA = browser.new_context(); ctxB = browser.new_context(); ctxC = browser.new_context(); ctxD = browser.new_context()

    # ---------- browser A: the owner ----------
    A = new_page(ctxA, 'A')
    page = A
    poll(page, "() => !!document.getElementById('dlg') && document.getElementById('dlg').open", 20000)
    click(page, '[data-action="show-setup"]'); page.wait_for_timeout(300)
    fill(page, '#suUser', ADMIN); fill(page, '#suPass', PW0); fill(page, '#suConf', PW0)
    click(page, '[data-action="first-run"]')
    poll(page, "() => !!document.querySelector('[data-action=\"recovery-master\"]')", 60000)
    fill(page, '#mrPw', 'e2e-master-pass'); click(page, '[data-action="recovery-master"]')
    poll(page, "() => { const b=document.querySelector('[data-action=\"recovery-ack\"]'); return b && !b.disabled; }", 30000)
    click(page, '[data-action="recovery-ack"]')
    check(poll(page, "() => !document.body.classList.contains('auth-gate')", 60000), 'A: owner account created (setup + recovery path)')
    ack_privacy(page)

    # ---------- create a class ----------
    page.goto(APP + '#/classes'); page.wait_for_timeout(600)
    poll(page, "() => !!document.querySelector('[data-action=\"class-new-open\"]')", 30000)
    click(page, '[data-action="class-new-open"]')
    poll(page, "() => !!document.getElementById('cn-name')", 15000)
    fill(page, '#cn-school', 'ZhongFangYuan'); fill(page, '#cn-name', 'P4C4')
    click(page, '#dlg [data-x="1"]')
    check(poll(page, "() => (document.body.textContent||'').includes('P4C4')", 60000), 'A: class P4C4 created')

    # ---------- add a teacher ----------
    page.goto(APP + '#/manage'); page.wait_for_timeout(500)
    poll(page, "() => !!document.querySelector('[data-action=\"acct-add-open\"]')", 30000)
    click(page, '[data-action="acct-add-open"]')
    poll(page, "() => !!document.getElementById('naUser')", 15000)
    fill(page, '#naUser', TEA); fill(page, '#naName', 'Teacher E2E')
    fill(page, '#naPass', 'e2e-teacher-pass-1'); fill(page, '#naConf', 'e2e-teacher-pass-1')
    click(page, '[data-action="acct-add"]')
    check(poll(page, f"() => (localStorage.getItem('spr-auth-v1')||'').includes('{TEA}')", 60000), 'A: teacher sign-in created')

    # ---------- pair the teacher with the class (issues a fresh one-time password) ----------
    page.goto(APP + '#/classes'); page.wait_for_timeout(600)
    poll(page, "() => !!document.querySelector('[data-action=\"class-pair\"]')", 30000)
    click(page, '[data-action="class-pair"]')
    poll(page, "() => !!document.getElementById('pair-eal')", 15000)
    page.select_option('#pair-eal', TEA)
    click(page, '#dlg [data-x="1"]')
    check(poll(page, "() => /shown once/.test((document.getElementById('dlg')||{}).textContent||'')", 60000), 'A: pairing issued the one-time password dialog')
    tea_pw = page.evaluate("() => { const d=document.getElementById('dlg'); const code=d?d.querySelector('code'):null; return code?code.textContent:''; }")
    check(bool(tea_pw), 'A: captured the issued teacher password')
    click(page, '#dlg [data-x="1"]')  # close the once-dialog (OK button)

    # ---------- browser B: the teacher signs in via the cloud lookup ----------
    B = new_page(ctxB, 'B')
    poll(B, "() => !!document.getElementById('dlg') && document.getElementById('dlg').open", 20000)
    b_in = sign_in_lookup(B, TEA, tea_pw)
    check(b_in, 'B: teacher signed in on a second browser via the cloud lookup')
    B.goto(APP + '#/classes'); B.wait_for_timeout(800)
    check(poll(B, "() => (document.body.textContent||'').includes('P4C4')", 60000), 'B: teacher sees the paired class')
    B.goto(APP + '#/dashboard'); B.wait_for_timeout(600)
    sees_only = B.evaluate("() => ({ users: !!document.querySelector('a[data-nav=\"users\"]'), manage: !!document.querySelector('a[data-nav=\"manage\"]'), ranking: !!document.querySelector('a[data-nav=\"ranking\"]') })")
    check(not sees_only['users'] and not sees_only['manage'], 'B: teacher does NOT see Users/Manage (only their own class surface)')

    # ---------- A resets the teacher password ----------
    page.goto(APP + '#/manage'); page.wait_for_timeout(600)
    poll(page, f"() => !!document.querySelector('[data-action=\"acct-reset-open\"][data-user=\"{TEA}\"]')", 30000)
    click(page, f'[data-action="acct-reset-open"][data-user="{TEA}"]')
    poll(page, "() => !!document.getElementById('rpPass')", 15000)
    fill(page, '#rpPass', PW2); fill(page, '#rpConf', PW2)
    click(page, '[data-action="acct-reset"]')
    page.wait_for_timeout(1000)
    check(poll(page, "() => !document.getElementById('dlg').open", 60000), 'A: password reset saved')

    # ---------- browser C: fresh browser signs in with the NEW password ----------
    C = new_page(ctxC, 'C')
    poll(C, "() => !!document.getElementById('dlg') && document.getElementById('dlg').open", 20000)
    c_in = sign_in_lookup(C, TEA, PW2)
    check(c_in, 'C: fresh browser bootstrapped with the RESET password')

    # ---------- A deletes the teacher ----------
    page.goto(APP + '#/manage'); page.wait_for_timeout(600)
    poll(page, f"() => !!document.querySelector('[data-action=\"acct-del\"][data-user=\"{TEA}\"]')", 30000)
    click(page, f'[data-action="acct-del"][data-user="{TEA}"]')
    page.wait_for_timeout(400)
    click(page, '#dlg [data-x="1"]')   # confirm removal
    check(poll(page, f"() => !(localStorage.getItem('spr-auth-v1')||'').includes('\"username\":\"{TEA}\"')", 60000), 'A: teacher deleted locally')
    check(poll(page, f"() => {{ const gone=JSON.parse(localStorage.getItem('spr-ds-gone-v1')||'[]'); return gone.indexOf('{TEA}')>=0; }}", 60000), 'A: deletion tombstone recorded')

    # ---------- browser D: the deleted teacher cannot sign in anywhere ----------
    D = new_page(ctxD, 'D')
    poll(D, "() => !!document.getElementById('dlg') && document.getElementById('dlg').open", 20000)
    click(D, '[data-action="login-other-device"]'); D.wait_for_timeout(400)
    fill(D, '#odUser', TEA); fill(D, '#odPass', PW2)
    click(D, '#dlg [data-x="1"]')
    rejected = poll(D, "() => /No cloud copy|Wrong password/.test((document.getElementById('odErr')||{}).textContent||'')", 60000)
    check(rejected, 'D: deleted teacher cannot sign in on a third browser')

    browser.close()

httpd.shutdown()
print()
print(f'{len(CHECKS)-len(FAILED)}/{len(CHECKS)} checks passed; page errors: {len(PAGE_ERRORS)}')
for e in PAGE_ERRORS: print('  PAGE ERROR:', e)
sys.exit(1 if FAILED or PAGE_ERRORS else 0)

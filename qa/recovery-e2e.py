"""E2E for the built-in MSK recovery account (2026-11-02, owner request).
Runs against the PUBLISHED repo root over local http (secure context -> real
WebCrypto, exactly like production). Throwaway profiles only: device sync is
off in a fresh browser, so nothing ever touches the cloud.
NOTE: PBKDF2 wraps cost 600k iterations x2-3 per login/creation -> every wait
is conditional with generous timeouts (weak-school-laptop realism)."""
import threading, http.server, socketserver, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8971
results = []
def check(name, ok, extra=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (("  | " + str(extra)) if extra else ""), flush=True)

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(ROOT), **kw)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
PASS = "ZhongFangYuan786$"
def wait_signed_in(pg, timeout_ms=90000):
    """login card removed AND the auth-gate body class dropped (CSP-safe: no eval)"""
    pg.wait_for_selector("#loginUser", state="hidden", timeout=timeout_ms)
    for _ in range(40):
        if not pg.evaluate("document.body.classList.contains('auth-gate')"):
            return
        pg.wait_for_timeout(250)
    raise TimeoutError("auth-gate class never dropped")

def wait_signed_out(pg, timeout_ms=30000):
    pg.wait_for_selector("#loginUser", state="visible", timeout=timeout_ms)

def boot(pg):
    pg.goto(BASE + "/app/", wait_until="domcontentloaded")
    try:
        cb = pg.wait_for_selector("#notice-read", timeout=6000)
        cb.check()
        pg.click('button:has-text("I understand")')
    except Exception:
        pass  # notice already accepted in this profile
    pg.wait_for_selector("#loginUser", timeout=20000)

def sign_in(pg, u, p):
    pg.fill("#loginUser", u); pg.fill("#loginPass", p)
    pg.click('[data-action="do-login"]')

def users(pg):
    return pg.evaluate("JSON.parse(localStorage.getItem('spr-auth-v1')||'{}').users||[]")

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="msedge", headless=True)

    # ---- A: fresh device -> MSK + recovery password self-creates admin ----
    ctx = b.new_context()
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:150]))
    boot(pg)
    sign_in(pg, "MSK", PASS)
    try:
        wait_signed_in(pg)
        check("A1 fresh device: MSK recovery login opens the app", True)
    except Exception:
        check("A1 fresh device: MSK recovery login opens the app", False, pg.evaluate("(document.getElementById('loginErr')||{}).textContent"))
    us = users(pg)
    check("A2 account created as admin MSK", len(us) == 1 and us[0]["username"] == "MSK" and us[0]["role"] == "admin", us and [u.get("username") for u in us])
    check("A3 privacy toast shown", pg.evaluate("document.body.textContent.includes('built-in MSK account')"))
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_timeout(8000)
    check("A4 session survives reload", pg.evaluate("document.getElementById('loginUser') === null"))
    pg.evaluate("try { sessionStorage.removeItem('spr-session'); } catch (e) {}")
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_selector("#loginUser", timeout=20000)
    sign_in(pg, "MSK", PASS)
    try:
        wait_signed_in(pg)
        check("A5 sign-out then MSK sign-in again works", True)
    except Exception:
        check("A5 sign-out then MSK sign-in again works", False)
    check("A6 no page errors (recovery flow)", not errs, errs[:1])
    ctx.close()

    # ---- B: device WITH an account must NEVER self-create MSK ----
    ctx2 = b.new_context()
    p2 = ctx2.new_page()
    boot(p2)
    p2.click('[data-action="show-setup"]')
    p2.wait_for_selector("#suUser", timeout=10000)
    p2.fill("#suUser", "mo"); p2.fill("#suPass", "mopass123"); p2.fill("#suConf", "mopass123")
    p2.click('[data-action="first-run"]')
    try:
        # item-4 policy: every new admin must set a recovery path before the gate drops
        p2.wait_for_selector("#mrPw", timeout=90000)
        p2.fill("#mrPw", "mopass-master-9")
        p2.click('[data-action="recovery-master"]')
        p2.wait_for_timeout(2500)
        p2.click('[data-action="recovery-ack"]')
        wait_signed_in(p2)
        check("B1 control setup (mo) works", True)
    except Exception:
        check("B1 control setup (mo) works", False, p2.evaluate("(document.getElementById('suErr')||document.getElementById('mrErr')||{}).textContent"))
    p2.evaluate("try { sessionStorage.removeItem('spr-session'); } catch (e) {}")
    p2.reload(wait_until="domcontentloaded")
    p2.wait_for_selector("#loginUser", timeout=20000)
    sign_in(p2, "MSK", PASS)
    p2.wait_for_timeout(3000)
    err = p2.evaluate("(document.getElementById('loginErr')||{}).textContent || ''")
    check("B2 existing device: recovery login rejected", "Invalid username or password" in err, err[:70])
    us2 = users(p2)
    check("B3 no MSK account was created", len(us2) == 1 and us2[0]["username"] == "mo")
    sign_in(p2, "mo", "mopass123")
    try:
        wait_signed_in(p2)
        check("B4 original account + data intact", True)
    except Exception:
        check("B4 original account + data intact", False)
    ctx2.close()

    # ---- C: fresh device + WRONG password = no creation, honest error ----
    ctx3 = b.new_context()
    p3 = ctx3.new_page()
    boot(p3)
    sign_in(p3, "MSK", "wrong-password-1")
    p3.wait_for_timeout(2500)
    errc = p3.evaluate("(document.getElementById('loginErr')||{}).textContent || ''")
    us3 = users(p3)
    check("C1 wrong password creates nothing", len(us3) == 0 and errc != "", errc[:70])
    ctx3.close()
    b.close()

httpd.shutdown()
fails = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(fails)}/{len(results)} recovery E2E checks passed" + ("" if not fails else " - FAILED: " + ", ".join(fails)))
sys.exit(1 if fails else 0)

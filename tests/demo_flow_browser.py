"""Demo-mode browser e2e (overnight 2026-11-15).

Serves the REAL built bundle (app/index.html) over plain HTTP and walks the
Monday demo story in a real msedge headless browser:
  1. login card offers "Try the demo classes"
  2. install with a chosen password -> signed in as fet-demo, 2 demo classes
  3. open P4-A Demo -> real student list, real grades (calc engine output)
  4. reload -> session + demo data persist
  5. sign out -> sign in as cet-demo (same password) -> class opens, students visible
  6. banner is present all along; "Remove demo data" wipes everything cleanly
SYNTHETIC DATA ONLY. Run: C:\\Python314\\python.exe tests/demo_flow_browser.py
"""
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8891
BASE = __import__("os").environ.get("LIVE_BASE") or f"http://127.0.0.1:{PORT}"
PW = "demo-Monday-2026"


def safe_reload(page, tries=3):
    for i in range(tries):
        try:
            page.reload(); return True
        except Exception:
            page.wait_for_timeout(2500)
    return False

def safe_goto(page, url, tries=3):
    for i in range(tries):
        try:
            page.goto(url); return True
        except Exception:
            page.wait_for_timeout(2500)
    return False

results = []
def ok(cond, label, evidence=""):
    results.append((bool(cond), label))
    print(("  ok: " if cond else "  FAIL: ") + label + (("  [" + str(evidence) + "]") if (evidence and not cond) else ""))

if __import__("os").environ.get("LIVE_BASE"):
    server = None
else:
    server = subprocess.Popen(
        [r"C:\Python314\python.exe", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", ROOT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    if not __import__("os").environ.get("LIVE_BASE"):
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "/app/index.html", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        else:
            print("server did not start"); sys.exit(2)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors = []
        cloud_hits = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        def _watch(r):
            if "supabase" in r.url or ("pages.dev" in r.url and str(PORT) not in r.url and "spr-school-demo" not in r.url):
                cloud_hits.append(r.url)
        page.on("request", _watch)
        page.goto(BASE + ("/app/" if "127.0.0.1" in BASE else "/"))
        page.evaluate("navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister())))")
        page.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))")
        safe_reload(page)
        page.wait_for_timeout(1500)

        # 1. after the gate, the sign-in dialog offers the demo entry
        page.wait_for_selector("text=Try the demo classes", timeout=15000)
        # the privacy notice dialog overlays the screen until acknowledged:
        # tick the "I have read" checkbox, then the I-understand button enables
        for attempt in range(4):
            try:
                page.wait_for_selector("#dlg", state="visible", timeout=3000)
                if page.locator("#dlg #notice-read").count():
                    page.check("#dlg #notice-read")
                    page.wait_for_timeout(200)
                page.click("#dlg [data-action=privacy-gate-ack]")
                page.wait_for_timeout(600)
                if page.locator("#dlg[open]").count() == 0:
                    break
            except Exception:
                page.wait_for_timeout(700)
        ok(page.locator("#dlg #notice-ack-btn").count() == 0, "privacy notice acknowledged, gate closed")
        ok(page.locator("text=Try the demo classes").count() > 0, "welcome screen offers the demo classes")

        # 2. install: the login dialog (open over the welcome page) hosts the link
        target = "#dlg [data-action=demo-open]" if page.locator("#dlg [data-action=demo-open]").count() else "[data-action=demo-open]"
        page.click(target)
        page.wait_for_selector("#demoPw1", timeout=5000)
        page.fill("#demoPw1", PW)
        page.fill("#demoPw2", PW)
        page.click("[data-action=demo-install]")
        # install runs several seconds of key-wrapping crypto: the banner only
        # appears once seeding, sign-in and routing are all DONE
        page.wait_for_selector("#demo-banner", timeout=40000)
        page.wait_for_timeout(800)
        app = page.locator("#app")
        ok(app.locator("text=P4-A Demo").count() > 0, "P4-A Demo appears after install")
        ok(app.locator("text=P4-B Demo").count() > 0, "P4-B Demo appears after install")
        ok(page.locator("#demo-banner").count() == 1, "demo banner is visible")
        ok("Demo FET" in app.inner_text(), "signed in as the demo FET")

        # 3. open the class via its Open button, check the roster
        page.wait_for_selector("[data-action=class-open]", timeout=8000)
        page.locator("[data-action=class-open]").first.click()
        page.wait_for_timeout(1800)
        ok(page.evaluate("() => location.hash") == "#/dashboard", "class opened (dashboard route)")
        safe_goto(page, BASE + ("/app/#/students" if "127.0.0.1" in BASE else "/#/students")); page.wait_for_timeout(1500)
        ok(page.locator("#app >> text=Demo Student 08").count() > 0, "students view lists demo roster (Student 08)")
        ok(page.locator("#app >> text=Demo Student 15").count() > 0, "students view lists demo roster (Student 15)")

        # 4. reload persistence
        safe_reload(page); page.wait_for_timeout(1800)
        body = page.locator("#app").inner_text() + page.locator("body").inner_text()
        ok("Demo FET" in body or "P4-A Demo" in body or "Demo Student" in body, "after reload: session or class data persists")
        ok(page.locator("#demo-banner").count() == 1, "banner persists after reload")

        # 5. cet-demo side
        page.evaluate("document.querySelector('#demo-banner') && 1")
        # sign out via localStorage-clean reload (UI-agnostic): use the app's logout button if present
        # sign out through the app's real Sign out button (reload follows)
        page.wait_for_selector("[data-action=logout]", timeout=8000)
        page.click("[data-action=logout]")
        page.wait_for_timeout(3500)   # doLogout() reloads the app
        page.wait_for_selector("#loginUser", timeout=15000)
        page.fill("#loginUser", "cet-demo")
        page.fill("#loginPass", PW)
        page.click("[data-action=do-login]")
        page.wait_for_timeout(2500)
        page.wait_for_timeout(1500)
        body = page.locator("#app").inner_text()
        ok("Demo CET" in body or "cet-demo" in body, "cet-demo can sign in with the demo password")
        ok("P4-A Demo" in body, "cet-demo sees the demo classes")

        # 6. remove demo data (the login dialog may be open over the banner)
        page.evaluate("() => { const d = document.getElementById('dlg'); if (d && d.open) d.close(); }")
        page.wait_for_timeout(300)
        page.click("#demo-banner button")
        page.wait_for_timeout(600)
        # confirm dialog (the app's confirmDlg primary button)
        try:
            page.click("text=Remove demo", timeout=3000)
        except Exception:
            pass
        page.wait_for_timeout(2500)
        flag = page.evaluate("() => localStorage.getItem('spr-demo-v1')")
        ix = page.evaluate("() => localStorage.getItem('spr-class-index-v1') || ''")
        ok(flag is None, "demo flag cleared (got " + str(flag) + ")")
        ok("demo-p4a" not in str(ix), "demo classes removed from the class index")
        ok(page.locator("#demo-banner").count() == 0, "banner gone after removal")

        ok(len([e for e in errors if "ResizeObserver" not in e]) == 0, "no page errors (" + str(len(errors)) + " raw)")
        ok(len(cloud_hits) == 0, "demo flow made ZERO cloud requests (" + str(len(cloud_hits)) + " seen)")
        # mobile viewport: the classes view must not scroll sideways
        page.set_viewport_size({"width": 390, "height": 844})
        safe_goto(page, BASE + ("/app/#/classes" if "127.0.0.1" in BASE else "/#/classes")); page.wait_for_timeout(1200)
        sw = page.evaluate("() => document.documentElement.scrollWidth")
        ok(sw <= 392, "no horizontal overflow at 390px (scrollWidth " + str(sw) + ")")
        browser.close()

    fails = [r for r in results if not r[0]]
    print("\nDEMO-FLOW: %d ok, %d FAIL" % (len(results) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)
finally:
    if server: server.terminate()

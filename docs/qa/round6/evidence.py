# round6 item 3 evidence in real Chromium/Edge (2026-10-29)
# Reviewer repro: "Persistent storage: checking..." never resolves in headless
# Chromium on localhost (Manage page, class mode). This run repeats EXACTLY
# that: fresh sign-up -> first class (class mode) -> Manage, and measures the
# time until the line shows a FINAL state. Repeats it 3 times.
import json, os, sys, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8933"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.dirname(os.path.abspath(__file__))
results, errors = [], []
ok = lambda label, cond: (results.append((label, bool(cond))), print(("PASS " if cond else "FAIL ") + label))[0]

import http.server, functools, threading
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
http.server.SimpleHTTPRequestHandler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8933), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)
    for attempt in range(3):
        ctx = browser.new_context()
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        pg.goto(BASE + "/app/index.html#/dashboard"); pg.wait_for_timeout(1000)
        # notice gate (if present): tick + ack
        cb = pg.locator("#notice-read")
        if cb.count():
            cb.check(); pg.wait_for_timeout(150)
            gate_btn = pg.locator('[data-action="privacy-gate-ack"], [data-action="privacy-ack"]')
            if gate_btn.count(): gate_btn.first.click()
        pg.wait_for_timeout(400)
        # fresh sign-up
        if pg.locator('[data-action="show-setup"]').count():
            pg.locator('[data-action="show-setup"]').first.click(); pg.wait_for_timeout(300)
        pg.fill("#suUser", "Mo"); pg.fill("#suPass", "chromium-pass-1"); pg.fill("#suConf", "chromium-pass-1")
        pg.locator('[data-action="first-run"]').click(); pg.wait_for_timeout(1500)
        # mandatory recovery dialog: take the master-password route
        pg.wait_for_selector("#dlg", timeout=15000)
        pg.fill("#mrPw", "Master-K3y!9x"); pg.wait_for_timeout(200)
        pg.locator('#dlg [data-action="recovery-master"]').click(force=True)
        pg.wait_for_selector('#dlg [data-action="recovery-ack"]', timeout=20000)
        pg.locator('#dlg [data-action="recovery-ack"]').click(); pg.wait_for_timeout(800)
        ok(f"run{attempt}: signed up (recovery path set)", pg.evaluate("!document.body.classList.contains('auth-gate')"))
        # create the FIRST class straight from the welcome screen (empty DB)
        pg.locator('[data-action="wiz-open"]').first.click(); pg.wait_for_timeout(400)
        pg.locator('[data-action="wiz-create"]').click(); pg.wait_for_timeout(1800)
        mode = pg.evaluate("localStorage.getItem('spr-mode-v1')")
        ok(f"run{attempt}: class mode after first class", mode == "class")
        # THE MEASUREMENT: Manage, persistent-storage line must be FINAL within 3 s
        pg.goto(BASE + "/app/index.html#/manage"); pg.wait_for_timeout(300)
        t0 = time.time(); final = None
        while time.time() - t0 < 6.0:
            m = pg.evaluate("(function(){var c=document.querySelector('#content');if(!c)return '';var t=c.textContent||'';var k=t.indexOf('Persistent storage');if(k<0)return '';var rest=t.slice(k+19);var dot=rest.search(/[.]/);return dot<0?rest:rest.slice(0,dot);})()")
            if m and "checking" not in m:
                final = (m.strip(), round(time.time() - t0, 2)); break
            pg.wait_for_timeout(150)
        ok(f"run{attempt}: persistent-storage line resolves ({final})", final is not None and final[0] != "")
        ok(f"run{attempt}: resolved within 3 s", final is not None and final[1] <= 3.0)
        ctx.close()
    browser.close()
srv.shutdown()
passed = sum(1 for _, c in results if c)
with open(os.path.join(OUT, "evidence-chromium.txt"), "w", encoding="utf-8") as f:
    f.write("round6 item 3 — headless Edge (channel=msedge), 3 fresh runs\n")
    for label, c in results: f.write(("PASS " if c else "FAIL ") + label + "\n")
    f.write(f"page errors: {len(errors)}\n")
    for e in errors[:5]: f.write("  " + e + "\n")
    f.write(f"\n{passed}/{len(results)} PASS\n")
print(f"\n{passed}/{len(results)} PASS | page errors: {len(errors)}")

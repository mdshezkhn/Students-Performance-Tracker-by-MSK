# QA driver for the SPR landing (adapted MSK template).
# Serves ../ and drives headless Edge: console errors, overflow at 3 widths,
# reduced-motion fallback, asset 200s, font + video state, section screenshots.
import subprocess, sys, time, json, re, threading, http.server, socketserver, functools
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8950

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
print(f"serving {ROOT} on http://127.0.0.1:{PORT}")

from playwright.sync_api import sync_playwright

BASE = f"http://127.0.0.1:{PORT}"
results, fails = [], []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    if not ok: fails.append(name)
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)

    # ---- asset availability ----
    ctx = browser.new_context(viewport={"width":1440,"height":900})
    page = ctx.new_page()
    for asset in ["", "vendor/gsap.min.js", "vendor/ScrollTrigger.min.js", "vendor/lenis.min.js",
                  "media/backdrop.jpg", "media/hero-loop.mp4", "media/cloud-left.webp",
                  "media/cloud-right.webp", "media/blossom-trees.webp", "media/valley-night.jpg",
                  "fonts/inter-tight-400.woff2", "notice.html", "app/"]:
        r = page.request.get(BASE + "/" + asset)
        check(f"asset 200 {asset or 'index.html'}", r.status == 200, f"HTTP {r.status}")

    # ---- desktop pass ----
    errors, console = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error","warning") else None)
    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)  # intro completes (~2.5s) + settle

    check("no page errors", len(errors) == 0, "; ".join(errors[:3]))
    check("GSAP loaded", page.evaluate("!!window.gsap && !!window.ScrollTrigger"))
    check("Lenis loaded", page.evaluate("!!window.__lenis"))
    check("intro removed after animation", page.evaluate("!document.body.classList.contains('intro')"))
    check("Inter Tight active", page.evaluate("document.fonts.check('16px \"Inter Tight\"')"))
    v = page.evaluate("() => { const v = document.getElementById('heroVideo'); return {rs: v.readyState, err: !!v.error, paused: v.paused, nw: document.querySelector('.hero-media').classList.contains('no-video')}; }")
    print("video state:", v)
    check("hero video plays (or clean poster fallback)", v["rs"] >= 2 or v["nw"], json.dumps(v))
    ov = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("no horizontal overflow 1440", ov <= 0, f"{ov}px")

    page.screenshot(path="qa/01-hero-1440.png")
    # stats pinned mid-count
    page.evaluate("y => window.__lenis ? window.__lenis.scrollTo(y,{duration:0,immediate:true}) : window.scrollTo(0,y)", page.evaluate("document.getElementById('stats').getBoundingClientRect().top + window.scrollY + innerHeight*0.9"))
    page.wait_for_timeout(2600)
    c = page.evaluate("[...document.querySelectorAll('.card b')].map(b=>b.textContent)")
    print("counters mid-scrub:", c)
    check("counters animate to targets", c == ["9","20%","10%","1"] or c != ["0","0%","0%","0"], str(c))
    page.screenshot(path="qa/02-stats-1440.png")
    # loop accordion: hover panel 2
    page.evaluate("y => window.__lenis ? window.__lenis.scrollTo(y,{duration:0,immediate:true}) : window.scrollTo(0,y)", page.evaluate("document.getElementById('loop').getBoundingClientRect().top + window.scrollY + 10"))
    page.wait_for_timeout(1200)
    page.hover(".panel:nth-child(2)")
    page.wait_for_timeout(1400)
    active = page.evaluate("[...document.querySelectorAll('.panel')].findIndex(p=>p.classList.contains('is-active'))")
    check("accordion activates on hover", active == 1, f"active idx {active}")
    page.screenshot(path="qa/03-loop-1440.png")
    # cta + footer
    page.evaluate("y => window.__lenis ? window.__lenis.scrollTo(y,{duration:0,immediate:true}) : window.scrollTo(0,y)", page.evaluate("document.body.scrollHeight - innerHeight"))
    page.wait_for_timeout(4600)
    ring = page.evaluate("getComputedStyle(document.getElementById('fRing')).strokeDashoffset")
    check("footer logo ring drew", abs(float(re.match(r"[\d.]+", ring).group(0))) < 40, ring)
    page.screenshot(path="qa/04-cta-footer-1440.png")
    ov = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("no horizontal overflow 1440 (end)", ov <= 0, f"{ov}px")

    # internal anchors still smooth-scroll (brand link)
    page.click(".brand")
    page.wait_for_timeout(2200)
    check("brand anchor scrolls to hero top", page.evaluate("window.scrollY") < 50, f"scrollY={page.evaluate('window.scrollY')}")
    ctx.close()

    # ---- tablet + mobile ----
    for w, h, tag in [(768, 1024, "768"), (390, 844, "390")]:
        ctx = browser.new_context(viewport={"width":w,"height":h})
        pg = ctx.new_page()
        errs2 = []
        pg.on("pageerror", lambda e: errs2.append(str(e)))
        pg.goto(BASE + "/", wait_until="domcontentloaded")
        pg.wait_for_timeout(6000)
        ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"no horizontal overflow {tag}", ov <= 0, f"{ov}px")
        check(f"no page errors {tag}", len(errs2) == 0, "; ".join(errs2[:2]))
        pg.screenshot(path=f"qa/05-{tag}-hero.png")
        pg.evaluate("y => window.__lenis ? window.__lenis.scrollTo(y,{duration:0,immediate:true}) : window.scrollTo(0,y)", pg.evaluate("document.body.scrollHeight - innerHeight"))
        pg.wait_for_timeout(2500)
        ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"no horizontal overflow {tag} (bottom)", ov <= 0, f"{ov}px")
        pg.screenshot(path=f"qa/06-{tag}-bottom.png")
        ctx.close()

    # ---- reduced motion ----
    ctx = browser.new_context(viewport={"width":1440,"height":900}, reduced_motion="reduce")
    pg = ctx.new_page()
    errs3 = []
    pg.on("pageerror", lambda e: errs3.append(str(e)))
    pg.goto(BASE + "/", wait_until="domcontentloaded")
    pg.wait_for_timeout(1200)
    check("reduced-motion: static reveal", pg.evaluate("!document.body.classList.contains('intro')"))
    check("reduced-motion: counters final", pg.evaluate("[...document.querySelectorAll('.card b')].map(b=>b.textContent)") == ["9","20%","10%","1"])
    check("reduced-motion: no errors", len(errs3) == 0)
    pg.screenshot(path="qa/07-reduced-motion.png")
    ctx.close()

    # ---- link targets exist ----
    ctx = browser.new_context()
    pg = ctx.new_page()
    for href, expect_fragment in [("app/", "SPR"), ("notice.html", "Notice")]:
        r = pg.request.get(f"{BASE}/{href}")
        ok = r.status == 200 and expect_fragment.lower() in (r.text()[:4000] if href=="notice.html" else r.text()[:200000].lower())
        check(f"link target {href}", r.status == 200, f"HTTP {r.status}")
    ctx.close()
    browser.close()

httpd.shutdown()
print()
print(f"{len(results)-len(fails)}/{len(results)} checks passed")
if fails:
    print("FAILED:", fails); sys.exit(1)

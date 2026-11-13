# Record all video scenes from the LIVE SPR site (build 915dcf6c77), one context per scene.
# Each scene lasts >= its narration take + tail; ffmpeg trims later.
import sys, os, time, json
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright
BASE = __import__("os").environ.get("SPR_BASE", "https://my-spr-with-mo.duckdns.org")
OUT = r"D:/links-personal/links-personal/web/workspace/spr-repo/qa/voice/scenes"
os.makedirs(OUT, exist_ok=True)
DUR = json.load(open(r"D:/links-personal/links-personal/web/workspace/spr-repo/qa/voice/take_durations.json"))
USER, PW, MPW = "modemo", "gate-Pw-10!", "gate-Pw-10!"
log = lambda *a: print(*a, flush=True)

def pace(pg, sec):
    end = time.time() + sec
    while time.time() < end: pg.wait_for_timeout(500)

def click_a(pg, sel, wait=900):
    pg.locator(sel).first.click(); pg.wait_for_timeout(wait)

def type_slow(pg, sel, text, delay=70):
    # fill() not press_sequentially(): the per-keystroke input events left the app
    # in a state where the load-sample click silently no-op'd (root-caused live).
    f = pg.locator(sel).first
    f.wait_for(state="visible", timeout=15000)
    pg.wait_for_timeout(450)                      # let the card finish its entrance animation
    f.fill(text)
    pg.wait_for_timeout(400)

def first_run(pg, quick=False):
    """Fresh browser: notice -> setup -> master pw -> kit -> sample class.
    PROBE-VERBATIM sequence (bisected 2026-11-08): the helper-flavored variant
    (type_slow/click_a pacing) landed in a state where the load-sample click was
    silently dropped by the app; this exact sequence works every time."""
    pg.goto(BASE + "/app/", wait_until="domcontentloaded"); pg.wait_for_timeout(1500)
    pg.locator("#notice-read").check(); pg.wait_for_timeout(600)
    pg.locator("#notice-ack-btn").first.click(); pg.wait_for_timeout(1200)
    pg.locator("[data-action=show-setup]").first.click(); pg.wait_for_timeout(1400)
    pg.fill("#suUser", USER); pg.fill("#suPass", PW); pg.fill("#suConf", PW)
    pg.locator("[data-action=first-run]").first.click(); pg.wait_for_timeout(1800)
    pg.fill("#mrPw", MPW); pg.wait_for_timeout(300)
    pg.locator("[data-action=recovery-master]").first.click(); pg.wait_for_timeout(1800)
    pg.wait_for_function("!document.querySelector('#ownerKitBtn').disabled", timeout=30000)
    with pg.expect_download(timeout=30000) as dl:
        pg.locator("#ownerKitBtn").first.click(); pg.wait_for_timeout(500)
    dl.value.save_as(OUT + "/owner-kit-demo.json")
    pg.locator("#recoveryGo").first.click(); pg.wait_for_timeout(1600)
    # sample class: async PBKDF2 persist takes 5-15s - wait for the empty state to go
    pg.locator("[data-action=load-sample]").first.click(timeout=15000)
    pg.wait_for_function("document.body.textContent.includes('Class dashboard') || document.body.textContent.includes('Demo School')", timeout=60000)
    pg.wait_for_timeout(1800)
    try:
        pg.locator("#dlg [data-x='1']").first.click(timeout=4000); pg.wait_for_timeout(900)
    except Exception:
        pass

def run_scene(p, sid, take, fn, min_extra=1.0):
    need = DUR[take] + 1.6 + min_extra
    import os as _os
    if _os.environ.get("NOVID"):
        ctx = p.chromium.launch(channel="msedge", headless=True).new_context(
            viewport={"width": 1280, "height": 720}, bypass_csp=True)
    else:
        ctx = p.chromium.launch(channel="msedge", headless=True).new_context(
            viewport={"width": 1280, "height": 720}, record_video_dir=OUT, record_video_size={"width": 1280, "height": 720},
            accept_downloads=True, bypass_csp=True)
    pg = ctx.new_page()
    vp = pg.video.path() if pg.video else None          # capture the eventual video path NOW
    pg.on("pageerror", lambda e: log("  PAGE-ERROR:", str(e)[:120]))
    pg.on("console", lambda m: log("  CONSOLE:", m.type, m.text[:110]) if m.type in ("error","warning") else None)
    t0 = time.time()
    try: fn(pg)
    except Exception as e:
        try: pg.screenshot(path=OUT + "/FAIL-" + sid + ".png")
        except Exception: pass
        log("  SCENE-ERR:", sid, " || ".join(str(e).splitlines()[:4])[:600])
    left = need - (time.time() - t0)
    if left > 0: pace(pg, left)
    ctx.close()
    if vp and os.path.exists(vp):
        try:
            dst = OUT + "/scene-%s.webm" % sid
            if os.path.exists(dst): os.remove(dst)
            os.rename(vp, dst)                        # attribute the video BEFORE any other context can scramble mtime order
        except Exception as e:
            log("  RENAME-FAIL:", str(e)[:80])
    log("scene %s done (%.1fs)" % (sid, time.time() - t0))

ONLY = sys.argv[1] if len(sys.argv) > 1 else None
with sync_playwright() as p:
    # S02 landing + notice
    def s02(pg):
        pg.goto(BASE + "/", wait_until="domcontentloaded"); pg.wait_for_timeout(2600)
        pg.mouse.move(640, 500); pg.wait_for_timeout(1200)
        pg.locator('a[href="app/"]').first.click(timeout=8000); pg.wait_for_timeout(2600)
        pg.locator("#notice-read").check(); pg.wait_for_timeout(1300)
        pg.screenshot(path=OUT + "/notice-v2.png"); pace(pg, 3)
        click_a(pg, "#notice-ack-btn", 1500)
    if not ONLY or ONLY == "02": run_scene(p, "02", "02", s02)

    # S03b: PROBE-VERBATIM first-run (from the working probe_ls4) to bisect
    def s03probe(pg):
        pg.goto(BASE + "/app/", wait_until="domcontentloaded"); pg.wait_for_timeout(1500)
        pg.locator("#notice-read").check(); pg.wait_for_timeout(600)
        pg.locator("#notice-ack-btn").first.click(); pg.wait_for_timeout(1200)
        pg.locator("[data-action=show-setup]").first.click(); pg.wait_for_timeout(1400)
        pg.fill("#suUser","modemo"); pg.fill("#suPass","gate-Pw-10!"); pg.fill("#suConf","gate-Pw-10!")
        pg.locator("[data-action=first-run]").first.click(); pg.wait_for_timeout(1800)
        pg.fill("#mrPw","gate-Pw-10!"); pg.wait_for_timeout(300)
        pg.locator("[data-action=recovery-master]").first.click(); pg.wait_for_timeout(1800)
        pg.wait_for_function("!document.querySelector('#ownerKitBtn').disabled",timeout=30000)
        with pg.expect_download(timeout=30000) as dl:
            pg.locator("#ownerKitBtn").first.click(); pg.wait_for_timeout(500)
        dl.value.save_as(OUT + "/kitprobe-rec.json")
        pg.locator("#recoveryGo").first.click(); pg.wait_for_timeout(1600)
        pg.locator("[data-action=load-sample]").first.click(timeout=15000); pg.wait_for_timeout(4000)
        body = pg.locator("body").inner_text()
        log("  PROBE-VERBATIM loaded?", ("Class dashboard" in body) or ("Demo School" in body))
    if ONLY == "03b": run_scene(p, "03b", "03", s03probe)
    # S03 first-run journey
    if not ONLY or ONLY == "03": run_scene(p, "03", "03", lambda pg: first_run(pg))

    # S04 sign out + sign in
    def s04(pg):
        first_run(pg, quick=True)
        pg.locator("[data-action=logout]").first.click(timeout=15000)
        pg.wait_for_timeout(4000)                     # logout does a full location.reload() + boot
        pg.fill("#loginUser", USER)
        pg.fill("#loginPass", PW)
        pg.locator("[data-action=do-login]").first.click(timeout=15000)
        pg.wait_for_timeout(3500)
    if ONLY is None or ONLY == "04": run_scene(p, "04", "04", s04)

    # S05 dashboard tabs
    def s05(pg):
        first_run(pg, quick=True); pg.wait_for_timeout(1200)
        for tab in ["Assessment evidence", "Teaching priorities", "Advanced analysis"]:
            tt = pg.get_by_text(tab).first
            if tt.count():
                try: tt.click(timeout=6000); pg.wait_for_timeout(1300)
                except Exception: pass
        pg.get_by_text("Overview").first.click(timeout=6000); pg.wait_for_timeout(1200)
    if ONLY is None or ONLY == "05": run_scene(p, "05", "05", s05)

    # S06 students
    def s06(pg):
        first_run(pg, quick=True)
        pg.evaluate("location.hash = '#/students'"); pg.wait_for_timeout(2200)
        pg.mouse.wheel(0, 700); pg.wait_for_timeout(1500); pg.mouse.wheel(0, -700); pg.wait_for_timeout(1200)
    if ONLY is None or ONLY == "06": run_scene(p, "06", "06", s06)

    # S07 enter scores (autosave)
    def s07(pg):
        first_run(pg, quick=True)
        pg.evaluate("location.hash = '#/entry'"); pg.wait_for_timeout(2200)
        try:
            inp = pg.locator('input[type="number"]').first
            inp.fill("18"); pg.wait_for_timeout(1800)
            inp2 = pg.locator('input[type="number"]').nth(1)
            inp2.fill("17"); pg.wait_for_timeout(1600)
        except Exception: pass
    if ONLY is None or ONLY == "07": run_scene(p, "07", "07", s07)

    # S08 grading
    def s08(pg):
        first_run(pg, quick=True)
        pg.evaluate("location.hash = '#/grading'"); pg.wait_for_timeout(2400)
        pg.mouse.wheel(0, 600); pg.wait_for_timeout(1600); pg.mouse.wheel(0, -600); pg.wait_for_timeout(900)
    if ONLY is None or ONLY == "08": run_scene(p, "08", "08", s08)

    # S09 analysis
    def s09(pg):
        first_run(pg, quick=True)
        pg.evaluate("location.hash = '#/analysis'"); pg.wait_for_timeout(2400)
        try:
            pg.locator("button:has-text('Deep-Dive')").first.click(timeout=6000); pg.wait_for_timeout(2600)
        except Exception: pass
    if ONLY is None or ONLY == "09": run_scene(p, "09", "09", s09)

    # S10 report cards
    def s10(pg):
        first_run(pg, quick=True)
        pg.evaluate("location.hash = '#/reports'"); pg.wait_for_timeout(2200)
        try:
            tb = pg.get_by_text("Student report cards").first
            if tb.count(): tb.click(timeout=6000); pg.wait_for_timeout(1400)
            vw = pg.get_by_text("View Report Card").first
            if vw.count(): vw.click(timeout=6000); pg.wait_for_timeout(2200)
        except Exception: pass
    if ONLY is None or ONLY == "10": run_scene(p, "10", "10", s10)

    # S11 users sheet + owner controls + backup
    def s11(pg):
        first_run(pg, quick=True)
        pg.evaluate("location.hash = '#/users'"); pg.wait_for_timeout(2400)
        pg.mouse.wheel(0, 500); pg.wait_for_timeout(1500); pg.mouse.wheel(0, -500); pg.wait_for_timeout(1000)
        pg.evaluate("location.hash = '#/manage'"); pg.wait_for_timeout(2200)
        try:
            oc = pg.get_by_text("Owner controls").first
            if oc.count(): oc.click(timeout=6000); pg.wait_for_timeout(1800)
        except Exception: pass
    if ONLY is None or ONLY == "11": run_scene(p, "11", "11", s11)

# rename Playwright's random video names to scene ids
import glob, re
for f in glob.glob(OUT + "/*.webm"):
    m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webm", f)
    log("video:", os.path.basename(f))
print("SCENES-DONE")

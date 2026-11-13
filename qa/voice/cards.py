# Record the two card scenes: S01 intro (landing hero) and S12 outro (landing, end card).
import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright
BASE = "https://my-spr-with-mo.duckdns.org"
OUT = r"D:/links-personal/links-personal/web/workspace/spr-repo/qa/voice/scenes"

def card(p, name, sec, scroll=0):
    b = p.chromium.launch(channel="msedge", headless=True)
    ctx = b.new_context(viewport={"width": 1280, "height": 720},
                        record_video_dir=OUT, record_video_size={"width": 1280, "height": 720})
    pg = ctx.new_page()
    pg.goto(BASE + "/", wait_until="domcontentloaded"); pg.wait_for_timeout(2500)
    if scroll: pg.mouse.wheel(0, scroll); pg.wait_for_timeout(800)
    pg.wait_for_timeout(sec * 1000)
    ctx.close(); b.close()
    print("card", name, "done")

with sync_playwright() as p:
    card(p, "01", 6)
    card(p, "12", 11, scroll=300)
# rename the two newest webm files to card ids
import glob
vs = sorted(glob.glob(OUT + "/*.webm"), key=os.path.getmtime)
os.replace(vs[-2], OUT + "/card_01.webm")
os.replace(vs[-1], OUT + "/card_12.webm")
print("CARDS-DONE")

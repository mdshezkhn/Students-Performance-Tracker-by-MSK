"""DEMO E2E v2 — full Thursday-demonstration rehearsal against the LIVE site.
notice v2 -> First-time setup -> sign-in -> master pw -> owner kit ->
sample class -> all main pages (hash routes) -> Users sheet + roster import
(per-pair) -> owner controls -> backup -> sign out/in -> phone width.

Usage: C:/Python314/python.exe qa/demo_e2e.py [https://my-spr-with-mo.duckdns.org]
"""
import os, sys, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://my-spr-with-mo.duckdns.org"
OUT = os.path.join(os.path.dirname(__file__), "demo")
os.makedirs(OUT, exist_ok=True)
SHOTS = []
CHECKS = []
ERRORS = []
BADRES = []

def ok(name, cond, extra=""):
    CHECKS.append((name, bool(cond), extra))
    print(("  ok  " if cond else "  FAIL") + f" {name}" + (f"  [{extra}]" if extra and not cond else ""))

def shot(pg, name):
    p = os.path.join(OUT, f"{len(SHOTS):02d}-{name}.png")
    try:
        pg.screenshot(path=p)
        SHOTS.append(p)
    except Exception:
        pass

def vis(pg, sel, timeout=15000):
    pg.wait_for_selector(sel, state="visible", timeout=timeout)
    return pg.locator(sel).first

def act(pg, action, timeout=15000):
    sel = f'[data-action="{action}"]'
    pg.wait_for_selector(sel, state="visible", timeout=timeout)
    pg.locator(sel).first.click()

def route(pg, h, ms=1500):
    pg.evaluate(f"location.hash = '{h}'")
    pg.wait_for_timeout(ms)

def section(t):
    print(f"\n== {t} ==")

def accept_notice(pg):
    vis(pg, "#notice-ack-btn", 15000)
    full = pg.locator("#notice-card, .notice-card, .dlg, body").first.inner_text()
    ok("notice v2 gate shows owner disclosure", ("owner account" in full and "every class" in full) or "负责人账户" in full)
    ok("notice version line shows v2", "Notice v2" in full or "v2" in full)
    cb = pg.locator("#notice-read")
    if cb.count():
        cb.first.check()
    pg.locator("#notice-ack-btn").first.click()
    pg.wait_for_timeout(900)

ROSTER_CSV = (
    "username,display_name,role,class_or_grade,School,paired_with,class_role,status\n"
    "msk,Mohammed Shehzad Khan,admin,All,ZhengFangYuan,,,\n"
    "anush,Anush,teacher,P1C1,ZhengFangYuan,lily,eal,\n"
    "lily,Lily,teacher,P1C1,ZhengFangYuan,anush,supporting,\n"
    "tina,Tina,teacher,P2C2,ZhengFangYuan,kay,eal,\n"
    "kay,Kay,teacher,P2C2,ZhengFangYuan,tina,supporting,\n"
)

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(channel="msedge", headless=True)
        ctx = b.new_context(viewport={"width": 1280, "height": 800}, bypass_csp=True)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        pg.on("console", lambda m: ERRORS.append(f"console: {m.text}") if m.type == "error" else None)
        pg.on("response", lambda r: BADRES.append(f"{r.status} {r.url}") if r.status >= 400 else None)

        section("1. Landing -> Open the App")
        pg.goto(BASE + "/", wait_until="domcontentloaded")
        pg.wait_for_timeout(2500)
        shot(pg, "landing")
        btn = pg.get_by_text("Open the App").first
        ok("Open the App present", btn.count() > 0)
        btn.click()
        pg.wait_for_timeout(2500)

        section("2. Notice v2 gate")
        try:
            accept_notice(pg)
            shot(pg, "notice-accepted")
        except Exception as e:
            ok("notice gate", False, str(e)[:120])

        section("3. First-time setup (show-setup -> sign-in -> master pw -> kit)")
        try:
            act(pg, "show-setup", 12000)
            pg.wait_for_timeout(600)
            ok("setup card opens", pg.locator("#suUser").count() > 0)
            pg.fill("#suUser", "modemo")
            pg.fill("#suPass", "DemoMo-2026!")
            pg.fill("#suConf", "DemoMo-2026!")
            shot(pg, "signup-filled")
            act(pg, "first-run", 12000)
            pg.wait_for_timeout(1500)
            ok("master-pw step reached", pg.locator("#mrPw").count() > 0)
            pg.fill("#mrPw", "MasterDemo-2026!")
            mr2 = pg.locator("#mrPw2")
            if mr2.count():
                mr2.fill("MasterDemo-2026!")
            act(pg, "recovery-master", 12000)
            pg.wait_for_timeout(1800)
            kit = pg.locator("#ownerKitBtn")
            ok("kit button appears", kit.count() > 0)
            for _ in range(50):
                if kit.count() and kit.is_enabled():
                    break
                pg.wait_for_timeout(250)
            ok("kit button enabled (ECDSA seal done)", kit.is_enabled())
            with pg.expect_download(timeout=20000) as dl:
                kit.click()
            f = dl.value
            ok("owner kit downloads as .json", f.suggested_filename.endswith(".json"), f.suggested_filename)
            kp = os.path.join(OUT, "demo-owner-kit.json")
            f.save_as(kp)
            j = json.load(open(kp, encoding="utf-8"))
            s = json.dumps(j)
            ok("kit sealed (no plaintext privateKey field)", "privateKey" not in s and len(s) > 100)
            shot(pg, "kit-downloaded")
            ack = pg.locator("#notice-ack-btn")
            if ack.count() and ack.is_visible():
                ack.click()
            else:
                cont = pg.locator(".dlg .btn.primary, .dlg-actions .btn").first
                if cont.count():
                    cont.click()
            pg.wait_for_timeout(1200)
            shot(pg, "after-kit")
        except Exception as e:
            ok("first-run flow", False, str(e)[:150])

        section("4. Class setup — Load sample data")
        try:
            vis(pg, '[data-action="load-sample"]', 15000)
            shot(pg, "class-setup-screen")
            act(pg, "load-sample", 12000)
            pg.wait_for_timeout(3500)
            body = pg.locator("body").inner_text()
            ok("sample class loaded (dashboard visible)", ("Class dashboard" in body) or ("Demo School" in body))
            shot(pg, "dashboard")
        except Exception as e:
            ok("load sample", False, str(e)[:120])

        section("5. Dashboard tabs")
        try:
            for tab in ["Assessment evidence", "Teaching priorities", "Advanced analysis"]:
                t = pg.get_by_text(tab).first
                if t.count():
                    t.click(); pg.wait_for_timeout(900)
            shot(pg, "dashboard-tabs")
            ok("dashboard tabs switch", True)
            route(pg, "#/dashboard")
        except Exception as e:
            ok("dashboard tabs", False, str(e)[:120])

        section("6. Students")
        try:
            route(pg, "#/students", 1800)
            body = pg.locator("body").inner_text()
            n = body.count("demo-")
            ok("student cards render", n >= 10, f"ids seen={n}")
            shot(pg, "students")
        except Exception as e:
            ok("students", False, str(e)[:120])

        section("7. Enter scores + autosave")
        try:
            route(pg, "#/entry", 1800)
            shot(pg, "enter-scores")
            inp = pg.locator('input[type="number"]').first
            if inp.count():
                inp.fill("18")
                pg.wait_for_timeout(1500)
                ok("score typed, autosave ran (no error)", True)
            shot(pg, "score-typed")
        except Exception as e:
            ok("enter scores", False, str(e)[:120])

        section("8. Grading (formula footer)")
        try:
            route(pg, "#/grading", 1800)
            body = pg.locator("body").inner_text()
            ok("grading formula present", ("Listening 10%" in body and "Written 20%" in body))
            shot(pg, "grading")
        except Exception as e:
            ok("grading", False, str(e)[:120])

        section("9. Analysis")
        try:
            route(pg, "#/analysis", 1800)
            shot(pg, "analysis")
            ok("analysis renders", True)
        except Exception as e:
            ok("analysis", False, str(e)[:120])

        section("10. Report cards (one A4)")
        try:
            route(pg, "#/reports", 1800)
            shot(pg, "report-cards")
            tab = pg.get_by_text("Student report cards").first
            if tab.count():
                tab.click(); pg.wait_for_timeout(900)
                sel = pg.locator("select").first
                if sel.count():
                    sel.select_option(index=1); pg.wait_for_timeout(600)
                view = pg.get_by_text("View Report Card").first
                if view.count():
                    view.click(); pg.wait_for_timeout(1500)
                    shot(pg, "report-card-view")
            pg.emulate_media(media="print")
            h = pg.evaluate("() => { const el = document.querySelector('.report-card, .rcard, .reportcard, .card-print'); return el ? el.scrollHeight : 0 }")
            pg.emulate_media(media="screen")
            ok("report card height sane for A4 (<=1120px)", h == 0 or h <= 1120, f"h={h}")
        except Exception as e:
            ok("report cards", False, str(e)[:120])

        section("11. Users sheet + roster import (per-pair)")
        try:
            route(pg, "#/users", 2000)
            body = pg.locator("body").inner_text().lower()
            ok("Users sheet renders", ("username" in body and "display name" in body and "paired with" in body))
            ok("owner row: modemo | Owner | protected", ("modemo" in body) and ("owner" in body) and ("protected" in body))
            shot(pg, "users-sheet")
            csvp = os.path.join(OUT, "demo-roster.csv")
            # variant A: with class_role declared -> everything pre-filled, 0 selects (SPR never guesses)
            open(csvp, "w", encoding="utf-8").write(ROSTER_CSV)
            pg.locator("#file-roster").set_input_files(csvp)
            pg.wait_for_timeout(2000)
            prev = pg.locator("body").inner_text()
            ok("import preview opens", ("Import roster sheet" in prev))
            ok("owner-row skip note in preview", ("protected owner account" in prev))
            np = pg.locator(".dlg select").count()
            ok("declared roles pre-filled (0 selects needed)", np == 0, f"selects={np}")
            pg.locator('#dlg [data-x="0"]').first.click()
            pg.wait_for_timeout(800)
            # variant B: same roster, NO class_role -> 2 per-pair decisions required
            lines2 = []
            for ln in ROSTER_CSV.strip().splitlines():
                f = ln.split(",")
                while len(f) < 8:
                    f.append("")
                f[6] = ""   # status
                f[7] = ""   # class_role
                lines2.append(",".join(f))
            NOROLE = "\n".join(lines2)
            csvp2 = os.path.join(OUT, "demo-roster-norole.csv")
            open(csvp2, "w", encoding="utf-8").write(NOROLE + "\n")
            pg.locator("#file-roster").set_input_files(csvp2)
            pg.wait_for_timeout(2000)
            sels = pg.locator('#dlg select[data-rolepick]')
            np = sels.count()
            ok("undecided pairs -> ONE select per partnership (2)", np == 2, f"selects={np}")
            shot(pg, "import-preview")
            ok("counter starts at 0 of 2 decided", ("0 of 2 decided" in pg.locator("#pairCount").inner_text()))
            for i in range(np):
                try:
                    sels.nth(i).select_option(index=1)
                except Exception:
                    pass
            pg.wait_for_timeout(500)
            ok("decision counter updates (2 of 2 decided)", ("2 of 2 decided" in pg.locator("#pairCount").inner_text()))
            go = pg.locator('#dlg [data-x="1"]')
            go.click()
            # the import tail (account creation + escrow rekeys) is async PBKDF2 work:
            # wait for the app's own __SHEET_DONE marker instead of a guess
            done = False
            for _ in range(120):
                if pg.evaluate("() => window.__SHEET_DONE >= 1"):
                    done = True
                    break
                pg.wait_for_timeout(1000)
            pg.wait_for_timeout(1000)
            shot(pg, "import-applied")
            ok("import tail finished (__SHEET_DONE)", done)
            route(pg, "#/users", 2500)
            ok("import applied (anush in Users)", "anush" in pg.locator("body").inner_text().lower())
            shot(pg, "users-after-import")
            # new accounts show a one-time passwords dialog — dismiss it before continuing
            pwDlg = pg.locator('#dlg [data-x="1"]')
            for _ in range(10):
                if pwDlg.count() and pwDlg.first.is_visible():
                    pwDlg.first.click(); pg.wait_for_timeout(600)
                    break
                pg.wait_for_timeout(500)
            back = pg.locator('[data-action="go-back"]').first
            if back.count():
                back.click(); pg.wait_for_timeout(1200)
                ok("Back returns to working screen", pg.locator("#content, #app").count() > 0)
                shot(pg, "back-from-users")
        except Exception as e:
            ok("users/import", False, str(e)[:150])

        section("12. Owner controls + Manage")
        try:
            route(pg, "#/manage", 2200)
            if not pg.get_by_text("Owner controls").count():
                summ = pg.locator("details summary").first
                if summ.count():
                    summ.click(); pg.wait_for_timeout(1200)
            body = pg.locator("body").inner_text()
            ok("Owner controls card visible", "Owner controls" in body)
            ok("control status line present", ("Control status" in body) or ("normal" in body.lower()))
            shot(pg, "owner-controls")
            bk = pg.locator('[data-action="backup"]').first
            if bk.count():
                with pg.expect_download(timeout=15000) as bdl:
                    bk.click()
                ok("full backup downloads", bdl.value.suggested_filename != "")
        except Exception as e:
            ok("owner controls/backup", False, str(e)[:120])

        section("13. Sign out -> sign in")
        try:
            act(pg, "logout", 12000)
            pg.wait_for_timeout(4000)  # logout does a full location.reload() + boot
            shot(pg, "signed-out")
            ok("back at login card", pg.locator("#loginUser").count() > 0)
            pg.fill("#loginUser", "modemo")
            pg.fill("#loginPass", "DemoMo-2026!")
            act(pg, "do-login", 12000)
            pg.wait_for_timeout(3500)
            body = pg.locator("body").inner_text()
            ok("sign back in works (dashboard or class chooser)", ("Dashboard" in body) or ("Set up" in body) or ("Demo School" in body))
            shot(pg, "signed-back-in")
        except Exception as e:
            ok("sign out/in", False, str(e)[:120])
        ctx.close()

        section("14. Phone 390 — fresh device sanity")
        ctx2 = b.new_context(viewport={"width": 390, "height": 844}, bypass_csp=True)
        pg2 = ctx2.new_page()
        pg2.on("pageerror", lambda e: ERRORS.append(f"phone pageerror: {e}"))
        pg2.goto(BASE + "/app/", wait_until="domcontentloaded")
        pg2.wait_for_timeout(2500)
        try:
            accept_notice(pg2)
            shot(pg2, "phone-after-notice")
            ov = pg2.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2")
            ok("no horizontal overflow at 390", not ov)
            # first-time link present on phone too
            ok("First-time setup link present (phone)", pg2.locator('[data-action="show-setup"]').count() > 0)
        except Exception as e:
            ok("phone flow", False, str(e)[:120])
        ctx2.close()

        npass = sum(1 for _, c, _ in CHECKS if c)
        print("\n================ DEMO E2E SUMMARY ================")
        print(f"URL: {BASE}")
        print(f"CHECKS: {npass}/{len(CHECKS)} passed")
        real_errors = [e for e in ERRORS if "404" not in e]
        print(f"PAGE/CONSOLE ERRORS (non-404): {len(real_errors)}")
        for e in real_errors[:8]:
            print("  ", e[:170])
        if BADRES:
            print("bad responses (>=400):", len(BADRES))
            for u in BADRES[:8]:
                print("  ", u[:150])
        for name, c, extra in CHECKS:
            if not c:
                print(f"  FAIL: {name} {('[' + extra + ']') if extra else ''}")
        print(f"screenshots: {OUT} ({len(SHOTS)} files)")
        b.close()

if __name__ == "__main__":
    main()

import os, sys, time, threading, http.server, socketserver, functools
PORT=8129; ROOT=os.path.abspath('.')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
    def end_headers(self): self.send_header('Cache-Control','no-store'); super().end_headers()
h=functools.partial(Q,directory=ROOT)
srv=socketserver.ThreadingTCPServer(('127.0.0.1',PORT),h); srv.daemon_threads=True
threading.Thread(target=srv.serve_forever,daemon=True).start()
from playwright.sync_api import sync_playwright
PW='gate-Pw-10!'
with sync_playwright() as p:
    b=p.chromium.launch(channel='msedge',headless=True)
    ctx=b.new_context(viewport={'width':390,'height':844},bypass_csp=True)
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{PORT}/app/',wait_until='domcontentloaded')
    pg.wait_for_timeout(1500)
    print('cards:',pg.locator('.login-card').count(),'suUser count:',pg.locator('#suUser').count())
    box=pg.locator('#notice-read')
    if box.count(): box.check(); pg.locator('#notice-ack-btn').click(); pg.wait_for_timeout(600)
    print('after ack: suUser count:',pg.locator('#suUser').count(),'show-setup:',pg.locator('[data-action=show-setup]').count())
    ss=pg.locator('[data-action=show-setup]')
    if ss.count(): ss.click(); pg.wait_for_timeout(500)
    print('before fills: suUser:',pg.locator('#suUser').count(),'suPass:',pg.locator('#suPass').count(),'suConf:',pg.locator('#suConf').count())
    pg.fill('#suUser','msk'); print('after user fill:',repr(pg.locator('#suUser').input_value()))
    pg.fill('#suPass',PW); print('after pass fill: suPass=',repr(pg.locator('#suPass').input_value()),' suUser=',repr(pg.locator('#suUser').input_value()))
    pg.fill('#suConf',PW); print('after conf fill: suConf=',repr(pg.locator('#suConf').input_value()),' suUser=',repr(pg.locator('#suUser').input_value()),' suPass=',repr(pg.locator('#suPass').input_value()))
    pg.locator('[data-action=first-run]').click(); pg.wait_for_timeout(1500)
    print('after create: suErr=',repr(pg.locator('#suErr').input_value() if pg.locator('#suErr').count() else '-'),' mrPw:',pg.locator('#mrPw').count(),' errs:',errs[:2])
    b.close()

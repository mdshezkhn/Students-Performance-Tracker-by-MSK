"""round9 task 4: landing first paint on a throttled connection (Fast 3G, cache off).

Serves the repo root (landing + media) locally, loads index.html under
Chromium with Fast 3G throttling, records:
  - seconds to first contentful paint (FCP)
  - total transferred bytes of index.html + all assets actually fetched
  - that the hero VIDEO does not block first paint (video request starts
    only after load event, if at all)
  - prefers-reduced-motion and Save-Data both stop the video (poster fallback)
Usage: python qa/landing_weight.py
"""
import json, os, subprocess, sys, time
from pathlib import Path

R = Path(__file__).resolve().parent.parent
PORT = 8977
BASE = 'http://127.0.0.1:%d/' % PORT

srv = subprocess.Popen(
    [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
    cwd=str(R), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)
try:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', headless=True)
        ctx = b.new_context(viewport={'width': 1280, 'height': 800})
        page = ctx.new_page()
        # ---- Fast 3G: 1.6 Mbps down, 750 ms RTT (Chromium DevTools preset) ----
        cdp = ctx.new_cdp_session(page)
        cdp.send('Network.enable')
        cdp.send('Network.emulateNetworkConditions', {
            'offline': False, 'latency': 750,
            'downloadThroughput': int(1.6 * 1024 * 1024 / 8),
            'uploadThroughput': int(750 * 1024 / 8)})
        cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})

        fcp = {}
        page.on('metrics', lambda m: None)
        requests = {}
        page.on('request', lambda rq: requests.setdefault(rq.url, {'start': time.time(), 'done': None, 'size': 0}))
        page.on('response', lambda rs: requests.setdefault(rs.url, {}).update({'status': rs.status}))
        page.on('requestfinished', lambda rq: requests.setdefault(rq.url, {}).update({'done': time.time()}))
        page.on('response', lambda rs: requests.setdefault(rs.url, {}).update({'size': (rs.headers or {}).get('content-length') and int(rs.headers.get('content-length', 0)) or 0}))

        t0 = time.time()
        page.goto(BASE, wait_until='domcontentloaded', timeout=60000)
        # poll for FCP via performance API (works headless)
        for _ in range(240):
            try:
                v = page.evaluate("JSON.stringify(performance.getEntriesByType('paint'))")
                ents = json.loads(v)
                f = next((e for e in ents if e['name'] == 'first-contentful-paint'), None)
                if f:
                    fcp['fcp'] = f['startTime'] / 1000.0
                    break
            except Exception:
                pass
            time.sleep(0.25)
        video_delay = None
        try:
            page.wait_for_load_state('load', timeout=45000)
        except Exception:
            pass
        # which requests happened, sizes
        rows = []
        for url, inf in requests.items():
            rows.append({'url': url.replace(BASE, ''), 'size': inf.get('size') or 0, 'status': inf.get('status')})
        html_size = next((r['size'] for r in rows if r['url'] == ''), 0)
        total = sum(r['size'] for r in rows)
        video = [r for r in rows if r['url'].endswith('.mp4')]
        # video start time relative to load
        if video:
            video_delay = round(requests[[u for u in requests if u.endswith('.mp4')][0]]['start'] - t0, 2)

        print('== Fast 3G, cache off (desktop 1280) ==')
        print('  first contentful paint: %.2f s' % fcp.get('fcp', -1))
        print('  index.html bytes: %d' % html_size)
        print('  total transferred (all requests with CL): %d bytes (%.2f MB)' % (total, total / 1048576))
        print('  requests: %d; video requests: %d%s' % (len(rows), len(video), (' first video request at +%.2fs' % video_delay) if video_delay is not None else ''))
        ok_fcp = fcp.get('fcp', 99) < 3.0
        print('  %s: FCP under 3s on Fast 3G' % ('ok' if ok_fcp else 'FAIL'))

        # ---- motion / data-saver gates (no throttle needed) ----
        print('== reduced motion / Save-Data stop the video ==')
        for label, init in [('reduced-motion', "{ reducedMotion: 'reduce' }"),
                            ('save-data', "{ save_data: 'on' }")]:
            cx = b.new_context(viewport={'width': 1280, 'height': 800}, **({'reduced_motion': 'reduce'} if label == 'reduced-motion' else {}))
            pg = cx.new_page()
            fetched = []
            pg.on('request', lambda rq: fetched.append(rq.url))
            cx.add_init_script("try{Object.defineProperty(navigator.connection,'saveData',{get:function(){return true}});}catch(e){};try{Object.defineProperty(Navigator.prototype,'connection',{get:function(){return {saveData:true}}});}catch(e){}")
            pg.goto(BASE, wait_until='load', timeout=60000)
            pg.wait_for_timeout(2500)
            vid = pg.query_selector('#heroVideo')
            cls = vid.get_attribute('class') or ''
            box = vid.evaluate('el => el.parentElement.className')
            started = any(u.endswith('.mp4') for u in fetched)
            no_video = 'no-video' in box
            print('  %s: video fetched=%s poster-fallback=%s' % (label, started, no_video))
            print('  %s: %s' % (label, 'ok' if (not started and no_video) else 'FAIL'))
            cx.close()

        b.close()
finally:
    srv.terminate()

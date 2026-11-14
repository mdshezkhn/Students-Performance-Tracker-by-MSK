#!/usr/bin/env python3
"""Overnight 2026-11-15: wire SPRDemo (demo classes) into the app.
Touches: source/index.template.html, source/build2.py, source/style.css, source/app.js.
Idempotent: refuses to double-apply (checks for DEMO_KEY marker)."""
import io, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def rd(p):
    with io.open(p, encoding='utf-8', newline='') as f: return f.read()
def wr(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='') as f: f.write(s)

ok = True
def step(name, cond):
    global ok
    print(('OK  ' if cond else 'FAIL ') + name)
    if not cond: ok = False

# ---------- 1. template: script slot for sprdemo ----------
p = ROOT + '/source/index.template.html'
s = rd(p)
if '/*__SPRDEMO__*/' not in s:
    step('template: __SPRADAPTER__ slot exists', '/*__SPRADAPTER__*/\n</script>' in s)
    s = s.replace('/*__SPRADAPTER__*/\n</script>', '/*__SPRADAPTER__*/\n</script>\n<script>\n/*__SPRDEMO__*/\n</script>', 1)
    wr(p, s)
step('template: SPRDEMO marker present', '/*__SPRDEMO__*/' in rd(p))

# ---------- 2. build2.py: inline the module + final assert ----------
p = ROOT + '/source/build2.py'
s = rd(p)
if "'__SPRDEMO__'" not in s:
    step('build2: adapter mapping line exists', "    ('/*__SPRADAPTER__*/', SRC / 'spradapter.js')," in s)
    s = s.replace("    ('/*__SPRADAPTER__*/', SRC / 'spradapter.js'),",
                  "    ('/*__SPRADAPTER__*/', SRC / 'spradapter.js'),\n    ('/*__SPRDEMO__*/', SRC / 'sprdemo.js'),", 1)
    step('build2: final-assert list contains __SPRADAPTER__', "'__SPRADAPTER__'" in s)
    s = s.replace("'__CLASSSTORE__', '__APP__')", "'__CLASSSTORE__', '__APP__', '__SPRDEMO__')", 1)
    wr(p, s)
step('build2: SPRDEMO mapped', "'__SPRDEMO__'" in rd(p))

# ---------- 3. style.css: demo banner ----------
p = ROOT + '/source/style.css'
s = rd(p)
if '#demo-banner' not in s:
    s += """

/* demo classes banner (2026-11-15): always clear this is dummy data */
#demo-banner{position:fixed;left:12px;bottom:12px;z-index:60;background:#1e293b;color:#e2e8f0;padding:8px 12px;border-radius:10px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center;max-width:92vw}
#demo-banner button{background:#ef4444;color:#fff;border:0;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
@media print{#demo-banner{display:none}}
"""
    wr(p, s)
step('style: banner css present', '#demo-banner' in rd(p))

# ---------- 4. app.js ----------
p = ROOT + '/source/app.js'
s = rd(p)
if 'DEMO_KEY' in s:
    print('SKIP app.js: demo already wired')
else:
    # 4a. functions block before init()
    anchor = "\n\n\n  async function init() {"
    step('app.js: init anchor', anchor in s)
    block = r'''

  /* ================= demo classes (2026-11-15): synthetic, local-only =================
     Two demo classes with dummy students so anyone can try the FET/CET
     workflow without touching real data. Seeded through the app's real
     machinery (classstore sealing, per-teacher keyrings, role matrix), so
     permissions, approvals and reports behave exactly like production.
     Data is 100% synthetic (source/sprdemo.js, fixed seed). Demo classes are
     never pushed to the cloud automatically. */
  const DEMO_KEY = 'spr-demo-v1';
  function demoInstalled() { try { return !!localStorage.getItem(DEMO_KEY); } catch (e) { return false; } }
  function demoRec() { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || 'null'); } catch (e) { return null; } }
  function demoBanner() {
    if (!demoInstalled()) return;
    try {
      if (document.getElementById('demo-banner')) return;
      const b = document.createElement('div');
      b.id = 'demo-banner';
      b.innerHTML = '<span>Demo classes: dummy students only</span>' +
        '<button type="button" data-action="demo-remove">Remove demo data</button>';
      document.body.appendChild(b);
    } catch (e) {}
  }
  function demoOpenDialog() {
    if (demoInstalled()) { toast('Demo data is already on this device. Remove it first if you want a fresh copy.'); return; }
    if (typeof SPRDemo === 'undefined') { toast('The demo module did not load. Reload the page and try again.', true); return; }
    openDlg(
      '<h3>Try the demo classes</h3>' +
      '<p class="small">This adds two classes (P4-A Demo and P4-B Demo) with <b>dummy students</b>, sample scores and classroom observations to this device, plus two demo sign-in accounts: <b>fet-demo</b> (foreign teacher, observations) and <b>cet-demo</b> (assistant teacher, scores). Nothing real is touched, nothing is sent anywhere, and you can remove it all with one click.</p>' +
      '<p class="small">Choose a password for the demo accounts (you will use it to sign in as either demo teacher):</p>' +
      '<input class="inp" id="demoPw1" type="password" autocomplete="new-password" placeholder="demo password (at least 6 characters)">' +
      '<input class="inp" id="demoPw2" type="password" autocomplete="new-password" placeholder="repeat the password" style="margin-top:8px">' +
      '<p class="small" id="demoErr" style="color:#c0392b;margin:8px 0 0"></p>' +
      '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button>' +
      '<button class="btn primary" data-action="demo-install">Add demo classes</button></div>');
  }
  async function demoInstall() {
    if (demoInstalled()) return;
    const p1 = (document.getElementById('demoPw1') || {}).value || '';
    const p2 = (document.getElementById('demoPw2') || {}).value || '';
    const err = document.getElementById('demoErr');
    if (p1.length < 6) { if (err) err.textContent = 'Use at least 6 characters.'; return; }
    if (p1 !== p2) { if (err) err.textContent = 'The two passwords do not match.'; return; }
    const btn = document.querySelector('[data-action="demo-install"]'); if (btn) btn.disabled = true;
    try {
      const data = SPRDemo.build();
      const prevMode = sprMode();
      const hadUsers = getAuth().users.length > 0;
      const auth = getAuth();
      const createdUsers = [];
      if (!hadUsers) {
        /* fresh browser: give the demo its own owner account so
           administration works, without inventing a second owner on
           devices that already have one */
        auth.users.push({ username: 'owner-demo', name: 'Demo Owner', role: 'owner', keyring: {}, login: await CS.loginWrap(p1) });
        createdUsers.push('owner-demo');
      }
      for (const u of data.users) {
        if (auth.users.some((x) => String(x.username).toLowerCase() === u.username.toLowerCase())) continue;
        auth.users.push({ username: u.username, name: u.name, role: u.role, keyring: {}, login: await CS.loginWrap(p1) });
        createdUsers.push(u.username);
      }
      const base = emptyDB();
      const created = [];
      for (const c of data.classes) {
        const key = await CS.genKey();
        const wb = { v: 1, currentSemesterId: c.semester.id, semesters: [c.semester],
          pending: c.pending || [], audit: c.audit || [], reportNotes: {},
          credit: base.credit, author: base.author, settings: { autoTotal: true, spTotal: 20, daTotal: 10 } };
        const blob = await CS.sealClass(wb, key);
        localStorage.setItem(classBlobKey(c.id), JSON.stringify(blob));
        for (const un of [c.eal, c.support]) {
          const usr = auth.users.find((x) => x.username === un);
          if (usr) usr.keyring[c.id] = await CS.wrapKey(key, p1);
        }
        const ix = classIndex();
        ix.push({ id: c.id, name: c.name, school: c.school, eal: c.eal, support: c.support });
        setClassIndex(ix);
        created.push(c.id);
      }
      saveAuth(auth);
      localStorage.setItem(DEMO_KEY, JSON.stringify({ v: 1, users: createdUsers, classes: created, prevMode: prevMode, madeOwner: !hadUsers }));
      try { localStorage.setItem(MODE_KEY, 'class'); } catch (eM) {}
      const res = await doLoginFull(SPRDemo.FET, p1);
      if (res && res.error) { if (err) err.textContent = 'Sign-in after setup failed: ' + res.error; return; }
      closeDlg();
      document.body.classList.remove('auth-gate');
      demoBanner(); buildShell();
      location.hash = '#/classes'; route();
      toast('Demo ready. You are signed in as fet-demo. Sign out and back in as cet-demo to see the assistant teacher side.');
    } catch (eD) {
      if (err) err.textContent = 'Setup failed: ' + (eD && eD.message ? eD.message : eD);
    } finally {
      const b2 = document.querySelector('[data-action="demo-install"]'); if (b2) b2.disabled = false;
    }
  }
  async function demoRemove() {
    const rec = demoRec();
    if (!rec) { toast('No demo data on this device.'); return; }
    const okC = await confirmDlg('Remove the demo data?',
      'This removes the demo classes and the demo sign-in accounts (fet-demo, cet-demo' + (rec.madeOwner ? ', owner-demo' : '') + ') from this device. Real classes and accounts are not touched.',
      'Remove demo');
    if (!okC) return;
    try {
      for (const cid of (rec.classes || [])) {
        try { localStorage.removeItem(classBlobKey(cid)); } catch (eR) {}
        setClassIndex(classIndex().filter((c) => c.id !== cid));
      }
      const auth = getAuth();
      const names = (rec.users || []);
      auth.users = auth.users.filter((u) => names.indexOf(u.username) === -1);
      const wasDemoSession = !!(auth.session && names.indexOf(auth.session.username) !== -1);
      if (wasDemoSession) auth.session = null;
      saveAuth(auth);
      try { localStorage.setItem(MODE_KEY, rec.prevMode === 'class' ? 'class' : 'legacy'); } catch (eM2) {}
      localStorage.removeItem(DEMO_KEY);
      try { localStorage.removeItem('spr-last-class'); } catch (eL) {}
      const b = document.getElementById('demo-banner'); if (b) b.remove();
      if (wasDemoSession) { doLogout(); return; }   /* reloads to the sign-in card */
      CLS = null; CLS_KEY = null; ui.classOpen = false;
      buildShell(); route();
      toast('Demo data removed.');
    } catch (eX) { toast('Could not remove all demo data: ' + (eX && eX.message ? eX.message : eX), true); }
  }

''';
    step('app.js: no DEMO_KEY before', 'DEMO_KEY' not in s)
    s = s.replace(anchor, block + '  async function init() {', 1)

    # 4b. dispatcher entries before do-login
    disp_anchor = "    if (a === 'do-login') {"
    step('app.js: do-login anchor', s.count(disp_anchor) == 1)
    s = s.replace(disp_anchor,
      "    if (a === 'demo-open') { demoOpenDialog(); return; }\n" +
      "    if (a === 'demo-install') { demoInstall(); return; }\n" +
      "    if (a === 'demo-remove') { demoRemove(); return; }\n" + disp_anchor, 1)

    # 4c. login-card link after the show-setup link
    link_anchor = "(cryptoOK() && freshBrowser ? '<div style=\"margin-top:10px\"><button type=\"button\" style=\"background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:13px;text-decoration:underline\" data-action=\"show-setup\">First time using SPR? Set up this browser &rarr;</button></div>' : '') +"
    step('app.js: login-card anchor', link_anchor in s)
    s = s.replace(link_anchor, link_anchor +
      "\n      (cryptoOK() && !demoInstalled() ? '<div style=\"margin-top:6px\"><button type=\"button\" style=\"background:none;border:0;padding:0;color:inherit;opacity:.75;cursor:pointer;font-size:13px;text-decoration:underline\" data-action=\"demo-open\">Just looking? Try the demo classes (dummy students) &rarr;</button></div>' : '') +", 1)

    # 4d. banner on boot
    boot_anchor = "    chartTheme();\n    ensureOwner();"
    step('app.js: boot anchor', boot_anchor in s)
    s = s.replace(boot_anchor, boot_anchor + "\n    demoBanner();", 1)

    wr(p, s)
    step('app.js: DEMO block present after write', 'DEMO_KEY' in rd(p))

print('PATCH', 'COMPLETE' if ok else 'HAD FAILURES')
sys.exit(0 if ok else 1)

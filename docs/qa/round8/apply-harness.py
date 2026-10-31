#!/usr/bin/env python3
"""round8: patch tests/test-device-sync.js — mock knobs (slow/fail save, slow
get), SPR_DS_TRACE flag + console forwarding, and splice in the S12 block.
Run from the repo root AFTER docs/qa/round8/s12-snippet.js exists."""
import io, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
T = ROOT / 'tests' / 'test-device-sync.js'
S = ROOT / 'docs' / 'qa' / 'round8' / 's12-snippet.js'

s = io.open(T, encoding='utf-8').read()
n = 0
def sub(old, new, tag):
    global s, n
    assert s.count(old) == 1, 'anchor not unique (%d): %s' % (s.count(old), tag)
    s = s.replace(old, new); n += 1

# 1) mock knobs ----------------------------------------------------------------
sub("  ' var chan = chanIdFrom(url);' +",
    "  ' var chan = chanIdFrom(url);' +\n"
    "  ' var slow = function (ms, fn) { ms = Number(ms || 0); return ms > 0 ? new Promise(function (r) { setTimeout(r, ms); }).then(fn) : Promise.resolve(fn()); };' +", 'slow helper')

sub("""  ' if (opts.method === "POST") {' +
  '  var b = JSON.parse(opts.body);' +
  '  if (SB[b.id]) return Promise.resolve(H(409));' +
  '  SB[b.id] = { id: b.id, share_name: b.share_name || null, pushed_by: b.pushed_by || null, pushed_at: b.pushed_at, payload: b.payload };' +
  '  return Promise.resolve(H(201));' +
  ' }'""",
    """  ' if (opts.method === "POST") {' +
  '  return slow(window.__SB_SLOW_SAVE, function () {' +
  '   if (window.__SB_FAIL_SAVE === 1) return H(500);' +
  '   var b = JSON.parse(opts.body);' +
  '   if (SB[b.id]) return H(409);' +
  '   SB[b.id] = { id: b.id, share_name: b.share_name || null, pushed_by: b.pushed_by || null, pushed_at: b.pushed_at, payload: b.payload };' +
  '   return H(201);' +
  '  });' +
  ' }'""", 'POST knob')

sub("""  ' if (opts.method === "PATCH") {' +
  '  if (!SB[chan]) return Promise.resolve(H(404));' +
  '  var p = JSON.parse(opts.body); Object.keys(p).forEach(function (k) { SB[chan][k] = p[k]; });' +
  '  return Promise.resolve(H(204));' +
  ' }'""",
    """  ' if (opts.method === "PATCH") {' +
  '  return slow(window.__SB_SLOW_SAVE, function () {' +
  '   if (window.__SB_FAIL_SAVE === 1) return H(500);' +
  '   if (!SB[chan]) return H(404);' +
  '   var p = JSON.parse(opts.body); Object.keys(p).forEach(function (k) { SB[chan][k] = p[k]; });' +
  '   return H(204);' +
  '  });' +
  ' }'""", 'PATCH knob')

sub("  ' return Promise.resolve(H(200, chan && SB[chan] ? [SB[chan]] : []));'",
    "  ' if (!opts.method || opts.method === \"GET\") return slow(window.__SB_SLOW_GET, function () { return H(200, chan && SB[chan] ? [SB[chan]] : []); });'\n"
    "  ' return Promise.resolve(H(200, chan && SB[chan] ? [SB[chan]] : []));'", 'GET knob')

# 2) trace flag in the stub + window id + console forwarding -------------------
sub("    'window.fetch=' + SB_FETCH_SRC + ';' +",
    "  'window.__BOOT=' + (bootId++) + ';'\n"
    "  'window.__SPR_DS_TRACE=' + (process.env.SPR_DS_TRACE === '1' ? 'true' : 'false') + ';'\n"
    "    'window.fetch=' + SB_FETCH_SRC + ';' +", 'stub trace')

sub('function boot(preStorage, preSession) {',
    'let bootId = 0;\nfunction boot(preStorage, preSession) {', 'boot id')

sub("  vc.on('log', () => {});",
    "  vc.on('log', () => {});\n"
    "  const bootNo = bootId;\n"
    "  vc.on('warn', (m) => { if (process.env.SPR_DS_TRACE === '1') process.stdout.write('    [w' + bootNo + ' trace] ' + String(m) + '\\n'); });", 'vc warn')

# 3) splice S12 before the final summary ----------------------------------------
snip = io.open(S, encoding='utf-8').read().rstrip('\n')
old_tail = "  console.log(fails ? ('\\n' + fails + ' FAILURES') : '\\nALL DEVICE-SYNC CHECKS PASSED');"
sub(old_tail, snip + '\n\n' + old_tail, 'S12 splice')

io.open(T, 'w', encoding='utf-8', newline='').write(s)
print('patched OK,', n, 'edits')

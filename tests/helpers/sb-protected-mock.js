// Protected-server Supabase mock for the jsdom sync suites.
// 2026-11-13 (SECURITY-BASELINE C1): the app refuses unprotected cloud writes,
// so the suites must model the server state AFTER the owner runs
// docs/supabase-write-token.sql: the three RPCs exist and write_token_hash is
// honoured. Exported as function source (toString) so test stubs can inject
// it with 'window.fetch=' + mockSrc — no string-escaping layer at all.
function sbProtectedMock(url, opts) {
  url = String(url); opts = opts || {};
  var isWrite = !!opts.method && opts.method !== 'GET';
  /* harness hooks carried over from the pre-protection mock so the retry /
     slowness sections of the suites keep working (R4, S12, slow-network UX) */
  if (isWrite && window.__SB_FAIL_SAVE) return Promise.resolve(H(500, { message: 'mock induced save failure' }));
  var slow = (isWrite && window.__SB_SLOW_SAVE) || (!isWrite && window.__SB_SLOW_GET);
  var go = handleRequest;
  if (slow) { var ms = Number(slow) || 400; go = function (u2, o2) { return new Promise(function (rj) { setTimeout(function () { rj(handleRequest(u2, o2)); }, ms); }); }; }
  try { window.__fetchLog = window.__fetchLog || []; window.__fetchLog.push((opts.method || 'GET') + ' ' + url.slice(-46)); } catch (e) {}
  return go(url, opts);
}
function handleRequest(url, opts) {
  url = String(url); opts = opts || {};
  var SB = window.__SB;
  function b64uToBytes(x) {
    x = String(x || '').replace(/-/g, '+').replace(/_/g, '/');
    while (x.length % 4) x += '=';
    var bin = atob(x); var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function sha256Hex(str) {
    var d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
    return Array.from(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  async function hmacB64u(keyB64u, dataB64u) {
    var k = await crypto.subtle.importKey('raw', b64uToBytes(keyB64u), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    var sig = await crypto.subtle.sign('HMAC', k, b64uToBytes(dataB64u));
    var b = new Uint8Array(sig); var s2 = '';
    for (var i = 0; i < b.length; i++) s2 += String.fromCharCode(b[i]);
    return btoa(s2).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function H(st, body) {
    return { ok: st < 400, status: st, json: function () { return Promise.resolve(body === undefined ? [] : body); } };
  }
  function chanIdFrom(u) {
    var i = u.indexOf('/rest/v1/spr_channels');
    if (i === -1) return undefined;
    var q = u.indexOf('id=eq.', i);
    if (q === -1) return null;
    var e = u.indexOf('&', q);
    return u.slice(q + 6, e === -1 ? u.length : e);
  }
  /* --- the three protection RPCs --- */
  if (url.indexOf('/rpc/spr_channel_write') !== -1) {
    var b = JSON.parse(opts.body || '{}'); var row = SB[b.p_id];
    return (async function () {
      if (!row) {
        SB[b.p_id] = { id: b.p_id, share_name: b.p_share_name || null, pushed_by: b.p_pushed_by, pushed_at: b.p_pushed_at, payload: b.p_payload, write_token_hash: await sha256Hex(b.p_token) };
        return H(200, true);
      }
      if (!row.write_token_hash) return H(400, { message: 'channel has no token enrolled yet' });
      if (row.write_token_hash !== await sha256Hex(b.p_token)) return H(400, { message: 'write token rejected' });
      row.previous = row.payload; row.payload = b.p_payload; row.pushed_by = b.p_pushed_by; row.pushed_at = b.p_pushed_at;
      return H(200, true);
    })();
  }
  if (url.indexOf('/rpc/spr_channel_enrol') !== -1) {
    var b = JSON.parse(opts.body || '{}'); var row = SB[b.p_id];
    return (async function () {
      if (!row) return H(400, { message: 'no such channel' });
      if (!row.payload || !row.payload.ct || !row.payload.mac) return H(400, { message: 'channel has no payload to prove against' });
      var proof = await hmacB64u(b.p_key, row.payload.ct);
      if (proof !== row.payload.mac) return H(400, { message: 'proof rejected' });
      row.write_token_hash = await sha256Hex(b.p_token);
      return H(200, true);
    })();
  }
  if (url.indexOf('/rpc/spr_channel_ping') !== -1) {
    var b = JSON.parse(opts.body || '{}'); var row = SB[b.p_id];
    return (async function () {
      if (!row) return H(200, 'no-row');
      if (!row.write_token_hash) return H(200, 'no-token');
      return H(200, row.write_token_hash === await sha256Hex(b.p_token || '') ? 'ok' : 'bad-token');
    })();
  }
  /* --- table semantics (matching the real policies post-upgrade) --- */
  var chan = chanIdFrom(url);
  if (chan === undefined) return Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
  if (opts.method === 'POST') {
    return Promise.resolve(function () {
      var b = JSON.parse(opts.body);
      if (SB[b.id]) return H(409);
      SB[b.id] = { id: b.id, share_name: b.share_name || null, pushed_by: b.pushed_by || null, pushed_at: b.pushed_at, payload: b.payload, write_token_hash: b.write_token_hash || null };
      return H(201);
    }());
  }
  if (opts.method === 'PATCH') {
    return Promise.resolve(function () {
      if (!SB[chan]) return H(404);
      var p = JSON.parse(opts.body);
      Object.keys(p).forEach(function (k) { SB[chan][k] = p[k]; });
      return H(204);
    }());
  }
  if (opts.method === 'DELETE') { delete SB[chan]; return Promise.resolve(H(204)); }
  return Promise.resolve(H(200, chan && SB[chan] ? [SB[chan]] : []));
}
module.exports = { mockSrc: sbProtectedMock.toString() };

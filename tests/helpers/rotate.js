/* round13 shared test helper: rotation-aware login.
   Accounts created by an admin (and the default-password bootstrap admin)
   have must_change_pw ENFORCED server-side. This helper logs in, completes
   the forced rotation ONCE per username (deterministic suffix 'R'), and
   remembers the effective password so later re-logins in the same suite
   work. Deliberately wrong passwords pass through untouched (they match
   neither the original nor the effective password). */
const EFF = {};

async function login(client, path, username, password) {
  const e = EFF[username];
  const pw = e && (e.orig === password || e.now === password) ? e.now : password;
  const r = await client.req('POST', path, { username, password: pw });
  const body = r.json || r.data || {};
  const user = body.user || (r.body && r.body.user) || null;
  if (r.status === 200 && user && user.must_change_pw) {
    const next = pw + 'R';
    await client.req('POST', path.replace(/auth\/login$/, 'auth/change-password'), { current: pw, next });
    EFF[username] = { orig: password, now: next };
  } else if (r.status === 200) {
    EFF[username] = { orig: password, now: pw };
  }
  return r;
}

function effective(username, fallback) {
  const e = EFF[username];
  return e ? e.now : fallback;
}

module.exports = { login, effective, EFF };

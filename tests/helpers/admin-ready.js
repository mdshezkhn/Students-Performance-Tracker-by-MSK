/* Shared admin-login helper for the server suites (round 13).
   The bootstrap admin created with the DEFAULT password has must_change_pw
   enforced server-side: complete the rotation here and return the EFFECTIVE
   password so later logins in the same suite keep working. */
module.exports = async function adminReady(client, base, pw) {
  const r = await client.req('POST', base + '/api/auth/login', { username: 'admin', password: pw });
  if (!(r.data && r.data.user)) throw new Error('admin login failed: ' + JSON.stringify(r.data));
  if (r.data.user.must_change_pw) {
    const next = 'Spr-Admin-Rotated-9x7';
    const c = await client.req('POST', base + '/api/auth/change-password', { current: pw, next });
    if (c.status !== 200) throw new Error('rotation failed: ' + JSON.stringify(c.data));
    return next;
  }
  return pw;
};

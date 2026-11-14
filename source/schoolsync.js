/* =========================================================================
   SchoolSync — browser client for the SPR school backend (server/spr-server.mjs).
   Node-safe: no DOM. In browser: window.SchoolSync; in node: module.exports.

   STATUS: staging client. The panel in the app is admin-controlled and OFF by
   default; nothing contacts any server until an admin sets the school server
   URL and signs in. When the backend is provisioned in Mainland China this
   module is the production sync path (record-level, versioned, conflict-aware)
   replacing whole-workbook mirroring.

   Security notes:
   - Session = HttpOnly cookie held by the browser (credentials:'include');
     the CSRF token returned by /api/login is kept in memory + storage hook.
   - No keys, tokens or student data ever appear in URLs.
   - The outbox (pending offline changes) is passed to the app's PERSIST hook,
     which seals it with the user's data key exactly like the primary store
     (app.js wires this; in tests it is an in-memory map).
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SchoolSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function create(opts) {
    opts = opts || {};
    const baseUrl = String(opts.baseUrl || '').replace(/\/+$/, '');
    const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch.bind(null) : null);
    /* round11 §5: durability by DEFAULT. A caller that passes nothing gets
       localStorage in a browser — an offline outbox that evaporates on reload
       would silently violate the never-drop-pending-changes rule. In node (no
       localStorage) the no-op stub keeps tests explicit. */
    let persist = opts.persist || null;
    if (!persist) {
      let ls = null;
      try { ls = (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { ls = null; }
      if (ls) {
        persist = {
          get: function (k) { try { const v = ls.getItem('spr-ss-' + k); return v === null ? null : JSON.parse(v); } catch (e) { return null; } },
          set: function (k, v) { try { if (v === null) ls.removeItem('spr-ss-' + k); else ls.setItem('spr-ss-' + k, JSON.stringify(v)); } catch (e) {} }
        };
      } else {
        persist = { get: function () { return null; }, set: function () {} };
      }
    }
    if (!fetchImpl) throw new Error('no fetch implementation available');
    let csrf = persist.get('csrf') || null;
    let me = persist.get('me') || null;

    async function call(method, path, body) {
      const headers = { 'Content-Type': 'application/json' };
      if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
      const res = await fetchImpl(baseUrl + path, {
        method: method,
        credentials: 'include',
        headers: headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      let data = null;
      const txt = await res.text();
      if (txt) { try { data = JSON.parse(txt); } catch (e) { data = { raw: txt }; } }
      if (!res.ok) {
        const err = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
        err.status = res.status;
        err.body = data;
        throw err;
      }
      if (data && data.csrf) { csrf = data.csrf; persist.set('csrf', csrf); }
      return data;
    }

    async function login(username, password) {
      const r = await call('POST', '/api/auth/login', { username: username, password: password });
      me = r.me || r.user || null;
      persist.set('me', me);
      return me;
    }
    function whoami() { return me; }
    async function logout() {
      try { await call('POST', '/api/auth/logout', {}); } catch (e) { /* session may be gone */ }
      me = null; csrf = null; persist.set('me', null); persist.set('csrf', null);
    }

    /* ---------- outbox: durable offline queue (sealed by the persist hook) ---------- */
    function outbox() {
      const ob = persist.get('outbox');
      if (!ob || !ob.q) return { q: [], seq: 0 };
      return { q: ob.q.slice(), seq: ob.seq || 0 };
    }
    function queue(action) {
      /* action: { kind: 'score'|'observation'|'resolve', ... , idem: unique key } */
      if (!action.idem) action.idem = 'idem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      const ob = outbox();
      /* idempotency: never queue two pending actions with the same idem key */
      if (ob.q.some(function (a) { return a.idem === action.idem; })) return action.idem;
      ob.q.push(action); ob.seq += 1;
      persist.set('outbox', ob);
      return action.idem;
    }
    function pendingCount() { return outbox().q.length; }

    /* ---------- push: one record at a time; never last-write-wins ---------- */
    async function flush() {
      const results = { sent: 0, conflicts: [], errors: [] };
      for (;;) {
        const ob = outbox();
        if (!ob.q.length) break;
        const a = ob.q[0];
        try {
          if (a.kind === 'resolve') {
            await call('POST', '/api/records/' + encodeURIComponent(a.payload.id) + '/resolve', a.payload);
          } else {
            await call('POST', '/api/records', a.payload);
          }
          ob.q.shift(); persist.set('outbox', ob);   /* only dequeue on success */
          results.sent += 1;
        } catch (e) {
          if (e.status === 409 && e.body) {
            results.conflicts.push({ idem: a.idem, action: a, server: e.body.server || null, incoming: e.body.incoming || null });
            /* conflicts leave the queue: resolution is an explicit human decision.
               The caller (app) must surface both versions; a queued resolve action
               re-enters via queue({kind:'resolve', payload}). */
            ob.q.shift(); persist.set('outbox', ob);
          } else if (e.status === 401) {
            results.errors.push({ idem: a.idem, reason: 'auth', message: e.message });
            break;   /* stop flushing: re-login required; queue stays intact */
          } else if (e.status === 403) {
            results.errors.push({ idem: a.idem, reason: 'forbidden', message: e.message });
            ob.q.shift(); persist.set('outbox', ob);  /* permission is not transient; drop with record */
          } else {
            results.errors.push({ idem: a.idem, reason: 'network|server', message: e.message });
            break;   /* keep the action queued; retry later */
          }
        }
      }
      return results;
    }

    /* ---------- pull: incremental records for one class (server contract:
       GET /api/classes/<id>/records?since=<iso>) ---------- */
    async function pull(classId, since) {
      return call('GET', '/api/classes/' + encodeURIComponent(classId) + '/records' + (since ? '?since=' + encodeURIComponent(since) : ''));
    }

    return { login: login, logout: logout, whoami: whoami, call: call,
      queue: queue, outbox: outbox, pendingCount: pendingCount, flush: flush, pull: pull };
  }

  return { create: create };
});

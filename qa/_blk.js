
/* SPR offline support: register the service worker and surface updates.
   The banner NEVER auto-reloads — the teacher decides when it is safe. */
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; /* file:// build: no SW, classic offline behaviour */
  var regWaiting = null, reloading = false;
  function showBanner() {
    if (sessionStorage.getItem('spr-update-later') === '1') return;
    if (document.getElementById('sw-update')) return;
    /* A pairing/share link visit needs the NEW app right now — nobody is
       mid-data-entry on a #pair/#join URL. If the browser is still running a
       stale cached shell, update silently and reload instead of showing the
       banner (guarded once per session so it can never loop). */
    if (/^#(pair|join)=/.test(location.hash) && !sessionStorage.getItem('spr-sw-auto')) {
      sessionStorage.setItem('spr-sw-auto', '1');
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!reloading) { reloading = true; location.reload(); }
      });
      if (regWaiting) regWaiting.postMessage('SPR_SKIP_WAITING');
      setTimeout(function () { if (!reloading) location.reload(); }, 2500);
      return;
    }
    var d = document.createElement('div');
    d.id = 'sw-update';
    d.setAttribute('role', 'status');
    d.innerHTML = '<span>A new version of SPR is ready. Reload when you have finished entering marks.</span>' +
      '<button type="button" class="btn sm" id="sw-reload">Reload now</button>' +
      '<button type="button" class="btn sm" id="sw-later">Later</button>';
    document.body.appendChild(d);
    document.getElementById('sw-reload').addEventListener('click', function () {
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!reloading) { reloading = true; location.reload(); }
      });
      if (regWaiting) regWaiting.postMessage('SPR_SKIP_WAITING');
      setTimeout(function () { if (!reloading) location.reload(); }, 2000); /* fallback */
    });
    document.getElementById('sw-later').addEventListener('click', function () {
      sessionStorage.setItem('spr-update-later', '1');
      d.remove();
    });
  }
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (reg) {
    reg.addEventListener('updatefound', function () {
      var nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', function () {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) { regWaiting = reg.waiting; showBanner(); }
      });
    });
    if (reg.waiting && navigator.serviceWorker.controller) { regWaiting = reg.waiting; showBanner(); }
  }).catch(function () { /* the service worker is an enhancement — the app works without it */ });
})();

  /* ---- round9: import the owner's roster sheet (accounts + classes + keys) ---- */
  function rosterImportGo(file) {
    const fr = new FileReader();
    fr.onload = async () => {
      const r = CS.parseSheetCsv(fr.result);
      const school = schoolName();
      const schoolWarn = [];
      for (const c of r.classes) if (c.school && school && c.school !== school) schoolWarn.push(c.name);
      const picks = r.unpicked || [];
      const rowsAcc = r.users.map((u) => '<tr><td>' + U.esc(u.username) + '</td><td>' + U.esc(u.display_name || u.username) + '</td><td>' + U.esc(roleLabel(u.role)) + '</td><td>' + U.esc((u.classes || []).join(', ')) + '</td></tr>').join('');
      const pickRows = picks.length ? '<p class="small" style="margin:8px 0 2px"><b>Who is EAL in each class?</b> The file does not say — pick below. SPR never guesses.</p><div class="sheet" style="max-height:200px;overflow:auto"><table class="tbl"><thead><tr><th>Class</th><th>EAL / Supporting</th></tr></thead><tbody>' +
        picks.map((c, i) => {
          const members = (r.users.filter((u) => (u.classes || []).indexOf(c) !== -1).map((u) => u.username));
          const opts = members.map((m) => '<option value="' + U.esc(m) + '">' + U.esc(m) + '</option>').join('');
          return '<tr><td>' + U.esc(c) + '</td><td><label>EAL <select class="inp" data-rolepick="' + U.esc(c) + '" data-slot="eal"><option value="">(pick)</option>' + opts + '</select></label> <label>Supporting <select class="inp" data-rolepick="' + U.esc(c) + '" data-slot="support"><option value="">(pick)</option>' + opts + '</select></label></td></tr>';
        }).join('') + '</tbody></table></div>' : '';
      openDlg(
        '<h3>Import roster sheet: ' + r.users.length + ' account(s), ' + r.classes.length + ' class(es)</h3>' +
        (r.errors.length ? '<div class="login-err">' + r.errors.map((e) => U.esc(e)).join('<br>') + '</div>' : '') +
        (schoolWarn.length ? '<p class="small">School column differs from the Manage &amp; setup school setting ("' + U.esc(school) + '"): ' + U.esc(schoolWarn.join(', ')) + '. Imported anyway.</p>' : '') +
        '<div class="sheet" style="max-height:220px;overflow:auto"><table class="tbl"><thead><tr><th>username</th><th>display name</th><th>role</th><th>classes</th></tr></thead><tbody>' + rowsAcc + '</tbody></table></div>' +
        pickRows +
        '<p class="small">Check every class pair. Where the file says who is EAL it is pre-filled; otherwise pick — SPR never guesses. New accounts get a one-time password.</p>' +
        '<div class="dlg-actions"><button class="btn" data-x="0">Cancel</button><button class="btn primary" data-x="1"' + ((r.errors.length || picks.length) ? ' disabled' : '') + '>Import</button></div>',
        function (d) {
          const apply = () => {
            /* decisions: class -> {eal, support} from pickers where the file was silent */
            const decided = {};
            d.querySelectorAll('select[data-rolepick]').forEach((sel) => {
              const c = sel.getAttribute('data-rolepick'), slot = sel.getAttribute('data-slot');
              if (!decided[c]) decided[c] = {};
              if (sel.value) decided[c][slot] = sel.value;
            });
            const stillOpen = picks.filter((c) => { const dd = decided[c] || {}; return !dd.eal || !dd.support; });
            if (stillOpen.length) { toast('Pick EAL and Supporting for: ' + stillOpen.join(', '), true); return; }
            applySheetImport(r, decided);
          };
          d.onclick = async (e) => {
            const b = e.target.closest('[data-x]');
            if (!b) return;
            if (b.getAttribute('data-x') === '0') { closeDlg(); return; }
            if (b.disabled) return;
            apply();
          };
          d.addEventListener('change', (e) => {
            /* enable Apply once every pick is made */
            const btn = d.querySelector('[data-x="1"]');
            if (!btn || !picks.length) return;
            const sels = Array.from(d.querySelectorAll('select[data-rolepick]'));
            btn.disabled = sels.some((sel) => !sel.value);
          });
        });
    };
    fr.readAsText(file);
  }

  async function applySheetImport(r, decided) {
    if (!SESSION.pw) { closeDlg(); toast('Sign in again, then import once more: the key wrapping needs your password in memory.', true); return; }
    const auth0 = getAuth();
    const fresh = {};
    const grant = {};   /* username -> [{id, key}] to wrap at the end */
    const need = {};    /* username -> class count (keys awaiting their wrap) */
    const rekeys = [];
    const ix = classIndex();
    const school = schoolName();
    /* ---- accounts (skip existing; password only for new) ---- */
    for (const u of r.users) {
      const un = String(u.username || '').trim();
      if (auth0.users.some((x) => String(x.username).toLowerCase() === un.toLowerCase())) continue;
      const pw = CS.genPassword();
      const err = await addUser(un, pw, u.display_name || un, u.role);
      if (err) { toast(un + ': ' + err, true); continue; }
      fresh[un] = pw;
    }
    /* ---- classes ---- */
    for (const c of r.classes) {
      let row = ix.find((x) => x.name === c.name);
      if (row) {
        /* existing class: merge assignments, rekey if someone lost access */
        const before = [row.eal, row.support].filter(Boolean);
        const dec = decided[c.name] || {};
        const eal = c.teachers.find((t) => t.class_role === 'eal') || (dec.eal ? { username: dec.eal, class_role: 'eal' } : null);
        const sup = c.teachers.find((t) => t.class_role === 'support') || (dec.support ? { username: dec.support, class_role: 'support' } : null);
        const ealUn = eal ? eal.username : row.eal;
        const supUn = sup ? sup.username : row.support;
        if ((row.eal || '') !== (ealUn || '') || (row.support || '') !== (supUn || '')) {
          const removed = before.filter((x) => x !== ealUn && x !== supUn);
          if (removed.length) { rekeys.push({ id: row.id, keep: [ealUn, supUn].filter(Boolean) }); }
          const key = (SESSION.keys || {})[row.id];
          if (key) {
            try {
              const wb = await CS.openClass(JSON.parse(localStorage.getItem(classBlobKey(row.id))), key);
              wb.eal = ealUn || ''; wb.support = supUn || '';
              localStorage.setItem(classBlobKey(row.id), JSON.stringify(await CS.sealClass(wb, key)));
            } catch (e2) {}
          }
          row.eal = ealUn || ''; row.support = supUn || '';
          for (const h of [ealUn, supUn]) if (h) { (grant[h] = grant[h] || []).push({ id: row.id, key: key }); need[h] = (need[h] || 0) + 1; }
        }
        continue;
      }
      /* new class */
      const dec = decided[c.name] || {};
      const eal = (c.teachers.find((t) => t.class_role === 'eal') || {}).username || dec.eal || '';
      const sup = (c.teachers.find((t) => t.class_role === 'support') || {}).username || dec.support || '';
      const cid = 'c-' + String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) + '-' + Math.random().toString(36).slice(2, 6);
      const key = CS.genKey();
      const wb = { sprClass: 1, id: cid, name: c.name, school: c.school || school || '', eal: eal, support: sup, settings: Object.assign({ autoTotal: true, spTotal: 20, daTotal: 10 }, (DB && DB.settings) || {}), currentSemesterId: null, semesters: [], pending: [], audit: [] };
      CS.logAudit(wb, { by: myUser() ? myUser().username : '', action: 'create', note: 'created from roster sheet import' });
      localStorage.setItem(classBlobKey(cid), JSON.stringify(await CS.sealClass(wb, key)));
      ix.push({ id: cid, name: c.name, school: c.school || school || '', eal: eal, support: sup, createdAt: Date.now(), updatedAt: Date.now(), pendingCount: 0, studentCount: 0 });
      SESSION.keys[cid] = key; classKeysToSession();
      for (const h of [eal, sup]) if (h) { (grant[h] = grant[h] || []).push({ id: cid, key: key }); need[h] = (need[h] || 0) + 1; }
    }
    /* ONE password rotation per teacher, then wrap every key under it */
    for (const un of Object.keys(need)) {
      let pwG = un === SESSION.user ? SESSION.pw : null;
      if (!pwG) { pwG = fresh[un] || CS.genPassword(); if (!fresh[un]) fresh[un] = pwG; const rErr = await rotateUserPassword(un, pwG); if (rErr) { toast(un + ': ' + rErr, true); continue; } }
      const authG = getAuth();
      const ug = authG.users.find((x) => x.username === un);
      if (!ug) continue;
      ug.keyring = ug.keyring || {};
      for (const g of (grant[un] || [])) { try { ug.keyring[g.id] = await CS.wrapKey(g.key, pwG); } catch (e4) {} }
      saveAuth(authG);
    }
    setClassIndex(ix);
    if (sprMode() !== 'class') { try { localStorage.setItem(MODE_KEY, 'class'); } catch (eM) {} }
    for (const rk of rekeys) await rekeyClass(rk.id, rk.keep);
    closeDlg();
    if (Object.keys(fresh).length) passwordsOnceDialog(fresh, 'Accounts created: passwords (shown once)');
    else toast('Roster sheet imported: ' + r.classes.length + ' class(es) ready.');
    renderUsers(); if (typeof renderClasses === 'function') renderClasses();
  }

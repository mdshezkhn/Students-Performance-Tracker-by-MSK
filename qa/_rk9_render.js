  function renderUsers() {
    const f = ui.usersView || (ui.usersView = { q: '', role: 'all', cls: 'all', status: 'all', view: 'sheet' });
    const q = f.q.trim().toLowerCase();
    const ix = classIndex();
    const mine = (un) => ix.filter((c) => c.eal === un || c.support === un);
    const tabBtn = (v, label) => '<button class="btn sm' + (f.view === v ? ' primary' : '') + '" data-action="users-view" data-view="' + v + '" style="margin-right:6px">' + label + '</button>';
    const filters = '<div class="sheet-toolbar no-print"><div class="flex" style="flex-wrap:wrap;gap:10px;align-items:center">' +
        '<label>Search <input class="inp" id="usersQ" placeholder="Name, username or partner…" value="' + U.esc(f.q) + '"></label>' +
        '<label>Role <select class="inp" id="usersRole">' + [['all', 'All roles'], ['admin', 'Admin'], ['manager', 'Manager'], ['eal', 'Teacher']].map((o) => '<option value="' + o[0] + '"' + (f.role === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
        '<label>Class <select class="inp" id="usersClass"><option value="all">All classes</option>' + ix.map((c) => c.name).sort().map((n) => '<option value="' + U.esc(n) + '"' + (f.cls === n ? ' selected' : '') + '>' + U.esc(n) + '</option>').join('') + '</select></label>' +
        '<label>Status <select class="inp" id="usersStatus">' + [['all', 'All'], ['active', 'Active'], ['disabled', 'Disabled']].map((o) => '<option value="' + o[0] + '"' + (f.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
        '<button class="btn" data-action="users-csv">Download list (CSV)</button>' +
        '<button class="btn" data-action="acct-add-open">Add account</button>' +
        '<button class="btn" data-action="class-roster-btn">Import roster CSV</button>' +
      '</div></div>';
    let body = '';
    if (f.view === 'byclass') {
      body = filters + '<div class="sheet"><table class="tbl"><thead><tr><th scope="col">Class</th><th scope="col">EAL teacher</th><th scope="col">Supporting teacher</th><th scope="col" class="num">Students</th></tr></thead><tbody>' +
        ix.slice().sort((a, b) => a.name < b.name ? -1 : 1).map((c) => {
          const btn = (un, slot) => '<button class="btn sm" data-action="class-pair-open" data-pair="' + U.esc(c.name) + '" title="Change the ' + slot + ' teacher">' + U.esc(un || '(none)') + '</button>';
          return '<tr><td><b>' + U.esc(c.name) + '</b></td><td>' + btn(c.eal, 'EAL') + '</td><td>' + btn(c.support, 'supporting') + '</td><td class="num">' + (c.studentCount || 0) + '</td></tr>';
        }).join('') + '</tbody></table><p class="small muted" style="margin-top:8px">Click a teacher cell to change the assignment. One EAL + one supporting teacher per class; assigning a teacher gives them this class&rsquo;s key, removing it rotates the key.</p></div>';
    } else {
      const all = usersSheetRows().filter((r) => {
        if (f.role !== 'all' && classRole(r.u.role) !== f.role) return false;
        if (f.cls !== 'all' && mine(r.u.username).every((c) => c.name !== f.cls)) return false;
        if (f.status === 'active' && r.u.disabled) return false;
        if (f.status === 'disabled' && !r.u.disabled) return false;
        if (q && !((r.u.username + ' ' + (r.u.name || '') + ' ' + r.partner).toLowerCase().includes(q))) return false;
        return true;
      });
      const cell = (v) => U.esc(v || '—');
      body = filters + '<div class="sheet" id="usersSheet"><table class="tbl"><thead><tr>' +
        '<th scope="col">username</th><th scope="col">display name</th><th scope="col">role</th><th scope="col">class or grade</th><th scope="col">School</th><th scope="col">paired with</th><th scope="col">status</th>' +
        '</tr></thead><tbody>' + all.map((r) =>
          '<tr><td>' + U.esc(r.u.username) + '</td><td>' + U.esc(r.u.name || r.u.username) + '</td><td>' + U.esc(roleLabel(r.u.role)) + '</td><td>' + cell(r.classes) + '</td><td>' + cell(r.school) + '</td><td>' + cell(r.partner) + '</td><td>' + (r.u.disabled ? 'Disabled' : 'Active') + '</td></tr>'
        ).join('') + '</tbody></table></div>' +
        '<p class="small muted" style="margin-top:8px">Accounts on this device. A teacher sees exactly the classes assigned to them; the partner column is derived from the class assignments.</p>';
    }
    const host = $('#app');
    host.innerHTML = '<div class="app"><main class="page" style="max-width:1080px;margin:0 auto;width:100%">' +
      '<header class="page-head"><div><h1>Users</h1><div class="sub">who can sign in on this device, and which classes they see</div></div>' +
      '<div class="actions"><button class="btn" data-action="go-back">Back</button></div></header>' +
      '<div class="tabs" style="margin:12px 0">' + tabBtn('sheet', 'Sheet') + tabBtn('byclass', 'By class') + '</div>' + body + '</main></div>';
    window.scrollTo(0, 0);
  }

  function schoolName() {
    try { return (JSON.parse(localStorage.getItem('spr-auth-v1') || '{}').settings || {}).school || null; } catch (e) { return null; }
  }
  /* ---- round9: one row per (person, partner) — pairing derived from classes ---- */
  function usersSheetRows() {
    const users = getAuth().users, ix = classIndex();
    const school = schoolName() || 'All';
    const rows = [];
    for (const u of users) {
      const r = classRole(u.role);
      if (r === 'admin' || r === 'manager') { rows.push({ u: u, classes: 'All classes', school: 'All', partner: '', classRole: '' }); continue; }
      const mine = ix.filter((c) => c.eal === u.username || c.support === u.username);
      if (!mine.length) { rows.push({ u: u, classes: '', school: school, partner: '', classRole: '' }); continue; }
      const byP = new Map();
      for (const c of mine) {
        const p = (c.eal === u.username ? c.support : c.eal) || '';
        if (!byP.has(p)) byP.set(p, []);
        byP.get(p).push(c);
      }
      for (const [p, cs] of byP) {
        const roles = cs.map((c) => (c.eal === u.username ? 'eal' : 'support'));
        const cr = roles.every((x) => x === roles[0]) ? roles[0] : '';
        rows.push({ u: u, classes: cs.map((c) => c.name).sort().join(', '), school: school, partner: p, classRole: cr });
      }
    }
    return rows;
  }

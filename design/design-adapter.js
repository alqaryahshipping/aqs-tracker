/* AQS Tracker — DESIGN COPY adapter.
 * Same API as sb-adapter.js (window.SB + window.claude.use('db'|'user'|'downloads')), but backed by an
 * in-browser copy of the data (seed.json, a tracker backup) instead of Supabase. Nothing here reaches the
 * live database. Edits are kept in this browser (localStorage) until "Reset data".
 * It mirrors the live database rules that matter for screens: add never overwrites (create-only),
 * unique VIN / Lot # / carrier name / customer name / vessel + voyage no., unknown customer or voyage refused,
 * delete refused while other records use it, Rates Owner-only, and a change log for History / Deleted records.
 */
(function () {
  'use strict';
  const STORE_KEY = 'aqs-design-copy-v1';
  const ROLE_KEY = 'aqs-design-role';
  const BUSINESS = ['vehicles', 'containers', 'voyages', 'customers', 'carriers', 'pickups', 'declarations', 'rates'];
  const KEYFIELD = { vehicles: 'vin', containers: 'container', pickups: 'pid' };
  const LABEL = { vehicles: 'VIN', containers: 'Container', voyages: 'Voyage', customers: 'Customer', carriers: 'Carrier', pickups: 'Pickup location', declarations: 'Declaration', rates: 'Rate' };
  const safe = (f, d) => { try { return f(); } catch (_) { return d; } };
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const err = (code, message) => Object.assign(new Error(message), { code });

  let role = safe(() => localStorage.getItem(ROLE_KEY), null) === 'staff' ? 'staff' : 'owner';
  const ME = role === 'owner'
    ? { user_id: 'design-owner', email: 'idres.ahmad@alqaryahshipping.com', name: 'Idres Ahmad (design copy)', role: 'owner', active: true }
    : { user_id: 'design-staff', email: 'salman.mandal@alqaryahshipping.com', name: 'Salman (design copy)', role: 'staff', active: true };

  // ---------- data ----------
  let D = null;           // { cols: {collection: {id: data}}, log: [], seq, seededAt }
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => safe(() => localStorage.setItem(STORE_KEY, JSON.stringify(D))), 300); };
  const col = (name) => (D.cols[name] = D.cols[name] || {});
  async function load() {
    const kept = safe(() => JSON.parse(localStorage.getItem(STORE_KEY) || 'null'), null);
    if (kept && kept.cols) { D = kept; return; }
    const res = await fetch('seed.json', { cache: 'no-store' });
    const seed = await res.json();
    D = { cols: {}, log: [], seq: 0, seededAt: (seed._meta && seed._meta.at) || null };
    for (const [k, v] of Object.entries(seed)) if (k !== '_meta' && v && typeof v === 'object') D.cols[k] = v;
    save();
  }
  const ready = load();

  // ---------- change log (History, Deleted records) ----------
  function logIt(table, id, action, before, after) {
    let changes;
    if (action === 'update') {
      changes = {};
      for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
        if (k === 'updatedAt' || k === 'createdAt') continue;
        if (JSON.stringify((before || {})[k] ?? null) !== JSON.stringify((after || {})[k] ?? null)) changes[k] = [(before || {})[k] ?? null, (after || {})[k] ?? null];
      }
      if (!Object.keys(changes).length) return;
    } else changes = clone(action === 'delete' ? before : after);
    D.log.push({ id: ++D.seq, at: new Date().toISOString(), table, record_id: String(id), action, who: ME.name, changes });
  }

  // ---------- live updates ----------
  const listeners = new Map();
  const notify = (c) => { const s = listeners.get(c); if (s) s.forEach((fn) => fn()); };
  const listen = (c, fn) => { if (!listeners.has(c)) listeners.set(c, new Set()); listeners.get(c).add(fn); return () => listeners.get(c).delete(fn); };

  // ---------- rules (same as the live database) ----------
  const norm = (s) => String(s ?? '').trim();
  const voyKey = (v, n) => norm(v) && norm(n) ? norm(v).toUpperCase().replace(/[\s\-_./]/g, '') + '|' + norm(n).toUpperCase().replace(/[\s\-_./]/g, '') : '';
  function canRead(c) { if (c === 'rates' && ME.role !== 'owner') throw err('permission_denied', 'permission denied'); }
  function checkRules(c, id, rec, prev) {
    const all = col(c);
    const others = Object.entries(all).filter(([k]) => k !== id).map(([, v]) => v);
    if (c === 'vehicles') {
      if (rec.customer_id && !col('customers')[rec.customer_id]) throw err('failed_precondition', `Unknown customer: ${rec.customer_id}`);
      if (rec.container && !col('containers')[rec.container]) throw err('failed_precondition', `Unknown container: ${rec.container}`);
      const lot = norm(rec.tw_lot).toUpperCase();
      if (lot && others.some((v) => norm(v.tw_lot).toUpperCase() === lot)) throw err('already_exists', `Lot # ${rec.tw_lot} is already used by another car.`);
    }
    if (c === 'containers') {
      if (rec.voyage_id && !col('voyages')[rec.voyage_id]) throw err('failed_precondition', `Unknown voyage: ${rec.voyage_id}`);
      if (rec.customer_id && !col('customers')[rec.customer_id]) throw err('failed_precondition', `Unknown customer: ${rec.customer_id}`);
    }
    if (c === 'voyages') {
      const k = voyKey(rec.vessel, rec.voyage_no);
      if (k && (!prev || k !== voyKey(prev.vessel, prev.voyage_no))) {
        const o = Object.entries(all).find(([kk, v]) => kk !== id && voyKey(v.vessel, v.voyage_no) === k);
        if (o) throw err('already_exists', `Voyage ${o[1].vessel} ${o[1].voyage_no} already exists (${o[0]}, ETD ${o[1].etd || '?'}, ${o[1].pod || '?'}). Pick it instead of creating a duplicate.`);
      }
    }
    if (c === 'carriers' && others.some((v) => norm(v.name).toLowerCase() === norm(rec.name).toLowerCase())) throw err('already_exists', `A carrier named "${rec.name}" already exists. Pick it instead.`);
    if (c === 'customers' && others.some((v) => norm(v.name).toLowerCase() === norm(rec.name).toLowerCase())) throw err('already_exists', `A customer named "${rec.name}" already exists.`);
    for (const [k, v] of Object.entries(rec)) {
      if (v && typeof v === 'string' && /(^|_)(date|paid|posted|eta|etd|picked|booked|courier|recv|applied|checked|cpaid|pick_plan|arrived|purchased)$/.test(k) && !/^\d{4}-\d{2}-\d{2}/.test(v) && !/^tw_(pickup|title)/.test(k))
        throw err('failed_precondition', `${k} is not a valid date: ${v}`);
    }
  }
  function checkDelete(c, id) {
    const used = (cc, f) => Object.values(col(cc)).some((v) => v[f] === id);
    if (c === 'customers' && (used('vehicles', 'customer_id') || used('containers', 'customer_id'))) throw err('failed_precondition', "Can't delete: it is still used by vehicle or container records. Move or remove those first.");
    if (c === 'voyages' && used('containers', 'voyage_id')) throw err('failed_precondition', "Can't delete: it is still used by container records. Move or remove those first.");
  }

  // ---------- db API (same shape the page uses) ----------
  const docSnap = (id, data) => ({ id, exists: data !== undefined, data: () => clone(data), ref: null });
  const querySnap = (rows) => { const docs = rows.map(([id, d]) => ({ id, exists: true, data: () => clone(d) })); return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }; };
  const isEmpty = (v) => v === undefined || v === null || v === '';
  function match(d, [f, op, val]) {
    const v = d[f];
    if (val === null && op === '==') return isEmpty(v);
    if (val === null && op === '!=') return !isEmpty(v);
    switch (op) {
      case '==': return v === val || String(v) === String(val);
      case '!=': return String(v) !== String(val);
      case '<': return v < val; case '<=': return v <= val; case '>': return v > val; case '>=': return v >= val;
      case 'in': return val.map(String).includes(String(v));
      case 'not-in': return isEmpty(v) || !val.map(String).includes(String(v));   // empty included, as on live
      default: throw err('failed_precondition', 'Unsupported operator ' + op);
    }
  }
  function splitPath(path) {
    const p = String(path).split('/').filter(Boolean);
    if (p[0] === 'data' && p[1] === 'users' && p.length === 4) return ['user:' + p[2], p[3]];
    return p;
  }
  function snapshotOf(get, c, cb, errCb) {
    let alive = true, t;
    const run = () => get().then((s) => { if (alive) cb(s); }, (e) => { if (alive && errCb) errCb(e); });
    const off = listen(c, () => { clearTimeout(t); t = setTimeout(run, 60); });
    run();
    return () => { alive = false; off(); };
  }
  function makeQuery(c, filters, lim) {
    const q = {
      where: (f, op, v) => makeQuery(c, filters.concat([[f, op, v]]), lim),
      limit: (n) => makeQuery(c, filters, n),
      doc: (id) => makeDoc(c, id),
      async get() { await ready; canRead(c); return querySnap(Object.entries(col(c)).filter(([, d]) => filters.every((f) => match(d, f))).slice(0, Math.min(lim || 1000, 1000))); },
      onSnapshot: (cb, e) => snapshotOf(q.get, c, cb, e),
    };
    return q;
  }
  function makeDoc(c, id) {
    id = String(id);
    const biz = BUSINESS.includes(c);
    const d = {
      id,
      async get() { await ready; canRead(c); return docSnap(id, col(c)[id]); },
      async set(obj) {
        await ready; canRead(c);
        const rec = clone(obj || {});
        if (biz) {
          if (col(c)[id]) throw err('already_exists', `${LABEL[c] || c} ${id} already exists in the tracker. Search for it and edit that record instead.`);
          checkRules(c, id, rec, null);
          col(c)[id] = rec; logIt(c, id, 'insert', null, rec);
        } else col(c)[id] = rec;
        save(); notify(c);
      },
      async update(patch) {
        await ready; canRead(c);
        const cur = col(c)[id];
        if (!cur) throw err('not_found', 'not_found: ' + id);
        const next = Object.assign(clone(cur), clone(patch || {}));
        for (const [k, v] of Object.entries(patch || {})) if (v === null || v === undefined) delete next[k];
        if (biz) checkRules(c, id, next, cur);
        col(c)[id] = next;
        if (biz) logIt(c, id, 'update', cur, next);
        save(); notify(c);
      },
      async delete() {
        await ready; canRead(c);
        const cur = col(c)[id];
        if (!cur) return;
        if (biz) {
          checkDelete(c, id);
          if (c === 'containers') for (const [vin, v] of Object.entries(col('vehicles'))) if (v.container === id) { const b = clone(v); v.container = null; logIt('vehicles', vin, 'update', b, v); }
          logIt(c, id, 'delete', cur, null);
        }
        delete col(c)[id];
        save(); notify(c); if (c === 'containers') notify('vehicles');
      },
      onSnapshot: (cb, e) => snapshotOf(d.get, c, cb, e),
    };
    return d;
  }
  const db = {
    collection: (name) => makeQuery(String(name), [], null),
    doc: (path) => { const [c, i] = splitPath(path); return makeDoc(c, i); },
  };

  // ---------- History / Deleted records / restore ----------
  const TABLE_TO_COL = { vehicles: 'vehicles', containers: 'containers', voyages: 'voyages', customers: 'customers', carriers: 'carriers', pickups: 'pickups', declarations: 'declarations', rates: 'rates' };
  async function history(table, id) {
    await ready;
    if (table === 'rates' && ME.role !== 'owner') throw err('permission_denied', 'permission denied');
    return D.log.filter((e) => e.table === table && e.record_id === String(id)).slice().reverse().slice(0, 300)
      .map((e) => ({ at: e.at, action: e.action, who: e.who, changes: e.changes }));
  }
  async function deletedRecords() {
    await ready;
    if (ME.role !== 'owner') throw err('permission_denied', 'permission denied');
    return D.log.filter((e) => e.action === 'delete').slice().reverse().map((e) => {
      const r = D.log.find((x) => x.id > e.id && x.action === 'insert' && x.table === e.table && x.record_id === e.record_id);
      return { audit_id: e.id, at: e.at, table_name: e.table, record_id: e.record_id, who: e.who, record: e.changes, restored_at: r ? r.at : null, restored_by: r ? r.who : null };
    });
  }
  async function restoreDeleted(auditId) {
    await ready;
    if (ME.role !== 'owner') throw err('permission_denied', 'Only an Owner can restore records.');
    const e = D.log.find((x) => x.id === auditId && x.action === 'delete');
    if (!e) throw err('not_found', 'This deletion was not found.');
    const c = TABLE_TO_COL[e.table];
    if (col(c)[e.record_id]) throw err('already_exists', `${e.record_id} is already in the tracker (restored or added again).`);
    checkRules(c, e.record_id, e.changes, null);
    col(c)[e.record_id] = clone(e.changes); logIt(c, e.record_id, 'insert', null, e.changes);
    save(); notify(c);
    return e.record_id;
  }
  async function restore(backup, onProgress) {
    await ready;
    let done = 0;
    for (const [k, v] of Object.entries(backup || {})) if (k !== '_meta' && v && typeof v === 'object') { D.cols[k] = Object.assign(col(k), clone(v)); done += Object.keys(v).length; notify(k); if (onProgress) onProgress(done, 0, done); }
    save();
    return { done, failed: 0, errors: [] };
  }

  // ---------- users (sample list; changes stay in this copy) ----------
  let USERS = [
    { user_id: 'design-owner', email: 'idres.ahmad@alqaryahshipping.com', name: 'Idres Ahmad', role: 'owner', active: true },
    { user_id: 'u-bashir', email: 'bashir.ahmed@alqaryahshipping.com', name: 'Bashir', role: 'owner', active: true },
    { user_id: 'design-staff', email: 'salman.mandal@alqaryahshipping.com', name: 'Salman', role: 'staff', active: true },
    { user_id: 'u-faisal', email: 'mohammad.faisal@alqaryahshipping.com', name: 'Faisal', role: 'staff', active: true },
    { user_id: 'u-zahoor', email: 'zahoor.islam@alqaryahshipping.com', name: 'Zahoor', role: 'staff', active: true },
    { user_id: 'u-imran', email: 'imranhayat@alqaryahshipping.com', name: 'Imran', role: 'staff', active: true },
  ];

  const SB = {
    client: null, state: 'checking', session: { user: { id: ME.user_id } }, profile: ME, _waiters: [],
    design: true,
    shortName: (e) => String(e || '').replace('@aqs-tracker.local', ''),
    restore, history, deletedRecords, restoreDeleted,
    async refresh() { await ready; SB.state = 'ok'; const w = SB._waiters.splice(0); w.forEach((f) => f()); return SB.state; },
    whenSignedIn() { return SB.state === 'ok' ? Promise.resolve() : new Promise((r) => SB._waiters.push(r)); },
    async signIn() { return SB.refresh(); },
    async signOut() { setRole(role === 'owner' ? 'staff' : 'owner'); },
    async changePassword() {},
    async admin(action, body) {
      if (ME.role !== 'owner') throw err('permission_denied', 'Only an Owner can manage users.');
      if (action === 'list') return { users: USERS.map((u) => ({ ...u, last_sign_in_at: null, created_at: null })) };
      if (action === 'create') { USERS.push({ user_id: 'u-' + Date.now(), email: body.email, name: body.name || body.email, role: body.role || 'staff', active: true }); return { ok: true }; }
      if (action === 'update') { const u = USERS.find((x) => x.user_id === body.user_id); if (u) Object.assign(u, body.role ? { role: body.role } : {}, body.active !== undefined ? { active: !!body.active } : {}); return { ok: true }; }
      return { ok: true };
    },
    async bootstrap() { return SB.refresh(); },
  };
  window.SB = SB;
  // claude.ai owns (and locks) window.claude on this page, so the design copy is reached as window.AQS_RT
  // (design/build.py points the tracker's calls there). Never assign window.claude here.
  window.AQS_RT = {
    use: async (name) => {
      if (name === 'db') { await SB.whenSignedIn(); return db; }
      if (name === 'user') { await SB.whenSignedIn(); return { can: async () => true, canEdit: async () => ME.role === 'owner', id: async () => ME.user_id }; }
      if (name === 'downloads') return { async save() { toastBar('Downloads are switched off in the design copy.'); } };
      return null;
    },
  };

  // ---------- design-copy bar: role switch + reset ----------
  function setRole(r) { safe(() => localStorage.setItem(ROLE_KEY, r)); location.reload(); }
  function toastBar(t) { const n = document.getElementById('dc-note'); if (n) { n.textContent = t; setTimeout(() => { n.textContent = ''; }, 4000); } }
  function bar() {
    const css = document.createElement('style');
    css.textContent = `.dc-bar{position:fixed;z-index:60;left:max(12px,env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;max-width:calc(100vw - 24px);padding:7px 10px;border-radius:10px;border:1.5px dashed var(--warn);background:var(--panel);color:var(--fg);font:12.5px var(--sans);box-shadow:0 6px 20px rgb(0 0 0 / .14)}
.dc-bar b{color:var(--warn);letter-spacing:.04em;text-transform:uppercase;font-size:11.5px}.dc-bar select,.dc-bar button{font:inherit;font-size:12px;padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel-2);color:var(--fg);cursor:pointer}
.dc-bar button.is-armed{background:var(--bad);border-color:var(--bad);color:#fff}.dc-bar span{color:var(--muted)}`;
    document.head.append(css);
    const el = document.createElement('div');
    el.className = 'dc-bar'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Design copy');
    const when = D && D.seededAt ? new Date(D.seededAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    el.innerHTML = `<b>Design copy</b><span>Not live data${when ? ' · copy of ' + when : ''}</span>
      <label><span>View as </span><select id="dc-role" aria-label="View as"><option value="owner">Owner</option><option value="staff">Staff</option></select></label>
      <button type="button" id="dc-reset">Reset data</button><span id="dc-note" aria-live="polite"></span>`;
    document.body.append(el);
    const sel = el.querySelector('#dc-role'); sel.value = role; sel.onchange = () => setRole(sel.value);
    const rb = el.querySelector('#dc-reset'); let armed = false;
    rb.onclick = () => { if (!armed) { armed = true; rb.classList.add('is-armed'); rb.textContent = 'Click again: discard my edits'; return; } safe(() => localStorage.removeItem(STORE_KEY)); location.reload(); };
  }
  const whenDom = (f) => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', f); else f(); };
  ready.then(() => whenDom(bar), (e) => whenDom(() => {
    // the data copy could not be read: say so plainly instead of leaving the page empty
    bar(); const n = document.getElementById('dc-note');
    if (n) n.textContent = 'Could not load the data copy (' + (e && e.message ? e.message : e) + ').';
  }));
})();

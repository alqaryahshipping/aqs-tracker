/* AQS Tracker — Supabase adapter (relational tables).
 * Gives the tracker the same small database API it used on claude.ai
 * (collection / doc / where / limit / get / set / update / delete / onSnapshot),
 * backed by typed tables: vehicles, containers, voyages, customers, carriers (+ carrier_drivers),
 * pickups, declarations, rates, app_settings (settings/<key>) and user_data (data/users/<uid>/<key>).
 * Writes go through public.rec_write (type checks, unknown fields kept in `extra`, change history).
 * Also provides login (Supabase Auth), the signed-in user's role, downloads and backup restore.
 */
(function () {
  'use strict';
  const CFG = window.AQS_CONFIG || {};
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aqs-tracker-auth' } });
  const LOGIN_DOMAIN = '@aqs-tracker.local';
  const toEmail = (u) => { u = String(u || '').trim().toLowerCase(); return u.includes('@') ? u : u.replace(/[^a-z0-9._-]/g, '') + LOGIN_DOMAIN; };
  const shortName = (e) => String(e || '').replace(LOGIN_DOMAIN, '');

  // ---------- app collection -> table ----------
  // keyInData: the app's record also carries its key as a field (vin, container, pid).
  const T = {
    vehicles:     { t: 'vehicles',     k: 'vin',       keyInData: true,  label: 'vehicle' },
    containers:   { t: 'containers',   k: 'container', keyInData: true,  label: 'container' },
    pickups:      { t: 'pickups',      k: 'pid',       keyInData: true,  label: 'pickup location' },
    customers:    { t: 'customers',    k: 'id',        keyInData: false, label: 'customer' },
    voyages:      { t: 'voyages',      k: 'id',        keyInData: false, label: 'voyage' },
    declarations: { t: 'declarations', k: 'id',        keyInData: false, label: 'declaration' },
    carriers:     { t: 'carriers',     k: 'id',        keyInData: false, label: 'carrier', select: '*, carrier_drivers(*)' },
    rates:        { t: 'rates',        k: 'id',        keyInData: false, label: 'rate' },
  };
  // real columns, for where() (anything else is looked up in extra)
  const COLS = {
    vehicles: 'vin no vehicle buyer customer_id price purchased shipper yard arrived status electric container exit_date exit_reason remarks t_type t_elig t_loc t_state t_track t_courier t_recv t_vin_ok t_appr t_appr_date t_supplier t_applied t_checked t_remarks tw_case tw_paid tw_posted tw_pickup tw_lot tw_gate tw_key tw_btype tw_pid tw_track tw_carrier tw_driver tw_price tw_pick_plan tw_eta tw_title_collect tw_picked tw_title_pick tw_loc tw_title_dlv tw_inv_no tw_inv_amt tw_cpaid tw_booked tw_noshows tw_noshow_last',
    containers: 'container voyage_id customer_id shipper booking size clearance release load decl notes',
    pickups: 'pid name auction loc street city state zip country ltype hub category address phone notes src',
    customers: 'id name contact phone email city notes internal top system',
    voyages: 'id line vessel voyage_no origin pod etd eta status notes',
    declarations: 'id no date status port notes',
    carriers: 'id name mc email phone blocked noshows notes',
    rates: 'id month origin pod size agent line rate all_in source notes',
  };
  for (const c of Object.keys(COLS)) COLS[c] = new Set(COLS[c].split(' '));
  const TABLE_OF = { settings: 'app_settings' }; // + user:<uid> -> user_data
  const tableOf = (col) => (T[col] ? T[col].t : col.startsWith('user:') ? 'user_data' : TABLE_OF[col] || null);

  // ---------- errors in the shape the tracker expects ----------
  // Data problems use 'failed_precondition' so the tracker shows the message without
  // switching to its "you can't save" mode (that is for 'invalid_argument' / 'permission_denied').
  const TABLE_LABEL = { vehicles: 'vehicle', containers: 'container', voyages: 'voyage', customers: 'customer', declarations: 'declaration', carriers: 'carrier', pickups: 'pickup location', rates: 'rate', carrier_drivers: 'driver' };
  // `sent` = the fields the app tried to save: Postgres hides the offending value in its
  // message when the table has row-level security, so we name it from what was sent.
  function mapErr(e, sent) {
    if (!e) return Object.assign(new Error('Unknown error'), { code: 'unknown' });
    const m = String(e.message || e.msg || e.error_description || e);
    const det = String(e.details || '');
    const c = String(e.code || '');
    let code = 'unknown', msg = m;
    const kv = /Key \((.+?)\)=\((.*?)\)/.exec(det);
    if (c === '42501' || /row-level security|permission denied/i.test(m)) code = 'permission_denied';
    else if (c === 'P0002' || /not_found/i.test(m)) code = 'not_found';
    else if (/JWT|not authenticated|401/i.test(m)) code = 'unauthenticated';
    else if (/Failed to fetch|NetworkError|network/i.test(m)) code = 'unavailable';
    else if (c === '23505') { code = 'already_exists'; msg = kv ? `Already exists: ${kv[1]} ${kv[2]}` : 'Already exists.'; }
    else if (c === '23503') {
      code = 'failed_precondition';
      const ref = /still referenced from table "(\w+)"/.exec(det);
      const tbl = /not present in table "(\w+)"/.exec(det);
      const fk = /on table "(\w+)" violates foreign key constraint "(\w+)"/.exec(m);
      const col = fk ? fk[2].replace(fk[1] + '_', '').replace(/_fkey$/, '') : null;
      const val = kv ? kv[2] : sent && col && sent[col] != null ? String(sent[col]) : '';
      msg = ref ? `Can't delete: it is still used by ${TABLE_LABEL[ref[1]] || ref[1]} records. Move or remove those first.`
        : tbl ? `Unknown ${TABLE_LABEL[tbl[1]] || tbl[1]}: ${val}`.trim() : 'A linked record does not exist.';
    }
    else if (c === '23514') { code = 'failed_precondition'; const f = /_(\w+?)_check"/.exec(m); msg = `Value not allowed${f ? ': ' + f[1] : ''}.`; }
    else if (c === '23502') { code = 'failed_precondition'; const f = /column "(\w+)"/.exec(m); msg = `Required${f ? ': ' + f[1] : ''}.`; }
    else if (c.startsWith('22')) code = 'failed_precondition';
    const err = new Error(msg); err.code = code; err.raw = e; return err;
  }

  // ---------- paths ----------
  // 'settings/lists' -> ('settings','lists'); 'data/users/<uid>/prefs' -> ('user:<uid>','prefs')
  function splitPath(path) {
    const p = String(path).split('/').filter(Boolean);
    if (p[0] === 'data' && p[1] === 'users' && p.length === 4) return ['user:' + p[2], p[3]];
    if (p.length !== 2) throw mapErr({ message: 'Unsupported path: ' + path, code: '22000' });
    return p;
  }

  // ---------- row -> app record ----------
  const iso = (v) => { const d = new Date(v); return isNaN(d) ? String(v) : d.toISOString(); };
  function toDoc(col, row) {
    const m = T[col];
    const out = Object.assign({}, row.extra || {});
    for (const [k, v] of Object.entries(row)) {
      if (v === null || k === 'extra' || k === 'created_by' || k === 'updated_by' || k === 'carrier_drivers') continue;
      if (k === 'created_at') out.createdAt = iso(v);
      else if (k === 'updated_at') out.updatedAt = iso(v);
      else if (k === m.k && !m.keyInData) continue;
      else out[k] = v;
    }
    if (col === 'carriers') {
      out.drivers = (row.carrier_drivers || []).slice().sort((a, b) => a.pos - b.pos)
        .map((d) => Object.assign({}, d.extra || {}, { name: d.name }, d.phone != null ? { phone: d.phone } : {}));
    }
    return out;
  }

  // ---------- snapshots ----------
  const docSnap = (id, data) => ({ id, exists: data !== undefined, data: () => data, ref: null });
  const querySnap = (rows) => { const docs = rows.map((r) => ({ id: r.id, exists: true, data: () => r.data })); return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }; };

  // ---------- live updates: one channel, listeners per table ----------
  const listeners = new Map(); // table -> Set<fn>
  const LIVE_TABLES = ['vehicles', 'containers', 'voyages', 'customers', 'carriers', 'carrier_drivers', 'pickups', 'declarations', 'rates', 'app_settings', 'user_data'];
  let channel = null;
  function ensureChannel() {
    if (channel) return;
    let ch = sb.channel('aqs-tables');
    for (const t of LIVE_TABLES) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
        const key = t === 'carrier_drivers' ? 'carriers' : t;
        const set = listeners.get(key);
        if (set) set.forEach((fn) => fn());
      });
    }
    channel = ch.subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(() => { try { sb.removeChannel(channel); } catch (_) {} channel = null; ensureChannel(); }, 3000); });
  }
  function listen(table, fn) {
    ensureChannel();
    if (!listeners.has(table)) listeners.set(table, new Set());
    listeners.get(table).add(fn);
    return () => { const s = listeners.get(table); if (s) s.delete(fn); };
  }
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  function snapshotOf(get, table, cb, errCb) {
    let alive = true;
    const run = () => get().then((s) => { if (alive) cb(s); }, (e) => { if (alive && errCb) errCb(e); });
    const off = listen(table, debounce(run, 250));
    run();
    return () => { alive = false; off(); };
  }

  // ---------- small key-value docs: settings/<key>, data/users/<uid>/<key> ----------
  function kv(col) {
    if (col === 'settings') return { t: 'app_settings', match: (q, id) => q.eq('key', id), row: (id, value) => ({ key: id, value }), conflict: 'key', idOf: (r) => r.key, base: (q) => q };
    if (col.startsWith('user:')) {
      const uid = col.slice(5);
      return { t: 'user_data', match: (q, id) => q.eq('user_id', uid).eq('key', id), row: (id, value) => ({ user_id: uid, key: id, value }), conflict: 'user_id,key', idOf: (r) => r.key, base: (q) => q.eq('user_id', uid) };
    }
    return null;
  }

  // ---------- queries ----------
  const OPS = { '==': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', 'in': 'in', 'not-in': 'notin' };
  const quote = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  function makeQuery(col, filters, lim) {
    const q = {
      where(field, op, value) { return makeQuery(col, filters.concat([[field, op, value]]), lim); },
      limit(n) { return makeQuery(col, filters, n); },
      doc(id) { return makeDoc(col, id); },
      async get() {
        const max = Math.min(lim || 1000, 1000);
        const k = kv(col);
        if (k) {
          if (filters.length) throw mapErr({ message: 'Filters are not supported on ' + col, code: '22000' });
          const { data, error } = await k.base(sb.from(k.t).select('*')).range(0, max - 1);
          if (error) throw mapErr(error);
          return querySnap((data || []).map((r) => ({ id: k.idOf(r), data: r.value })));
        }
        const m = T[col];
        if (!m) throw mapErr({ message: 'Unknown collection: ' + col, code: '22000' });
        let req = sb.from(m.t).select(m.select || '*');
        for (const [field, op, value] of filters) {
          const path = COLS[col].has(field) ? field : 'extra->>' + field;
          const o = OPS[op];
          if (!o) throw mapErr({ message: 'Unsupported operator ' + op, code: '22000' });
          if (value === null && op === '==') req = req.is(path, null);
          else if (value === null && op === '!=') req = req.not(path, 'is', null);
          else if (o === 'in') req = req.in(path, value.map(String));
          else if (o === 'notin') req = req.not(path, 'in', '(' + value.map(quote).join(',') + ')');
          else req = req[o](path, typeof value === 'number' ? value : String(value));
        }
        const { data, error } = await req.range(0, max - 1);
        if (error) throw mapErr(error);
        return querySnap((data || []).map((r) => ({ id: String(r[m.k]), data: toDoc(col, r) })));
      },
      onSnapshot(cb, errCb) { return snapshotOf(q.get, tableOf(col), cb, errCb); },
    };
    return q;
  }

  function makeDoc(col, id) {
    id = String(id);
    const k = kv(col);
    const m = T[col];
    if (!k && !m) throw mapErr({ message: 'Unknown collection: ' + col, code: '22000' });
    const d = {
      id,
      async get() {
        if (k) {
          const { data, error } = await k.match(sb.from(k.t).select('value'), id).maybeSingle();
          if (error) throw mapErr(error);
          return docSnap(id, data ? data.value : undefined);
        }
        const { data, error } = await sb.from(m.t).select(m.select || '*').eq(m.k, id).maybeSingle();
        if (error) throw mapErr(error);
        return docSnap(id, data ? toDoc(col, data) : undefined);
      },
      async set(obj) {
        if (k) {
          const { error } = await sb.from(k.t).upsert(k.row(id, obj || {}), { onConflict: k.conflict });
          if (error) throw mapErr(error);
          return;
        }
        const { error } = await sb.rpc('rec_write', { p_table: m.t, p_id: id, p_data: obj || {}, p_replace: true });
        if (error) throw mapErr(error, obj);
      },
      async update(patch) {
        if (k) {
          const cur = await d.get();
          if (!cur.exists) throw mapErr({ message: 'not_found', code: 'P0002' });
          const next = Object.assign({}, cur.data(), patch || {});
          for (const [f, v] of Object.entries(patch || {})) if (v === null || v === undefined) delete next[f];
          return d.set(next);
        }
        const { error } = await sb.rpc('rec_write', { p_table: m.t, p_id: id, p_data: patch || {}, p_replace: false });
        if (error) throw mapErr(error, patch);
      },
      async delete() {
        const t = k ? k.t : m.t;
        let req = sb.from(t).delete();
        req = k ? k.match(req, id) : req.eq(m.k, id);
        const { data, error } = await req.select();
        if (error) throw mapErr(error);
        // RLS hides a refused delete as "0 rows": tell the user instead of pretending it worked
        if (!data || !data.length) {
          const still = await d.get().catch(() => null);
          if (still && still.exists) throw mapErr({ message: 'permission denied', code: '42501' });
        }
      },
      onSnapshot(cb, errCb) { return snapshotOf(d.get, tableOf(col), cb, errCb); },
    };
    return d;
  }
  const db = {
    collection: (name) => makeQuery(String(name), [], null),
    doc: (path) => { const [c, i] = splitPath(path); return makeDoc(c, i); },
  };

  // ---------- backup restore (Owner) ----------
  // Parents first so links resolve. Each call writes up to 100 records, all or nothing.
  const RESTORE_ORDER = ['customers', 'voyages', 'declarations', 'pickups', 'carriers', 'containers', 'vehicles', 'rates'];
  async function restore(backup, onProgress) {
    const jobs = [];
    for (const col of RESTORE_ORDER) { const docs = backup[col]; if (docs && typeof docs === 'object') jobs.push([col, Object.entries(docs)]); }
    const settings = backup.settings && typeof backup.settings === 'object' ? Object.entries(backup.settings) : [];
    const total = jobs.reduce((a, [, r]) => a + r.length, 0) + settings.length;
    let done = 0, failed = 0; const errors = [];
    for (const [col, rows] of jobs) {
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100).map(([id, data]) => ({ id: String(id), data }));
        const { error } = await sb.rpc('rec_bulk_set', { p_table: T[col].t, p_rows: chunk });
        if (error) { failed += chunk.length; errors.push(`${col}: ${mapErr(error).message}`); } else done += chunk.length;
        if (onProgress) onProgress(done, failed, total);
      }
    }
    for (const [key, value] of settings) {
      const { error } = await sb.from('app_settings').upsert({ key, value }, { onConflict: 'key' });
      if (error) { failed++; errors.push(`settings/${key}: ${mapErr(error).message}`); } else done++;
      if (onProgress) onProgress(done, failed, total);
    }
    if (errors.length) console.warn('Restore problems:', errors);
    return { done, failed, errors };
  }

  // ---------- auth + profile ----------
  const SB = {
    client: sb,
    state: 'checking', // checking | login | ok | inactive
    session: null, profile: null,
    _waiters: [],
    shortName,
    restore,
    async refresh() {
      const { data } = await sb.auth.getSession();
      SB.session = data.session || null;
      if (!SB.session) { SB.profile = null; SB.state = 'login'; return SB.state; }
      const { data: p, error } = await sb.from('profiles').select('user_id, email, name, role, active').eq('user_id', SB.session.user.id).maybeSingle();
      SB.profile = error ? null : p;
      SB.state = SB.profile && SB.profile.active ? 'ok' : 'inactive';
      if (SB.state === 'ok') { const w = SB._waiters.splice(0); w.forEach((f) => f()); }
      return SB.state;
    },
    whenSignedIn() { return SB.state === 'ok' ? Promise.resolve() : new Promise((r) => SB._waiters.push(r)); },
    async signIn(login, password) {
      const { error } = await sb.auth.signInWithPassword({ email: toEmail(login), password });
      if (error) throw mapErr({ message: /invalid/i.test(error.message) ? 'Wrong login or password.' : error.message });
      return SB.refresh();
    },
    async signOut() { try { await sb.auth.signOut(); } catch (_) {} location.reload(); },
    async changePassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw mapErr(error); },
    async admin(action, body) {
      const { data, error } = await sb.functions.invoke('admin-users', { body: { action, ...(body || {}) } });
      if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (_) {} throw mapErr({ message: m }); }
      if (data && data.error) throw mapErr({ message: data.error });
      return data;
    },
    async bootstrap(code, login, name, password) {
      const { data, error } = await sb.functions.invoke('admin-users', { body: { action: 'bootstrap', code, email: login, name, password } });
      if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (_) {} throw mapErr({ message: m }); }
      if (data && data.error) throw mapErr({ message: data.error });
      return SB.signIn(login, password);
    },
  };
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { SB.state = 'login'; SB.profile = null; } });

  // ---------- the runtime the tracker asks for ----------
  const user = {
    can: async () => !!(SB.profile && SB.profile.active),
    canEdit: async () => !!(SB.profile && SB.profile.active && SB.profile.role === 'owner'),
    id: async () => (SB.session ? SB.session.user.id : null),
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename || 'download'; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
  };
  window.claude = {
    use: async (name) => {
      if (name === 'db') { await SB.whenSignedIn(); return db; }
      if (name === 'user') { await SB.whenSignedIn(); return user; }
      if (name === 'downloads') return downloads;
      return null;
    },
  };
  window.SB = SB;
})();

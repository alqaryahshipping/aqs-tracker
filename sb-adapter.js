/* AQS Tracker — Supabase adapter.
 * Gives the tracker the same small database API it used on claude.ai
 * (collection / doc / where / limit / get / set / update / delete / onSnapshot),
 * backed by the Supabase table public.docs (collection, id, data jsonb).
 * Also provides login (Supabase Auth), the signed-in user's role, and file downloads.
 */
(function () {
  'use strict';
  const CFG = window.AQS_CONFIG || {};
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aqs-tracker-auth' } });
  const LOGIN_DOMAIN = '@aqs-tracker.local';
  const toEmail = (u) => { u = String(u || '').trim().toLowerCase(); return u.includes('@') ? u : u.replace(/[^a-z0-9._-]/g, '') + LOGIN_DOMAIN; };
  const shortName = (e) => String(e || '').replace(LOGIN_DOMAIN, '');

  // ---------- errors in the shape the tracker expects ----------
  function mapErr(e) {
    if (!e) return { code: 'unknown', message: 'Unknown error' };
    const m = String(e.message || e.msg || e.error_description || e);
    const c = String(e.code || '');
    let code = 'unknown';
    if (c === '42501' || /row-level security|permission denied/i.test(m)) code = 'permission_denied';
    else if (c === 'P0002' || /not_found/i.test(m)) code = 'not_found';
    else if (/JWT|not authenticated|401/i.test(m)) code = 'unauthenticated';
    else if (/Failed to fetch|NetworkError|network/i.test(m)) code = 'unavailable';
    else if (c.startsWith('22') || c.startsWith('23')) code = 'invalid_argument';
    const err = new Error(m); err.code = code; err.raw = e; return err;
  }

  // ---------- paths ----------
  // 'settings/lists' -> ('settings','lists'); 'data/users/<uid>/prefs' -> ('user:<uid>','prefs')
  function splitPath(path) {
    const p = String(path).split('/').filter(Boolean);
    if (p[0] === 'data' && p[1] === 'users' && p.length === 4) return ['user:' + p[2], p[3]];
    if (p.length !== 2) throw mapErr({ message: 'Unsupported path: ' + path, code: '22000' });
    return p;
  }

  // ---------- snapshots ----------
  const docSnap = (id, row) => ({ id, exists: !!row, data: () => (row ? row.data : undefined), ref: null });
  const querySnap = (rows) => { const docs = rows.map((r) => ({ id: r.id, exists: true, data: () => r.data })); return { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f) }; };

  // ---------- live updates: one channel, listeners per collection ----------
  const listeners = new Map(); // collection -> Set<fn>
  let channel = null;
  function ensureChannel() {
    if (channel) return;
    channel = sb.channel('aqs-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, (payload) => {
      const col = (payload.new && payload.new.collection) || (payload.old && payload.old.collection);
      const set = col && listeners.get(col);
      if (set) set.forEach((fn) => fn());
    }).subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(() => { try { sb.removeChannel(channel); } catch (_) {} channel = null; ensureChannel(); }, 3000); });
  }
  function listen(col, fn) {
    ensureChannel();
    if (!listeners.has(col)) listeners.set(col, new Set());
    listeners.get(col).add(fn);
    return () => { const s = listeners.get(col); if (s) s.delete(fn); };
  }
  const debounce = (fn, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };

  // ---------- queries ----------
  const OPS = { '==': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', 'in': 'in', 'not-in': 'notin' };
  function makeQuery(col, filters, lim) {
    const q = {
      where(field, op, value) { return makeQuery(col, filters.concat([[field, op, value]]), lim); },
      limit(n) { return makeQuery(col, filters, n); },
      doc(id) { return makeDoc(col, id); },
      async get() {
        const max = Math.min(lim || 1000, 1000);
        let req = sb.from('docs').select('id, data').eq('collection', col);
        for (const [field, op, value] of filters) {
          const path = 'data->>' + field;
          const o = OPS[op];
          if (!o) throw mapErr({ message: 'Unsupported operator ' + op, code: '22000' });
          if (value === null && op === '==') req = req.is(path, null);
          else if (value === null && op === '!=') req = req.not(path, 'is', null);
          else if (o === 'in') req = req.in(path, value.map(String));
          else if (o === 'notin') req = req.not(path, 'in', '(' + value.map((v) => '"' + String(v).replace(/"/g, '\\"') + '"').join(',') + ')');
          else req = req[o](path, typeof value === 'number' ? value : String(value));
        }
        const { data, error } = await req.range(0, max - 1);
        if (error) throw mapErr(error);
        return querySnap(data || []);
      },
      onSnapshot(cb, errCb) {
        let alive = true;
        const run = () => q.get().then((s) => { if (alive) cb(s); }, (e) => { if (alive && errCb) errCb(e); });
        const off = listen(col, debounce(run, 250));
        run();
        return () => { alive = false; off(); };
      },
    };
    return q;
  }
  function makeDoc(col, id) {
    id = String(id);
    const d = {
      id,
      async get() {
        const { data, error } = await sb.from('docs').select('id, data').eq('collection', col).eq('id', id).maybeSingle();
        if (error) throw mapErr(error);
        return docSnap(id, data);
      },
      async set(obj) {
        const { error } = await sb.from('docs').upsert({ collection: col, id, data: obj || {} }, { onConflict: 'collection,id' });
        if (error) throw mapErr(error);
      },
      async update(patch) {
        const { error } = await sb.rpc('doc_update', { p_collection: col, p_id: id, p_patch: patch || {} });
        if (error) throw mapErr(error);
      },
      async delete() {
        const { error } = await sb.from('docs').delete().eq('collection', col).eq('id', id);
        if (error) throw mapErr(error);
      },
      onSnapshot(cb, errCb) {
        let alive = true;
        const run = () => d.get().then((s) => { if (alive) cb(s); }, (e) => { if (alive && errCb) errCb(e); });
        const off = listen(col, debounce(run, 250));
        run();
        return () => { alive = false; off(); };
      },
    };
    return d;
  }
  const db = {
    collection: (name) => makeQuery(String(name), [], null),
    doc: (path) => { const [c, i] = splitPath(path); return makeDoc(c, i); },
  };

  // ---------- auth + profile ----------
  const SB = {
    client: sb,
    state: 'checking', // checking | login | ok | inactive
    session: null, profile: null,
    _waiters: [],
    shortName,
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
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { SB.state = 'login'; SB.profile = null; } if (ev === 'TOKEN_REFRESHED' && channel) { /* realtime picks up the new token automatically */ } });

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

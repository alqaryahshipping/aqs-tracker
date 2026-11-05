// Unit test for sb-adapter.js against a fake Supabase client. Usage: node adapter_test.js <path-to-sb-adapter.js>
const fs = require('fs'); const vm = require('vm'); const assert = require('assert');
const J = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const deq = assert.deepStrictEqual; assert.deepStrictEqual = (a, b, m) => deq(J(a), J(b), m); // objects from the vm realm
const calls = []; let nextResult = {}; const rpcs = [];
function builder(table) {
  const q = { table, ops: [] };
  const chain = new Proxy({}, { get(_, prop) {
    if (prop === 'then') { calls.push(q); const r = nextResult[table] || { data: [], error: null }; return (res, rej) => Promise.resolve(r).then(res, rej); }
    if (prop === 'maybeSingle') return () => { calls.push(q); const r = nextResult[table] || { data: null, error: null }; return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }); };
    return (...args) => { q.ops.push([prop, ...args]); return chain; };
  } });
  return chain;
}
const fakeClient = {
  from: (t) => builder(t),
  rpc: (name, args) => { rpcs.push([name, args]); return Promise.resolve(nextResult['rpc:' + name] || { data: null, error: null }); },
  channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
  removeChannel: () => {},
  auth: { onAuthStateChange: () => {}, getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
};
const win = { AQS_CONFIG: { url: 'x', key: 'y' }, supabase: { createClient: () => fakeClient } };
const ctx = { window: win, console, setTimeout, clearTimeout, URL, Blob: class {}, document: {}, location: {} };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), ctx);
const SB = win.SB;
(async () => {
  SB.state = 'ok'; SB.profile = { active: true, role: 'owner' };
  const db = await win.claude.use('db');

  // 1. where on a real column + limit; vehicles row -> app record (vin kept, nulls dropped, extra merged, timestamps)
  nextResult.vehicles = { data: [{ vin: 'V1', price: 9105, container: null, shipper: 'NWL', extra: { foo: 1 }, created_at: '2026-11-02T00:00:00+00:00', updated_at: '2026-11-03T12:10:00+00:00', created_by: 'u', updated_by: 'u' }], error: null };
  let s = await db.collection('vehicles').where('shipper', '==', 'NWL').limit(1000).get();
  let q = calls.pop();
  assert.deepStrictEqual(q.ops.find((o) => o[0] === 'eq'), ['eq', 'shipper', 'NWL']);
  assert.deepStrictEqual(q.ops.find((o) => o[0] === 'range'), ['range', 0, 999]);
  assert.strictEqual(s.size, 1); assert.strictEqual(s.docs[0].id, 'V1');
  assert.deepStrictEqual(s.docs[0].data(), { foo: 1, vin: 'V1', price: 9105, shipper: 'NWL', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-03T12:10:00.000Z' });

  // 2. not-in, == null, unknown field -> extra->>
  await db.collection('pickups').where('auction', 'not-in', ['Copart', 'IAA']).get(); q = calls.pop();
  assert.deepStrictEqual(q.ops.find((o) => o[0] === 'not'), ['not', 'auction', 'in', '("Copart","IAA")']);
  await db.collection('pickups').where('auction', '==', null).get(); q = calls.pop();
  assert.deepStrictEqual(q.ops.find((o) => o[0] === 'is'), ['is', 'auction', null]);
  await db.collection('vehicles').where('weird', '>=', 5).get(); q = calls.pop();
  assert.deepStrictEqual(q.ops.find((o) => o[0] === 'gte'), ['gte', 'extra->>weird', 5]);

  // 3. id tables drop the key from data; carriers rebuild drivers in order
  nextResult.carriers = { data: [{ id: 'C1', name: 'Golden', noshows: 0, extra: {}, carrier_drivers: [{ pos: 1, name: 'B', phone: null, extra: { lic: 'X' } }, { pos: 0, name: 'A', phone: '1', extra: {} }] }], error: null };
  s = await db.collection('carriers').limit(1000).get(); q = calls.pop();
  assert.deepStrictEqual(q.ops[0], ['select', '*, carrier_drivers(*)']);
  assert.deepStrictEqual(s.docs[0].data(), { name: 'Golden', noshows: 0, drivers: [{ name: 'A', phone: '1' }, { lic: 'X', name: 'B' }] });

  // 4. writes go to rec_write with the right flags
  await db.collection('vehicles').doc('V1').set({ vin: 'V1', price: 1 });
  await db.collection('vehicles').doc('V1').update({ price: 2 });
  assert.deepStrictEqual(rpcs.splice(0), [['rec_write', { p_table: 'vehicles', p_id: 'V1', p_data: { vin: 'V1', price: 1 }, p_replace: true }], ['rec_write', { p_table: 'vehicles', p_id: 'V1', p_data: { price: 2 }, p_replace: false }]]);

  // 5. settings + per-user docs
  nextResult.app_settings = { data: { value: { shippers: ['NWL'] } }, error: null };
  s = await db.doc('settings/lists').get(); q = calls.pop();
  assert.strictEqual(q.table, 'app_settings'); assert.deepStrictEqual(q.ops.find((o) => o[0] === 'eq'), ['eq', 'key', 'lists']);
  assert.deepStrictEqual(s.data(), { shippers: ['NWL'] });
  await db.doc('data/users/u1/prefs').set({ a: 1 }); q = calls.pop();
  assert.strictEqual(q.table, 'user_data'); assert.deepStrictEqual(q.ops[0], ['upsert', { user_id: 'u1', key: 'prefs', value: { a: 1 } }, { onConflict: 'user_id,key' }]);
  nextResult.user_data = { data: null, error: null };
  s = await db.doc('data/users/u1/drafts').get(); assert.strictEqual(s.exists, false);

  // 6. error messages
  nextResult['rpc:rec_write'] = { error: { code: '23503', message: 'violates foreign key', details: 'Key (customer_id)=(NOPE) is not present in table "customers".' } };
  await assert.rejects(db.collection('vehicles').doc('V1').update({ customer_id: 'NOPE' }), (e) => e.code === 'failed_precondition' && e.message === 'Unknown customer: NOPE');
  nextResult['rpc:rec_write'] = { error: { code: '23505', message: 'dup', details: 'Key (lower(btrim(name)))=(abc) already exists.' } };
  await assert.rejects(db.collection('customers').doc('X').set({ name: 'abc' }), (e) => e.code === 'already_exists' && /^Already exists/.test(e.message));
  nextResult['rpc:rec_write'] = { error: { code: '22007', message: 'purchased is not a valid date: 12/10/2026' } };
  await assert.rejects(db.collection('vehicles').doc('V1').update({ purchased: '12/10/2026' }), (e) => e.code === 'failed_precondition' && e.message === 'purchased is not a valid date: 12/10/2026');
  nextResult['rpc:rec_write'] = { error: { code: '42501', message: 'new row violates row-level security policy' } };
  await assert.rejects(db.collection('rates').doc('R').set({ month: '2026-11' }), (e) => e.code === 'permission_denied');
  nextResult['rpc:rec_write'] = undefined;

  // 7. delete refused by RLS (0 rows but record still there) -> permission_denied; delete blocked by FK -> clear message
  nextResult.customers = { data: [], error: null };
  const realThen = nextResult.customers;
  let n = 0; nextResult.customers = new Proxy({}, { get: (_, p) => (p === 'data' ? (n++ === 0 ? [] : [{ id: 'CU1', name: 'A', extra: {} }]) : p === 'error' ? null : undefined) });
  await assert.rejects(db.collection('customers').doc('CU1').delete(), (e) => e.code === 'permission_denied');
  nextResult.customers = { data: null, error: { code: '23503', message: 'fk', details: 'Key (id)=(CU1) is still referenced from table "vehicles".' } };
  await assert.rejects(db.collection('customers').doc('CU1').delete(), (e) => /still used by vehicle/.test(e.message));
  void realThen;

  // 8. restore: parents first, batches of 100, settings last
  rpcs.length = 0; calls.length = 0;
  const bk = { _meta: {}, vehicles: { V1: { vin: 'V1' } }, customers: Object.fromEntries(Array.from({ length: 150 }, (_, i) => ['C' + i, { name: 'n' + i }])), settings: { lists: { a: 1 } } };
  const r = await SB.restore(bk);
  assert.deepStrictEqual(rpcs.map((x) => [x[0], x[1].p_table, x[1].p_rows.length]), [['rec_bulk_set', 'customers', 100], ['rec_bulk_set', 'customers', 50], ['rec_bulk_set', 'vehicles', 1]]);
  assert.strictEqual(calls.pop().table, 'app_settings');
  assert.deepStrictEqual([r.done, r.failed], [152, 0]);

  console.log('ALL ADAPTER TESTS PASSED');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

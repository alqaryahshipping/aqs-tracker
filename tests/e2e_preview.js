// End-to-end test of the relational adapter in a real browser against the real Supabase project.
// Usage (env): OLD_URL NEW_URL BYPASS OWNER_USER OWNER_PW STAFF_USER STAFF_PW  node tests/e2e_preview.js
//   OLD_URL = site on the current adapter (public.docs), NEW_URL = preview on the new adapter.
// Phase A compares every tab between the two sites (same data must show the same numbers).
// Phases B-F exercise writes, live updates, permissions, the screens and restore on the new site.
// Writes use test IDs starting with ZZ and are removed at the end.
const { chromium } = require('playwright');
const E = process.env;
const TABS = ['inbox', 'vehicles', 'towing', 'titles', 'containers', 'voyages', 'clearance', 'onhand', 'shipments', 'rates', 'customers', 'settings'];
const results = []; const errors = {}; let phase = 'A';
// phases whose calls include deliberate failures (bad date, unknown customer, staff delete...): HTTP errors there are expected
const NEGATIVE = new Set(['B', 'E']);
const ok = (name, pass, detail) => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 400) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctx(browser, label) {
  const c = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await c.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname.endsWith('.vercel.app')) return route.continue({ headers: { ...route.request().headers(), 'x-vercel-protection-bypass': E.BYPASS, 'x-vercel-set-bypass-cookie': 'true' } });
    return route.continue();
  });
  errors[label] = [];
  c.on('page', (p) => {
    p.on('pageerror', (e) => errors[label].push(`[${phase}] pageerror: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors[label].push(`[${phase}] console: ${m.text()}`); });
    p.on('response', (r) => { if (r.status() >= 400 && !NEGATIVE.has(phase)) errors[label].push(`[${phase}] HTTP ${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`); });
  });
  return c;
}
async function login(c, url, user, pw) {
  const p = await c.newPage();
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  // a second window in the same browser is already signed in (shared session): no login form then
  await p.waitForFunction(() => document.querySelector('input[aria-label="Username or email"]') || !document.body.classList.contains('vt-locked'), null, { timeout: 30000 });
  if (await p.$('input[aria-label="Username or email"]')) {
    await p.fill('input[aria-label="Username or email"]', user);
    await p.fill('input[aria-label="Password"]', pw);
    await p.click('.vt-login-form button[type=submit]');
  }
  await p.waitForFunction(() => !document.body.classList.contains('vt-locked') && document.querySelector('#n-veh') && document.querySelector('#n-veh').textContent !== '', null, { timeout: 60000 });
  await sleep(4000); // let every live query settle
  return p;
}
async function tabSnapshot(p, tab) {
  const btn = await p.$(`#tab-${tab}`);
  if (!btn || !(await btn.isVisible())) return { hidden: true };
  await btn.click(); await sleep(1800);
  return p.evaluate(() => {
    const t = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    return {
      badges: t('.vt-tab b'),
      counts: t('#main .vt-count'),
      kpis: t('#main .vt-kpi'),
      rows: document.querySelectorAll('#main .vt-table tbody tr').length,
      cols: t('#main .vt-colhead .vt-colrow'),
      sync: (document.querySelector('#sync') || {}).textContent,
    };
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    // ---------- A. read parity: old site vs new site, every tab, as Owner ----------
    const cOld = await ctx(browser, 'old'); const cNew = await ctx(browser, 'new');
    const [pOld, pNew] = await Promise.all([login(cOld, E.OLD_URL, E.OWNER_USER, E.OWNER_PW), login(cNew, E.NEW_URL, E.OWNER_USER, E.OWNER_PW)]);
    ok('A0 owner can sign in on both sites', true);
    const newAdapter = await pNew.evaluate(() => typeof SB.restore === 'function');
    const oldAdapter = await pOld.evaluate(() => typeof SB.restore !== 'function');
    ok('A0 old site runs the old adapter, preview runs the new one', newAdapter && oldAdapter, { newAdapter, oldAdapter });
    for (const tab of TABS) {
      const [a, b] = [await tabSnapshot(pOld, tab), await tabSnapshot(pNew, tab)];
      const same = JSON.stringify(a) === JSON.stringify(b);
      ok(`A1 tab "${tab}" shows the same numbers on both sites`, same, same ? { badges: b.badges, counts: b.counts, rows: b.rows, kpis: (b.kpis || []).slice(0, 4) } : { old: a, new: b });
    }
    await cOld.close();

    try {
    phase = 'B';
    // ---------- B. writes through the adapter (new site, Owner) ----------
    const r = await pNew.evaluate(async () => {
      const db = await claude.use('db'); const out = {};
      const V = 'ZZTESTVIN0000001';
      const err = async (f) => { try { await f(); return null; } catch (e) { return { code: e.code, message: e.message }; } };
      await db.collection('vehicles').doc(V).set({ vin: V, customer_id: 'CU001', price: 1234.5, purchased: '2026-11-01', vehicle: 'ZZ TEST CAR', shipper: 'NWL', remarks: 'e2e', foo_unknown: 'kept', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      out.created = (await db.collection('vehicles').doc(V).get()).data();
      await db.collection('vehicles').doc(V).update({ price: 2000, foo_unknown: null, remarks: 'e2e updated', updatedAt: new Date().toISOString() });
      out.updated = (await db.collection('vehicles').doc(V).get()).data();
      out.badDate = await err(() => db.collection('vehicles').doc(V).update({ purchased: '12/10/2026' }));
      out.badCustomer = await err(() => db.collection('vehicles').doc(V).update({ customer_id: 'ZZNOPE' }));
      out.badNumber = await err(() => db.collection('vehicles').doc(V).update({ price: 'abc' }));
      out.missingUpdate = await err(() => db.collection('vehicles').doc('ZZNOSUCHVIN').update({ price: 1 }));
      out.byShipper = (await db.collection('vehicles').where('shipper', '==', 'NWL').limit(1000).get()).docs.some((d) => d.id === V);
      await db.collection('carriers').doc('ZZ-CARRIER').set({ name: 'ZZ TEST CARRIER', mc: '123', noshows: 0, drivers: [{ name: 'Driver A', phone: '555' }, { name: 'Driver B' }], createdAt: new Date().toISOString() });
      out.carrier = (await db.collection('carriers').doc('ZZ-CARRIER').get()).data();
      const uid = SB.session.user.id;
      await db.doc(`data/users/${uid}/prefs`).set({ theme: 'dark', zz: 1 });
      out.prefs = (await db.doc(`data/users/${uid}/prefs`).get()).data();
      out.settingsLists = !!(await db.doc('settings/lists').get()).data();
      out.deleteUsedCustomer = await err(() => db.collection('customers').doc('CU001').delete());
      out.cu001Still = (await db.collection('customers').doc('CU001').get()).exists;
      out.restore = await SB.restore({ customers: { ZZRESTORE: { name: 'ZZ restore test' } } });
      out.restored = (await db.collection('customers').doc('ZZRESTORE').get()).data();
      return out;
    });
    ok('B1 create a vehicle: every field reads back', r.created && r.created.vin === 'ZZTESTVIN0000001' && r.created.price === 1234.5 && r.created.purchased === '2026-11-01' && r.created.customer_id === 'CU001' && r.created.foo_unknown === 'kept', r.created);
    ok('B2 update: changed fields saved, cleared field removed', r.updated && r.updated.price === 2000 && r.updated.remarks === 'e2e updated' && !('foo_unknown' in r.updated) && r.updated.purchased === '2026-11-01', r.updated);
    ok('B3 bad date is refused with a clear message', r.badDate && /not a valid date/.test(r.badDate.message), r.badDate);
    ok('B4 unknown customer is refused', r.badCustomer && /Unknown customer/.test(r.badCustomer.message), r.badCustomer);
    ok('B5 non-number price is refused', r.badNumber && /not a valid number/.test(r.badNumber.message), r.badNumber);
    ok('B6 update of a missing record reports not found', r.missingUpdate && r.missingUpdate.code === 'not_found', r.missingUpdate);
    ok('B7 filtered query (by loader) finds the new car', r.byShipper);
    ok('B8 carrier with drivers saves and reads back in order', r.carrier && r.carrier.drivers && r.carrier.drivers.length === 2 && r.carrier.drivers[0].name === 'Driver A' && r.carrier.drivers[0].phone === '555', r.carrier);
    ok('B9 personal prefs save and read back', r.prefs && r.prefs.theme === 'dark', r.prefs);
    ok('B10 settings lists load', r.settingsLists);
    ok('B11 deleting a customer that cars use is blocked', r.deleteUsedCustomer && /still used/.test(r.deleteUsedCustomer.message) && r.cu001Still, r.deleteUsedCustomer);
    ok('B12 backup restore writes through the new tables', r.restore && r.restore.done === 1 && r.restore.failed === 0 && r.restored && r.restored.name === 'ZZ restore test', r.restore);

    try {
    } catch (e) { ok('B writes did not finish', false, e.message.slice(0, 300)); }
    phase = 'C';
    // ---------- C. live updates between two browsers ----------
    const pNew2 = await login(cNew, E.NEW_URL, E.OWNER_USER, E.OWNER_PW);
    await pNew2.evaluate(async () => {
      const db = await claude.use('db'); window.__seen = [];
      db.collection('vehicles').doc('ZZTESTVIN0000001').onSnapshot((s) => window.__seen.push(s.exists ? s.data().remarks : null));
    });
    await sleep(2500);
    const t0 = Date.now();
    await pNew.evaluate(async () => { const db = await claude.use('db'); await db.collection('vehicles').doc('ZZTESTVIN0000001').update({ remarks: 'live-check' }); });
    let seen = false; while (Date.now() - t0 < 10000) { seen = await pNew2.evaluate(() => window.__seen.includes('live-check')); if (seen) break; await sleep(250); }
    ok('C1 a save in one browser shows in the other', seen, { ms: Date.now() - t0 });
    // screen-level: badge in the second window follows a new car
    await pNew2.click('#tab-vehicles'); await sleep(800);
    const before = await pNew2.textContent('#n-veh');
    await pNew.evaluate(async () => { const db = await claude.use('db'); await db.collection('vehicles').doc('ZZTESTVIN0000002').set({ vin: 'ZZTESTVIN0000002', customer_id: 'CU001', shipper: 'NWL', createdAt: new Date().toISOString() }); });
    let after = before; const t1 = Date.now();
    while (Date.now() - t1 < 10000) { after = await pNew2.textContent('#n-veh'); if (after !== before) break; await sleep(250); }
    ok('C2 the Vehicles count in the other window updates live', after !== before, { before, after, ms: Date.now() - t1 });

    } catch (e) { ok('C live updates did not finish', false, e.message.slice(0, 300)); }
    phase = 'D';
    // ---------- D. screens: edit a car through the drawer ----------
    let uiOk = false, uiDetail;
    try {
      await pNew.click('#tab-vehicles'); await sleep(1000);
      const search = pNew.locator('#main input[type=search], #main .vt-f input').first();
      await search.fill('ZZTESTVIN0000001'); await sleep(1000);
      await pNew.locator('#main .vt-table tbody tr').first().click(); await sleep(1000);
      const ta = pNew.locator('.vt-drawer label:has-text("Remarks") textarea').first();
      await ta.fill('edited in the drawer');
      await pNew.locator('.vt-drawer-foot button:has-text("Save")').first().click(); await sleep(2500);
      const v = await pNew.evaluate(async () => (await (await claude.use('db')).collection('vehicles').doc('ZZTESTVIN0000001').get()).data());
      uiOk = v.remarks === 'edited in the drawer'; uiDetail = { remarks: v.remarks, toast: await pNew.evaluate(() => [...document.querySelectorAll('.vt-toast, [role=status]')].map((e) => e.textContent).join(' | ')) };
    } catch (e) { uiDetail = e.message.slice(0, 300); }
    ok('D1 edit a car on screen (drawer → Save) reaches the database', uiOk, uiDetail);
    // Excel export
    let exp = false, expDetail;
    try {
      await pNew.keyboard.press('Escape'); await sleep(800);           // close the vehicle drawer from D1
      await pNew.click('#tab-vehicles'); await sleep(800);
      const b = pNew.locator('#exportBtn');
      if (await b.count()) {
        const [dl] = await Promise.all([pNew.waitForEvent('download', { timeout: 30000 }), b.click()]);
        expDetail = dl.suggestedFilename(); exp = /\.xlsx$/i.test(expDetail);
      } else expDetail = 'no Export button on the Vehicles tab';
    } catch (e) { expDetail = e.message.slice(0, 300); }
    ok('D2 Excel export downloads a file', exp, expDetail);

    try {
    phase = 'E';
    // ---------- E. Staff permissions ----------
    const cStaff = await ctx(browser, 'staff');
    const pS = await login(cStaff, E.NEW_URL, E.STAFF_USER, E.STAFF_PW);
    const s = await pS.evaluate(async () => {
      const db = await claude.use('db'); const out = {};
      const err = async (f) => { try { await f(); return null; } catch (e) { return { code: e.code, message: e.message }; } };
      out.ratesTabHidden = document.querySelector('#tab-rates').hidden;
      try { out.ratesSeen = (await db.collection('rates').limit(1000).get()).size; } catch (e) { out.ratesSeen = 'error ' + e.code; }
      out.rateWrite = await err(() => db.collection('rates').doc('ZZRATE').set({ month: '2026-11', rate: 1 }));
      out.vehiclesSeen = (await db.collection('vehicles').limit(1000).get()).size;
      out.staffUpdate = await err(() => db.collection('vehicles').doc('ZZTESTVIN0000001').update({ remarks: 'by staff' }));
      out.staffDelete = await err(() => db.collection('vehicles').doc('ZZTESTVIN0000001').delete());
      out.stillThere = (await db.collection('vehicles').doc('ZZTESTVIN0000001').get()).exists;
      return out;
    });
    ok('E1 Staff: Rates tab hidden and no rates readable', s.ratesTabHidden && (s.ratesSeen === 0 || /error/.test(String(s.ratesSeen))), { hidden: s.ratesTabHidden, seen: s.ratesSeen });
    ok('E2 Staff: cannot save a rate', s.rateWrite && s.rateWrite.code === 'permission_denied', s.rateWrite);
    ok('E3 Staff: sees vehicles and can edit them', s.vehiclesSeen > 0 && s.staffUpdate === null, { seen: s.vehiclesSeen, update: s.staffUpdate });
    ok('E4 Staff: delete is refused and the car stays', s.staffDelete && s.staffDelete.code === 'permission_denied' && s.stillThere, s.staffDelete);
    await cStaff.close();

    } catch (e) { ok('E staff checks did not finish', false, e.message.slice(0, 300)); }
    phase = 'F';
    // ---------- F. clean up test records (Owner) ----------
    const f = await pNew.evaluate(async () => {
      const db = await claude.use('db'); const uid = SB.session.user.id;
      for (const [c, id] of [['vehicles', 'ZZTESTVIN0000001'], ['vehicles', 'ZZTESTVIN0000002'], ['carriers', 'ZZ-CARRIER'], ['customers', 'ZZRESTORE']]) await db.collection(c).doc(id).delete();
      await db.doc(`data/users/${uid}/prefs`).delete();
      return (await db.collection('vehicles').doc('ZZTESTVIN0000001').get()).exists;
    });
    ok('F1 Owner can delete; test records removed', f === false);
    await cNew.close();
  } catch (e) {
    ok('UNEXPECTED ERROR', false, e.stack);
  } finally {
    await browser.close();
    for (const [k, v] of Object.entries(errors)) ok(`Z browser errors on ${k}`, v.length === 0, v.slice(0, 8));
    const failed = results.filter((x) => !x.pass).length;
    console.log(`\nSUMMARY ${results.length - failed}/${results.length} passed`);
    require('fs').writeFileSync('e2e_results.json', JSON.stringify({ results, errors }, null, 1));
    process.exit(failed ? 1 : 0);
  }
})();

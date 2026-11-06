/* Builds the On-Hand Vehicles workbook: Dashboard (formulas) + Data + Lists.
   Works in the browser (window.buildOnHandWorkbook) and in Node (module.exports). */
(function (root) {
  const BANDS = ['0-10', '11-30', '31-60', '61-90', '91-180', '180+'];
  const TITLES = ['Yes', 'No', 'BOS', 'Lien'];
  const DEFAULT_STATUSES = ['Load Plan', 'With Title', 'In Auction', 'Electric', 'On The Way', 'Auction not received', 'BOS', 'Suspended', 'Requested', 'Driver issue', 'Not recorded'];
  const DEFAULT_SHIPPERS = ['Nejoum', 'AQS', 'AFG', 'NWL', 'Caromoto'];
  const EXITS = ['Shipped', 'Sold'];
  const CSTATUS = ['Planned', 'On the water', 'Arrived, not marked cleared', 'Arrived, cleared'];
  const PORTS = ['Khor Fakkan', 'Jebel Ali'];
  const LINES = ['Maersk', 'CMA', 'Hapag-Lloyd'];
  const CLEAR = ['Cleared', 'Submitted', 'DO Received'];

  const toDate = (s) => {
    if (!s) return null;
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d));
  };
  const uniq = (base, extra) => {
    const out = base.slice();
    for (const v of extra) if (v && !out.includes(v)) out.push(v);
    return out;
  };

  // Generic sheet from { name, cols: [[header, width, 'date'|'money'|'int'|null]], rows: [[...]] }
  function sheetFromTable(wb, spec, FMT) {
    const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
    spec.cols.forEach(([hd, w], i) => { const c = ws.getCell(1, i + 1); c.value = hd; c.font = FMT.HEAD; c.fill = FMT.HEADFILL; c.alignment = { vertical: 'middle', wrapText: true }; ws.getColumn(i + 1).width = w || 14; });
    ws.getRow(1).height = 30;
    spec.rows.forEach((row, ri) => row.forEach((v, j) => {
      const t = (spec.cols[j] || [])[2]; const c = ws.getCell(ri + 2, j + 1);
      c.value = t === 'date' ? toDate(v) : v === '' || v == null ? null : v; c.font = FMT.FONT;
      if (t === 'date') c.numFmt = FMT.DATE; else if (t === 'money') c.numFmt = FMT.MONEY; else if (t === 'int') c.numFmt = '0';
    }));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, spec.rows.length + 1), column: spec.cols.length } };
    return ws;
  }

  function buildOnHandWorkbook(ExcelJS, rows, asOf, containers, listsIn, voyagesIn, customersIn, extra) {
    extra = extra || {};
    containers = containers || [];
    const LS = listsIn || {};
    const pick = (k, d) => (Array.isArray(LS[k]) && LS[k].length ? LS[k] : d);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'On-Hand Vehicles Tracker';
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };

    const FONT = { name: 'Arial', size: 10 };
    const BOLD = { name: 'Arial', size: 10, bold: true };
    const HEAD = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const HEADFILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A4D' } };
    const INPUT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    const CALC = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } };
    const BLUE = { name: 'Arial', size: 10, color: { argb: 'FF0000FF' } };
    const MONEY = '#,##0;(#,##0);-';
    const INT = '#,##0;(#,##0);-';
    const DATE = 'dd-mmm-yyyy';

    const shippers = uniq(pick('shippers', pick('vShippers', DEFAULT_SHIPPERS)), rows.map((r) => r.shipper));
    const statuses = uniq(pick('vStatus', DEFAULT_STATUSES), rows.map((r) => r.status));
    const titles = uniq(pick('titles', TITLES), rows.map((r) => r.title));

    const dash = wb.addWorksheet('On-Hand Dashboard', { views: [{ showGridLines: false }] });
    const ship = wb.addWorksheet('Shipments Dashboard', { views: [{ showGridLines: false }] });
    const data = wb.addWorksheet('Vehicles', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cont = wb.addWorksheet('Containers', { views: [{ state: 'frozen', ySplit: 1 }] });
    const lists = wb.addWorksheet('Lists');

    // ---------- Lists ----------
    const cShippers = uniq(uniq(shippers, pick('cShippers', [])), containers.map((c) => c.shipper));
    const listCols = [['shipper', cShippers], ['title', titles], ['status', statuses], ['exit_reason', pick('exits', EXITS)], ['age_band', BANDS], ['container_status', uniq(pick('cStatus', CSTATUS), containers.map((c) => c.status))], ['pod', pick('ports', PORTS)], ['line', uniq(pick('lines', LINES), containers.map((c) => c.line))], ['clearance', pick('clearance', CLEAR)], ['release', pick('release', ['Received'])], ['origin', pick('origins', ['New Jersey', 'Georgia', 'Texas', 'California', 'Canada', 'Mersin'])]];
    listCols.forEach(([name, vals], i) => {
      const col = i + 1;
      const h = lists.getCell(1, col); h.value = name; h.font = HEAD; h.fill = HEADFILL;
      vals.forEach((v, j) => { const c = lists.getCell(j + 2, col); c.value = v; c.font = BLUE; });
      lists.getColumn(col).width = 24;
    });
    lists.getCell(32, 1).value = 'Add new values at the bottom of a column (blue text). Dropdowns on the Data sheet read rows 2-30.';
    lists.getCell(32, 1).font = { name: 'Arial', size: 9, italic: true };

    // ---------- Data ----------
    const COLS = [
      ['vin', 22], ['no', 6], ['shipper', 12], ['vehicle', 40], ['price', 12], ['arrived', 13],
      ['days', 8], ['age_band', 10], ['title', 8], ['status', 20], ['buyer', 18], ['remarks', 36],
      ['exit_date', 13], ['exit_reason', 12], ['on_hand', 9], ['container', 14], ['customer', 30],
    ];
    COLS.forEach(([h, w], i) => {
      const c = data.getCell(1, i + 1); c.value = h; c.font = HEAD; c.fill = HEADFILL; c.alignment = { horizontal: 'center' };
      data.getColumn(i + 1).width = w;
    });
    const sorted = rows.slice().sort((a, b) => String(a.arrived || '').localeCompare(String(b.arrived || '')) || String(a.vin).localeCompare(String(b.vin)));
    const last = Math.max(2, sorted.length + 1);
    const maxRow = last + 500; // room to add rows in Excel
    for (let r = 2; r <= maxRow; r++) {
      const v = sorted[r - 2];
      if (v) {
        const vals = [v.vin, v.no ?? null, v.shipper || null, v.vehicle || null, Number(v.price) || 0, toDate(v.arrived)];
        vals.forEach((val, i) => { const c = data.getCell(r, i + 1); c.value = val; c.font = BLUE; });
        [[9, v.title], [10, v.status], [11, v.buyer], [12, v.remarks], [13, toDate(v.exit_date)], [14, v.exit_reason], [16, v.container], [17, v.customer]].forEach(([col, val]) => {
          const c = data.getCell(r, col); c.value = val || null; c.font = BLUE;
        });
      } else {
        [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 16, 17].forEach((col) => { data.getCell(r, col).font = BLUE; });
      }
      data.getCell(r, 5).numFmt = MONEY;
      data.getCell(r, 6).numFmt = DATE;
      data.getCell(r, 13).numFmt = DATE;
      const g = data.getCell(r, 7);
      g.value = { formula: `IF(F${r}="","",IF(M${r}="",'On-Hand Dashboard'!$C$4,M${r})-F${r})` }; g.numFmt = '0'; g.fill = CALC; g.font = FONT;
      const h = data.getCell(r, 8);
      h.value = { formula: `IF(G${r}="","",IF(G${r}<=10,"0-10",IF(G${r}<=30,"11-30",IF(G${r}<=60,"31-60",IF(G${r}<=90,"61-90",IF(G${r}<=180,"91-180","180+"))))))` };
      h.fill = CALC; h.font = FONT;
      const o = data.getCell(r, 15);
      o.value = { formula: `IF(A${r}="","",IF(M${r}="","Yes","No"))` }; o.fill = CALC; o.font = FONT;
      const list = (col, ref) => { data.getCell(r, col).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorTitle: 'Pick from the list', error: 'Choose a value from the list, or add it on the Lists sheet.' }; };
      list(3, 'Lists!$A$2:$A$30'); list(9, 'Lists!$B$2:$B$30'); list(10, 'Lists!$C$2:$C$30'); list(14, 'Lists!$D$2:$D$30');
    }
    // extra columns (R onwards): towing, title and flow status from the tracker. Columns A-Q stay as before (dashboard formulas use them).
    const VX = extra.vehCols || [];
    VX.forEach(([hd, w], i) => { const c = data.getCell(1, 18 + i); c.value = hd; c.font = HEAD; c.fill = HEADFILL; c.alignment = { horizontal: 'center', wrapText: true }; data.getColumn(18 + i).width = w || 14; });
    if (VX.length) sorted.forEach((v, i) => { const vals = (extra.vehVals && extra.vehVals[v.vin]) || []; vals.forEach((val, j) => { const t = VX[j][2]; const c = data.getCell(i + 2, 18 + j); c.value = t === 'date' ? toDate(val) : val === '' || val == null ? null : val; c.font = FONT; if (t === 'date') c.numFmt = DATE; else if (t === 'money') c.numFmt = MONEY; }); });
    data.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: 17 + VX.length } };
    data.getCell('G1').note = 'Calculated: days from arrived to the As-of date on the Dashboard (or to exit_date once a car has left). Do not type here.';
    data.getCell('O1').note = 'Calculated: Yes while exit_date is empty. Fill exit_date and exit_reason when a car is shipped or sold.';
    data.addConditionalFormatting({
      ref: `A2:A${maxRow}`,
      rules: [{ type: 'expression', formulae: [`AND(A2<>"",COUNTIF($A$2:$A$${maxRow},A2)>1)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF8CBAD' } }, font: { color: { argb: 'FFC00000' }, bold: true } } }],
    });

    // ---------- Dashboard ----------
    const D = (ref) => `Vehicles!$${ref}$2:$${ref}$${maxRow}`;
    const ON = `${D('O')},"Yes"`;
    dash.getColumn(1).width = 2;
    dash.getColumn(2).width = 30;
    for (let c = 3; c <= 3 + shippers.length + 1; c++) dash.getColumn(c).width = 14;

    const t = dash.getCell('B2'); t.value = 'On-hand vehicles dashboard'; t.font = { name: 'Arial', size: 16, bold: true };
    dash.getCell('B4').value = 'As-of date (change to recalculate)'; dash.getCell('B4').font = BOLD;
    const asof = dash.getCell('C4'); asof.value = toDate(asOf); asof.numFmt = DATE; asof.fill = INPUT; asof.font = BLUE;
    asof.note = 'Days in yard are counted from each car\'s arrival to this date. Set to the export date; type a new date to recalculate.';
    dash.getCell('B5').value = 'Prices are purchase prices as entered; currency not stated in source data.';
    dash.getCell('B5').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };

    const kpis = [
      ['Vehicles on hand', `COUNTIFS(${ON})`, INT],
      ['Total purchase value', `SUMIFS(${D('E')},${ON})`, MONEY],
      ['Average days in yard', `IFERROR(AVERAGEIFS(${D('G')},${ON}),0)`, '0'],
      ['Vehicles over 30 days', `COUNTIFS(${ON},${D('G')},">30")`, INT],
      ['Value over 30 days', `SUMIFS(${D('E')},${ON},${D('G')},">30")`, MONEY],
      ['Vehicles over 90 days', `COUNTIFS(${ON},${D('G')},">90")`, INT],
      ['Value over 90 days', `SUMIFS(${D('E')},${ON},${D('G')},">90")`, MONEY],
      ['Title not received (not "Yes")', `COUNTIFS(${ON})-COUNTIFS(${ON},${D('I')},"Yes")`, INT],
      ['Shipped / sold (in data, off board)', `COUNTIFS(${D('O')},"No")`, INT],
    ];
    let r = 7;
    const sec = (row, text) => { const c = dash.getCell(row, 2); c.value = text; c.font = { name: 'Arial', size: 12, bold: true }; };
    sec(r, 'Headline figures'); r++;
    kpis.forEach(([label, f, fmt]) => {
      dash.getCell(r, 2).value = label; dash.getCell(r, 2).font = FONT;
      const c = dash.getCell(r, 3); c.value = { formula: f }; c.numFmt = fmt; c.font = BOLD;
      r++;
    });

    const matrix = (startRow, title, valueFormula, fmt) => {
      sec(startRow, title);
      const hr = startRow + 1;
      const hdr = ['Age band', ...shippers, 'Total'];
      hdr.forEach((h, i) => { const c = dash.getCell(hr, 2 + i); c.value = h; c.font = HEAD; c.fill = HEADFILL; c.alignment = { horizontal: 'center' }; });
      BANDS.forEach((b, bi) => {
        const rr = hr + 1 + bi;
        dash.getCell(rr, 2).value = b + ' days'; dash.getCell(rr, 2).font = FONT;
        shippers.forEach((s, si) => {
          const col = 3 + si;
          const c = dash.getCell(rr, col);
          c.value = { formula: valueFormula(`"${b}"`, `"${s.replace(/"/g, '""')}"`) }; c.numFmt = fmt; c.font = FONT;
        });
        const tc = dash.getCell(rr, 3 + shippers.length);
        const from = dash.getCell(rr, 3).address, to = dash.getCell(rr, 2 + shippers.length).address;
        tc.value = { formula: `SUM(${from}:${to})` }; tc.numFmt = fmt; tc.font = BOLD;
      });
      const tr = hr + 1 + BANDS.length;
      dash.getCell(tr, 2).value = 'Total'; dash.getCell(tr, 2).font = BOLD;
      for (let i = 0; i <= shippers.length; i++) {
        const col = 3 + i;
        const a = dash.getCell(hr + 1, col).address, z = dash.getCell(tr - 1, col).address;
        const c = dash.getCell(tr, col); c.value = { formula: `SUM(${a}:${z})` }; c.numFmt = fmt; c.font = BOLD;
        c.border = { top: { style: 'thin' } };
      }
      return tr + 2;
    };
    r += 1;
    r = matrix(r, 'Vehicles by age band and loader', (b, s) => `COUNTIFS(${ON},${D('H')},${b},${D('C')},${s})`, INT);
    r = matrix(r, 'Purchase value by age band and loader', (b, s) => `SUMIFS(${D('E')},${ON},${D('H')},${b},${D('C')},${s})`, MONEY);

    const breakdown = (startRow, title, items, col) => {
      sec(startRow, title);
      const hr = startRow + 1;
      ['', 'Vehicles', 'Value'].forEach((h, i) => { const c = dash.getCell(hr, 2 + i); c.value = h || title.split(' ')[1]; c.font = HEAD; c.fill = HEADFILL; });
      items.forEach((it, i) => {
        const rr = hr + 1 + i;
        dash.getCell(rr, 2).value = it; dash.getCell(rr, 2).font = FONT;
        const q = `"${String(it).replace(/"/g, '""')}"`;
        const a = dash.getCell(rr, 3); a.value = { formula: `COUNTIFS(${ON},${D(col)},${q})` }; a.numFmt = INT; a.font = FONT;
        const b = dash.getCell(rr, 4); b.value = { formula: `SUMIFS(${D('E')},${ON},${D(col)},${q})` }; b.numFmt = MONEY; b.font = FONT;
      });
      const br = hr + 1 + items.length;
      dash.getCell(br, 2).value = 'Blank / not recorded'; dash.getCell(br, 2).font = FONT;
      const a = dash.getCell(br, 3); a.value = { formula: `COUNTIFS(${ON},${D(col)},"")` }; a.numFmt = INT; a.font = FONT;
      const b = dash.getCell(br, 4); b.value = { formula: `SUMIFS(${D('E')},${ON},${D(col)},"")` }; b.numFmt = MONEY; b.font = FONT;
      return br + 2;
    };
    r = breakdown(r, 'By status', statuses, 'J');
    r = breakdown(r, 'By title', titles, 'I');

    dash.getCell(r, 2).value = 'Every figure above is a formula over the Data sheet. Edit Data (blue cells) or the As-of date and the dashboard recalculates.';
    dash.getCell(r, 2).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
    buildShipments(ExcelJS, wb, ship, cont, containers, cShippers, { FONT, BOLD, HEAD, HEADFILL, CALC, BLUE, INT, DATE, sec: null }, data, maxRow);
    buildVoyages(wb, voyagesIn || [], { FONT, HEAD, HEADFILL, CALC, BLUE, DATE }, containers.length + 501);
    if (customersIn && customersIn.length) {
      const cs = wb.addWorksheet('Customers', { views: [{ state: 'frozen', ySplit: 1 }] });
      const conMax = containers.length + 501;
      [['customer_id', 14], ['name', 34], ['contact', 20], ['phone', 16], ['email', 26], ['city', 18], ['notes', 30], ['containers', 11]].forEach(([hd, w], i) => { const c = cs.getCell(1, i + 1); c.value = hd; c.font = HEAD; c.fill = HEADFILL; cs.getColumn(i + 1).width = w; });
      customersIn.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach((u, i) => {
        const r = i + 2;
        [u.id, u.name, u.contact, u.phone, u.email, u.city, u.notes].forEach((v, j) => { const c = cs.getCell(r, j + 1); c.value = v || null; c.font = BLUE; });
        const k = cs.getCell(r, 8); k.value = { formula: `COUNTIF(Containers!$N$2:$N$${conMax},B${r})` }; k.fill = CALC; k.font = FONT;
      });
    }
    for (const spec of extra.sheets || []) sheetFromTable(wb, spec, { FONT, HEAD, HEADFILL, DATE, MONEY });
    wb.views = [{ activeTab: 0 }];
    return wb;
  }

  function buildShipments(ExcelJS, wb, ship, cont, containers, shippers, S, vehSheet, vehMax) {
    const { FONT, BOLD, HEAD, HEADFILL, CALC, BLUE, INT, DATE } = S;
    const COLS = [['container', 15], ['shipper', 12], ['booking', 13], ['line', 12], ['origin', 12], ['etd', 13], ['eta', 13], ['week_start_sat', 14],
      ['status', 26], ['pod', 13], ['clearance', 12], ['release', 10], ['vessel', 16], ['customer', 30], ['cars_linked', 11], ['voyage_id', 14], ['voyage', 34]];
    COLS.forEach(([h, w], i) => { const c = cont.getCell(1, i + 1); c.value = h; c.font = HEAD; c.fill = HEADFILL; c.alignment = { horizontal: 'center' }; cont.getColumn(i + 1).width = w; });
    const rows = containers.slice().sort((a, b) => String(a.eta || '').localeCompare(String(b.eta || '')) || String(a.container).localeCompare(String(b.container)));
    const last = Math.max(2, rows.length + 1), maxRow = last + 500;
    for (let r = 2; r <= maxRow; r++) {
      const v = rows[r - 2];
      const vals = v ? [v.container, v.shipper, v.booking, v.line, v.origin, toDate(v.etd), toDate(v.eta), null, v.status, v.pod, v.clearance, v.release, v.vessel, v.consignee] : [];
      for (let col = 1; col <= 14; col++) {
        if (col === 8) continue;
        const c = cont.getCell(r, col); c.font = BLUE;
        if (v) c.value = vals[col - 1] === '' || vals[col - 1] == null ? null : vals[col - 1];
      }
      cont.getCell(r, 6).numFmt = DATE; cont.getCell(r, 7).numFmt = DATE;
      const h = cont.getCell(r, 8); h.value = { formula: `IF(G${r}="","",G${r}-MOD(WEEKDAY(G${r},1),7))` }; h.numFmt = DATE; h.fill = CALC; h.font = FONT;
      const o = cont.getCell(r, 15); o.value = { formula: `IF(A${r}="","",COUNTIF(Vehicles!$P$2:$P$${vehMax},A${r}))` }; o.fill = CALC; o.font = FONT; o.numFmt = '0';
      const list = (col, ref) => { cont.getCell(r, col).dataValidation = { type: 'list', allowBlank: true, formulae: [ref], showErrorMessage: true, errorTitle: 'Pick from the list', error: 'Choose a value from the list, or add it on the Lists sheet.' }; };
      list(2, 'Lists!$A$2:$A$30'); list(9, 'Lists!$F$2:$F$30'); list(10, 'Lists!$G$2:$G$30'); list(4, 'Lists!$H$2:$H$30'); list(11, 'Lists!$I$2:$I$30'); list(12, 'Lists!$J$2:$J$30');
    }
    cont.autoFilter = { from: 'A1', to: `Q${last}` };
    rows.forEach((v, i) => { const r = i + 2; cont.getCell(r, 16).value = v.voyage_id || null; cont.getCell(r, 17).value = v.voyage || null; cont.getCell(r, 16).font = BLUE; cont.getCell(r, 17).font = FONT; });
    cont.getCell('H1').note = 'Calculated: the Saturday that starts the ETA week (weeks run Saturday to Friday).';
    cont.getCell('O1').note = 'Calculated: number of cars on the Vehicles sheet whose container column matches.';
    cont.addConditionalFormatting({ ref: `A2:A${maxRow}`, rules: [{ type: 'expression', formulae: [`AND(A2<>"",COUNTIF($A$2:$A$${maxRow},A2)>1)`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF8CBAD' } }, font: { color: { argb: 'FFC00000' }, bold: true } } }] });

    const C = (ref) => `Containers!$${ref}$2:$${ref}$${maxRow}`;
    ship.getColumn(1).width = 2; ship.getColumn(2).width = 18; ship.getColumn(3).width = 14;
    const t = ship.getCell('B2'); t.value = 'Shipments weekly dashboard'; t.font = { name: 'Arial', size: 16, bold: true };
    ship.getCell('B3').value = 'Weeks run Saturday to Friday, grouped by ETA. Every figure is a formula over the Containers sheet.';
    ship.getCell('B3').font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
    const kp = [['Containers', `COUNTA(${C('A')})`], ['On the water', `COUNTIFS(${C('I')},"On the water")`], ['Arrived, cleared', `COUNTIFS(${C('I')},"Arrived, cleared")`], ['Arrived, not marked cleared', `COUNTIFS(${C('I')},"Arrived, not marked cleared")`]];
    kp.forEach(([l, f], i) => { ship.getCell(5 + i, 2).value = l; ship.getCell(5 + i, 2).font = FONT; const c = ship.getCell(5 + i, 3); c.value = { formula: f }; c.numFmt = INT; c.font = BOLD; });

    const weeks = new Set(rows.map((r) => r.eta).filter(Boolean).map((e) => { const d = toDate(e); const dow = d.getUTCDay(); return d.getTime() - ((dow + 1) % 7) * 864e5; }));
    const span = weeks.size ? Math.round((Math.max(...weeks) - Math.min(...weeks)) / (7 * 864e5)) + 1 : 1;
    const nWeeks = span + 12;
    const hr = 11;
    const statusCols = CSTATUS;
    const hdr = ['Week starting (Sat)', 'Week ending (Fri)', ...statusCols, 'Total', ...shippers];
    const sec = ship.getCell(hr - 1, 2); sec.value = 'Containers by ETA week'; sec.font = { name: 'Arial', size: 12, bold: true };
    hdr.forEach((h, i) => { const c = ship.getCell(hr, 2 + i); c.value = h; c.font = HEAD; c.fill = HEADFILL; c.alignment = { horizontal: 'center', wrapText: true }; if (i >= 2) ship.getColumn(2 + i).width = 13; });
    ship.getRow(hr).height = 30;
    for (let i = 0; i < nWeeks; i++) {
      const r = hr + 1 + i;
      const a = ship.getCell(r, 2);
      a.value = { formula: i === 0 ? `IF(COUNT(${C('H')})=0,"",MIN(${C('H')}))` : `IF(B${r - 1}="","",IF(B${r - 1}+7>MAX(${C('H')}),"",B${r - 1}+7))` };
      a.numFmt = DATE; a.font = BOLD;
      const b = ship.getCell(r, 3); b.value = { formula: `IF(B${r}="","",B${r}+6)` }; b.numFmt = DATE; b.font = FONT;
      statusCols.forEach((s, si) => {
        const c = ship.getCell(r, 4 + si); c.value = { formula: `IF($B${r}="","",COUNTIFS(${C('H')},$B${r},${C('I')},"${s}"))` }; c.numFmt = INT; c.font = FONT;
      });
      const tc = ship.getCell(r, 4 + statusCols.length); tc.value = { formula: `IF($B${r}="","",COUNTIFS(${C('H')},$B${r}))` }; tc.numFmt = INT; tc.font = BOLD;
      shippers.forEach((s, si) => {
        const col = 5 + statusCols.length + si;
        const c = ship.getCell(r, col); c.value = { formula: `IF($B${r}="","",COUNTIFS(${C('H')},$B${r},${C('B')},"${String(s).replace(/"/g, '""')}"))` }; c.numFmt = INT; c.font = FONT;
      });
    }
    const note = ship.getCell(hr + nWeeks + 2, 2);
    note.value = 'Rows fill in automatically as ETAs are added on the Containers sheet (up to ' + nWeeks + ' weeks from the earliest ETA).';
    note.font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF666666' } };
  }

  function buildVoyages(wb, voyages, S, conMax) {
    const { FONT, HEAD, HEADFILL, CALC, BLUE, DATE } = S;
    const ws = wb.addWorksheet('Voyages', { views: [{ state: 'frozen', ySplit: 1 }] });
    const COLS = [['voyage_id', 16], ['vessel', 22], ['voyage_no', 12], ['line', 12], ['origin', 14], ['pod', 13], ['etd', 13], ['eta', 13], ['status', 10], ['notes', 30], ['containers', 11]];
    COLS.forEach(([hd, w], i) => { const c = ws.getCell(1, i + 1); c.value = hd; c.font = HEAD; c.fill = HEADFILL; ws.getColumn(i + 1).width = w; });
    const ys = voyages.slice().sort((a, b) => String(a.eta || '').localeCompare(String(b.eta || '')));
    ys.forEach((y, i) => {
      const r = i + 2;
      [y.id, y.vessel, y.voyage_no, y.line, y.origin, y.pod, toDate(y.etd), toDate(y.eta), y.status, y.notes].forEach((v, j) => { const c = ws.getCell(r, j + 1); c.value = v === '' || v == null ? null : v; c.font = BLUE; });
      ws.getCell(r, 7).numFmt = DATE; ws.getCell(r, 8).numFmt = DATE;
      const k = ws.getCell(r, 11); k.value = { formula: `COUNTIF(Containers!$P$2:$P$${conMax},A${r})` }; k.fill = CALC; k.font = FONT;
    });
    ws.autoFilter = { from: 'A1', to: `K${Math.max(2, ys.length + 1)}` };
    ws.getCell('K1').note = 'Calculated: containers on the Containers sheet whose voyage_id matches.';
  }

  /* Import template: Instructions + Vehicles + Containers + Lists (dropdown sources). */
  function buildImportTemplate(ExcelJS, L, customers, voyages) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Vehicle & Shipment Tracker';
    const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F8B' } }, alignment: { vertical: 'middle' } };
    const REQ = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F4C61' } };
    const ROWS = 1000;
    const info = wb.addWorksheet('Instructions');
    const cols = [
      ['Loaders', L.shippers || []], ['Customers', customers || []], ['Electric', ['Yes']], ['Pickup status', L.vStatus || []],
      ['Voyage', voyages || []], ['Clearance', L.clearance || []], ['Auction accounts', L.auctions || []], ['Size', L.sizes || []], ['Loading yard', L.origins || []],
      ['Title type', L.titleTypes || []], ['Title status', L.titleLocs || []], ['Yes / No', ['Yes', 'No']], ['Eligibility', ['Eligible', 'Ineligible']], ['Approval', ['Requested', 'Approved', 'Rejected']], ['Load', ['Full', 'Mix', 'Group']],
    ];
    const ref = {};
    cols.forEach(([name, vals], i) => { const letter = String.fromCharCode(65 + i); ref[name] = `Lists!$${letter}$2:$${letter}$${Math.max(2, vals.length + 1)}`; });
    const sheet = (name, spec) => {
      const ws = wb.addWorksheet(name);
      spec.forEach((s, i) => {
        const col = ws.getColumn(i + 1); col.width = s.w || 18;
        const cell = ws.getCell(1, i + 1);
        cell.value = s.h; Object.assign(cell, HEAD); if (s.req) cell.fill = REQ;
        cell.note = s.note;
        for (let r = 2; r <= ROWS + 1; r++) {
          const c = ws.getCell(r, i + 1);
          if (s.fmt) c.numFmt = s.fmt;
          if (s.list) c.dataValidation = { type: 'list', allowBlank: true, formulae: [ref[s.list]], showErrorMessage: true, errorStyle: s.strict ? 'stop' : 'warning', errorTitle: s.h, error: s.strict ? `Pick a ${s.h.toLowerCase()} from the list. Add new ones in the tracker first.` : 'Not in the tracker list. It will still import, and an editor can add it to the list in Settings.' };
          if (s.date) c.dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorTitle: 'Date', error: 'Enter a date, e.g. 02-Nov-2026.' };
        }
      });
      ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.length } };
      return ws;
    };
    sheet('Vehicles', [
      { h: 'VIN', w: 22, req: true, fmt: '@', note: 'Required. 17 characters. Rows are matched on VIN: a new VIN adds a car, an existing VIN updates it.' },
      { h: 'Lot #', w: 14, req: true, fmt: '@', note: 'Required for new cars. Auction lot / order ID.' },
      { h: 'Vehicle', w: 34, note: 'Year make model, e.g. 2024 TOYOTA LAND CRUISER' },
      { h: 'Buyer', w: 22, req: true, list: 'Auction accounts', note: 'Required for new cars. Auction buyer account, e.g. Copart - 507250. A bare number (507250) or "COPART 507250" is matched on import.' },
      { h: 'Customer', w: 26, req: true, list: 'Customers', strict: true, note: 'Required for new cars. Must be a customer that exists in the tracker.' },
      { h: 'Price', w: 12, fmt: '#,##0', note: 'Purchase price, number only.' },
      { h: 'Purchase date', w: 14, fmt: 'dd-mmm-yyyy', date: true, note: 'Date the car was won / bought at auction.' },
      { h: 'Gate PIN', w: 12, fmt: '@', note: 'Release / gate PIN, if known. Can also be added later on the Towing screen.' },
      { h: 'Pickup location', w: 30, note: 'Auction yard, city / state, e.g. GA - ATLANTA WEST' },
      { h: 'Electric', w: 9, list: 'Electric', note: 'Yes for electric cars (dangerous goods, needs DGD).' },
      { h: 'Remarks', w: 36 },
    ]);
    sheet('Containers', [
      { h: 'Container', w: 16, req: true, fmt: '@', note: 'Required. Container number, 4 letters + 7 digits (e.g. MSKU1234565); the check digit is verified. Rows are matched on it: new numbers are added; existing ones are updated only when "Update existing containers" is ticked.' },
      { h: 'Loader', w: 16, req: true, list: 'Loaders', note: 'Required for new containers.' },
      { h: 'Full / Mix / Group', w: 14, req: true, list: 'Load', strict: true, note: 'Required for new containers. Full = one customer; Mix = several customers, consignee is a group company; Group = group companies only.' },
      { h: 'Customer (consignee)', w: 26, req: true, list: 'Customers', strict: true, note: 'Required for new containers. Must exist in the tracker. Mix and Group: must be a group company.' },
      { h: 'Voyage', w: 44, req: true, list: 'Voyage', note: 'Required for new containers. An existing voyage: pick from the list, or type vessel + voyage no. (e.g. TEMA MAERSK 644E) or the voyage no. alone when it is unique.' },
      { h: 'Booking', w: 16, fmt: '@' },
      { h: 'Size', w: 10, list: 'Size' },
      { h: 'Clearance', w: 16, list: 'Clearance' },
      { h: 'Notes', w: 36 },
    ]);
    const lists = wb.addWorksheet('Lists');
    cols.forEach(([name, vals], i) => {
      lists.getColumn(i + 1).width = name === 'Voyage' ? 48 : 26;
      lists.getCell(1, i + 1).value = name; Object.assign(lists.getCell(1, i + 1), HEAD);
      vals.forEach((v, j) => { lists.getCell(j + 2, i + 1).value = v; });
    });
    lists.views = [{ state: 'frozen', ySplit: 1 }];
    info.getColumn(1).width = 110;
    const lines = [
      ['Vehicle & Shipment Tracker: import template', { bold: true, size: 14 }],
      [''],
      ['How to use', { bold: true }],
      ['1. Fill the Vehicles sheet and/or the Containers sheet. Keep the header row as it is. Dark header = required for new records.'],
      ['2. In the tracker, open Vehicles (On hand) or Containers, click "Bulk entry / Import", then "Upload Excel / CSV". It reads the matching sheet.'],
      ['3. Check the grid (each row shows New / Update or what to fix), then click Save rows.'],
      [''],
      ['Rules', { bold: true }],
      ['• Rows are matched on VIN (vehicles) or container number (containers). New ones are added. Existing cars are not changed by import; existing containers are updated only when "Update existing containers" is ticked.'],
      ['• Empty cells leave the current value unchanged. Nothing is ever deleted by an import.'],
      ['• Customer and Voyage must already exist in the tracker. Buyer, loader, size and clearance should come from the dropdowns.'],
      ['• Vehicles: only the auction details are imported. Towing (payment, dispatch, loader, delivery), titles and loading are done on their own screens in the tracker.'],
      ['• Cars are put into containers from the container screen, not by import. Arrived-and-cleared records are locked and skipped.'],
      ['• New cars get the next running number automatically.'],
      ['• Dropdowns reflect the tracker lists on the day this template was downloaded. Download a fresh template if lists have changed.'],
    ];
    lines.forEach(([txt, font], i) => { const c = info.getCell(i + 1, 1); c.value = txt; if (font) c.font = font; c.alignment = { wrapText: true }; });
    lists.state = 'hidden';
    wb.views = [{ activeTab: 1 }];
    return wb;
  }

  root.buildOnHandWorkbook = buildOnHandWorkbook;
  root.buildImportTemplate = buildImportTemplate;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildOnHandWorkbook, buildImportTemplate };
})(typeof window !== 'undefined' ? window : globalThis);

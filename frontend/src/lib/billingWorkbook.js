const NAVY = "020617";
const TEAL = "0F766E";
const LIGHT_TEAL = "CCFBF1";
const LIGHT_SLATE = "F1F5F9";
const BORDER = "CBD5E1";
const WHITE = "FFFFFF";
const CURRENCY_FORMAT = '€ #,##0.00';
const DATE_FORMAT = "dd/mm/yyyy hh:mm";

async function excelWorkbookClass() {
  const module = await import("exceljs/dist/exceljs.min.js");
  return module.Workbook || module.default?.Workbook;
}

function text(value) {
  return value == null ? "" : String(value);
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function date(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed;
}

function safeFilePart(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "cliente";
}

function address(order) {
  return [order?.recipient?.address1, order?.recipient?.address2].filter(Boolean).join(", ");
}

function prepareSheet(worksheet, title, subtitle, columns) {
  worksheet.properties.defaultRowHeight = 19;
  worksheet.mergeCells(1, 1, 1, columns.length);
  worksheet.getCell(1, 1).value = title;
  worksheet.getCell(1, 1).font = { size: 20, bold: true, color: { argb: WHITE } };
  worksheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  worksheet.getCell(1, 1).alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 34;

  worksheet.mergeCells(2, 1, 2, columns.length);
  worksheet.getCell(2, 1).value = subtitle;
  worksheet.getCell(2, 1).font = { size: 10, color: { argb: "475569" } };
  worksheet.getRow(2).height = 25;

  const header = worksheet.getRow(4);
  header.values = columns.map((column) => column.header);
  header.height = 29;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER } } };
  });
  worksheet.columns = columns.map((column) => ({
    key: column.key,
    width: column.width || 15,
    style: column.style || {},
  }));
  worksheet.views = [{ state: "frozen", ySplit: 4 }];
  worksheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function finishSheet(worksheet, columnCount, lastRow) {
  for (let rowNumber = 5; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_SLATE } };
      });
    }
    row.eachCell((cell) => {
      cell.alignment = { ...cell.alignment, vertical: "top", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: BORDER } } };
    });
  }
  if (lastRow >= 5) {
    worksheet.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: lastRow, column: columnCount },
    };
  }
}

function addTotalRow(worksheet, labelColumn, valueColumns, firstDataRow, lastDataRow) {
  const rowNumber = worksheet.rowCount + 2;
  const row = worksheet.getRow(rowNumber);
  row.getCell(labelColumn).value = "TOTALE";
  row.getCell(labelColumn).font = { bold: true, color: { argb: WHITE } };
  for (const column of valueColumns) {
    const letter = worksheet.getColumn(column).letter;
    row.getCell(column).value = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` };
    row.getCell(column).numFmt = CURRENCY_FORMAT;
  }
  for (let column = labelColumn; column <= worksheet.columnCount; column += 1) {
    row.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    row.getCell(column).font = { ...row.getCell(column).font, bold: true, color: { argb: WHITE } };
  }
}

function addSummarySheet(workbook, invoice) {
  const columns = [
    { key: "description", header: "Voce", width: 36 },
    { key: "quantity", header: "Quantità", width: 14 },
    { key: "unit_price", header: "Prezzo unitario", width: 18, style: { numFmt: CURRENCY_FORMAT } },
    { key: "amount", header: "Importo", width: 18, style: { numFmt: CURRENCY_FORMAT } },
  ];
  const sheet = workbook.addWorksheet("Riepilogo", { properties: { tabColor: { argb: TEAL } } });
  prepareSheet(sheet, `Fatturazione ${invoice.ragione_sociale}`, `Periodo ${invoice.periodo} · importi in EUR`, columns);
  (invoice.righe || []).forEach((item) => {
    const row = sheet.addRow({
      description: item.descrizione,
      quantity: number(item.quantita),
      unit_price: number(item.prezzo),
    });
    row.getCell(4).value = { formula: `B${row.number}*C${row.number}` };
  });
  finishSheet(sheet, columns.length, sheet.rowCount);

  const firstRow = 5;
  const lastRow = Math.max(firstRow, sheet.rowCount);
  const subtotalRow = sheet.rowCount + 2;
  sheet.getCell(`C${subtotalRow}`).value = "Imponibile";
  sheet.getCell(`D${subtotalRow}`).value = { formula: `SUM(D${firstRow}:D${lastRow})` };
  sheet.getCell(`C${subtotalRow + 1}`).value = `IVA ${number(invoice.iva_perc)}%`;
  sheet.getCell(`D${subtotalRow + 1}`).value = { formula: `D${subtotalRow}*${number(invoice.iva_perc) / 100}` };
  sheet.getCell(`C${subtotalRow + 2}`).value = "TOTALE";
  sheet.getCell(`D${subtotalRow + 2}`).value = { formula: `D${subtotalRow}+D${subtotalRow + 1}` };
  [subtotalRow, subtotalRow + 1, subtotalRow + 2].forEach((rowNumber) => {
    sheet.getCell(`C${rowNumber}`).font = { bold: true };
    sheet.getCell(`D${rowNumber}`).font = { bold: true };
    sheet.getCell(`D${rowNumber}`).numFmt = CURRENCY_FORMAT;
  });
  sheet.getCell(`C${subtotalRow + 2}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_TEAL } };
  sheet.getCell(`D${subtotalRow + 2}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_TEAL } };
}

function addShipmentsSheet(workbook, invoice) {
  const columns = [
    { key: "packed_at", header: "Data packing", width: 19, style: { numFmt: DATE_FORMAT } },
    { key: "order_name", header: "Ordine", width: 20 },
    { key: "shopify_id", header: "ID Shopify / SHP", width: 24 },
    { key: "shop", header: "Negozio", width: 24 },
    { key: "tracking", header: "Tracking / etichetta", width: 24 },
    { key: "recipient", header: "Destinatario", width: 24 },
    { key: "company", header: "Azienda", width: 22 },
    { key: "address", header: "Indirizzo", width: 30 },
    { key: "zip", header: "CAP", width: 10 },
    { key: "city", header: "Città", width: 18 },
    { key: "province", header: "Provincia", width: 12 },
    { key: "country", header: "Paese", width: 15 },
    { key: "products", header: "Prodotti prelevati", width: 48 },
    { key: "pieces", header: "Pezzi", width: 10 },
    { key: "weight", header: "Peso tassabile kg", width: 16 },
    { key: "carrier", header: "Corriere", width: 12 },
    { key: "service", header: "Servizio", width: 16 },
    { key: "zone", header: "Zona", width: 14 },
    { key: "shipping", header: "Spedizione", width: 15, style: { numFmt: CURRENCY_FORMAT } },
    { key: "base_fee", header: "Gestione ordine", width: 17, style: { numFmt: CURRENCY_FORMAT } },
    { key: "extra_quantity", header: "Pezzi extra", width: 12 },
    { key: "extra_cost", header: "Costo extra", width: 15, style: { numFmt: CURRENCY_FORMAT } },
    { key: "packaging", header: "Imballaggio", width: 20 },
    { key: "packaging_cost", header: "Costo imballaggio", width: 18, style: { numFmt: CURRENCY_FORMAT } },
    { key: "net_total", header: "Totale netto", width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { key: "vat", header: "IVA %", width: 10, style: { numFmt: "0.00%" } },
    { key: "gross_total", header: "Totale lordo", width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { key: "status", header: "Stato spedizione", width: 18 },
  ];
  const sheet = workbook.addWorksheet("Spedizioni", { properties: { tabColor: { argb: "0284C7" } } });
  prepareSheet(sheet, "Spedizioni fatturate", `${invoice.ragione_sociale} · ${invoice.periodo}`, columns);
  const orders = invoice.dettaglio?.ordini_imballati?.dettaglio || [];
  orders.forEach((order) => {
    const row = sheet.addRow({
      packed_at: date(order.packed_at),
      order_name: text(order.order_name),
      shopify_id: text(order.shopify_order_id),
      shop: text(order.shop_domain),
      tracking: text(order.tracking),
      recipient: text(order.recipient?.name),
      company: text(order.recipient?.company),
      address: address(order),
      zip: text(order.recipient?.zip),
      city: text(order.recipient?.city),
      province: text(order.recipient?.province),
      country: text(order.recipient?.country),
      products: text(order.products_summary),
      pieces: number(order.pieces),
      weight: number(order.billable_weight_kg),
      carrier: text(order.carrier).toUpperCase(),
      service: text(order.shipment?.service),
      zone: text(order.shipping_zone),
      shipping: number(order.costs?.shipping),
      base_fee: number(order.costs?.base_fee),
      extra_quantity: number(order.costs?.extra_quantity),
      extra_cost: number(order.costs?.extra_total),
      packaging: text(order.packaging?.name),
      packaging_cost: number(order.costs?.packaging),
      vat: number(invoice.iva_perc) / 100,
      status: text(order.shipment?.status),
    });
    row.getCell(25).value = { formula: `SUM(S${row.number},T${row.number},V${row.number},X${row.number})` };
    row.getCell(27).value = { formula: `Y${row.number}*(1+Z${row.number})` };
  });
  finishSheet(sheet, columns.length, sheet.rowCount);
  if (orders.length) addTotalRow(sheet, 18, [19, 20, 22, 24, 25, 27], 5, 4 + orders.length);
}

function addProductsSheet(workbook, invoice) {
  const columns = [
    { key: "packed_at", header: "Data packing", width: 19, style: { numFmt: DATE_FORMAT } },
    { key: "order_name", header: "Ordine", width: 20 },
    { key: "shopify_id", header: "ID Shopify / SHP", width: 24 },
    { key: "tracking", header: "Tracking / etichetta", width: 24 },
    { key: "title", header: "Prodotto prelevato", width: 46 },
    { key: "sku", header: "SKU", width: 24 },
    { key: "ean", header: "EAN", width: 22 },
    { key: "fnsku", header: "FNSKU", width: 20 },
    { key: "quantity", header: "Quantità", width: 12 },
  ];
  const sheet = workbook.addWorksheet("Prodotti", { properties: { tabColor: { argb: "4F46E5" } } });
  prepareSheet(sheet, "Prodotti prelevati", `${invoice.ragione_sociale} · una riga per prodotto e ordine`, columns);
  (invoice.dettaglio?.ordini_imballati?.dettaglio || []).forEach((order) => {
    (order.products || []).forEach((product) => sheet.addRow({
      packed_at: date(order.packed_at),
      order_name: text(order.order_name),
      shopify_id: text(order.shopify_order_id),
      tracking: text(order.tracking),
      title: text(product.title),
      sku: text(product.sku),
      ean: text(product.ean),
      fnsku: text(product.fnsku),
      quantity: number(product.quantity),
    }));
  });
  finishSheet(sheet, columns.length, sheet.rowCount);
}

function addInboundSheet(workbook, invoice) {
  const columns = [
    { key: "received_at", header: "Data ricezione", width: 19, style: { numFmt: DATE_FORMAT } },
    { key: "id", header: "ID entrata", width: 38 },
    { key: "type", header: "Tipo", width: 13 },
    { key: "ddt", header: "DDT", width: 18 },
    { key: "carrier", header: "Corriere", width: 16 },
    { key: "tracking", header: "Tracking", width: 22 },
    { key: "status", header: "Stato", width: 16 },
    { key: "packages", header: "Colli", width: 10 },
    { key: "products", header: "Prodotti ricevuti", width: 48 },
    { key: "pieces", header: "Pezzi", width: 10 },
    { key: "unit_price", header: "Prezzo unitario", width: 17, style: { numFmt: CURRENCY_FORMAT } },
    { key: "amount", header: "Importo", width: 16, style: { numFmt: CURRENCY_FORMAT } },
  ];
  const sheet = workbook.addWorksheet("Entrate", { properties: { tabColor: { argb: "D97706" } } });
  prepareSheet(sheet, "Entrate merce", `${invoice.ragione_sociale} · ${invoice.periodo}`, columns);
  (invoice.dettaglio?.entrate || []).forEach((entry) => {
    const row = sheet.addRow({
      received_at: date(entry.data_ricezione),
      id: text(entry.id),
      type: text(entry.tipo),
      ddt: text(entry.ddt),
      carrier: text(entry.corriere),
      tracking: text(entry.tracking),
      status: text(entry.stato),
      packages: number(entry.costo?.quantita),
      products: (entry.righe || []).map((item) => `${item.titolo || item.ean} x${number(item.quantita)}`).join("; "),
      pieces: number(entry.pezzi),
      unit_price: number(entry.costo?.prezzo),
    });
    row.getCell(12).value = { formula: `H${row.number}*K${row.number}` };
  });
  finishSheet(sheet, columns.length, sheet.rowCount);
}

function addPrepSheet(workbook, invoice) {
  const columns = [
    { key: "ready_at", header: "Data pronta", width: 19, style: { numFmt: DATE_FORMAT } },
    { key: "id", header: "ID preparazione", width: 38 },
    { key: "status", header: "Stato", width: 14 },
    { key: "products", header: "Prodotti", width: 48 },
    { key: "pieces", header: "Pezzi", width: 10 },
    { key: "services", header: "Lavorazioni", width: 36 },
    { key: "boxes", header: "Box", width: 24 },
    { key: "costs", header: "Voci di costo", width: 42 },
    { key: "amount", header: "Importo", width: 16, style: { numFmt: CURRENCY_FORMAT } },
  ];
  const sheet = workbook.addWorksheet("Prep FBA", { properties: { tabColor: { argb: "7C3AED" } } });
  prepareSheet(sheet, "Preparazioni Amazon FBA", `${invoice.ragione_sociale} · ${invoice.periodo}`, columns);
  (invoice.dettaglio?.preparazioni || []).forEach((prep) => sheet.addRow({
    ready_at: date(prep.data_pronto),
    id: text(prep.id),
    status: text(prep.stato),
    products: (prep.righe || []).map((item) => `${item.titolo || item.ean} x${number(item.quantita)}`).join("; "),
    pieces: number(prep.pezzi),
    services: Object.entries(prep.servizi || {}).map(([name, quantity]) => `${name} x${quantity}`).join("; "),
    boxes: (prep.boxes || []).map((box) => box.numero_box).join(", "),
    costs: (prep.costi || []).map((cost) => `${cost.descrizione}: € ${number(cost.importo).toFixed(2)}`).join("; "),
    amount: number(prep.totale),
  }));
  finishSheet(sheet, columns.length, sheet.rowCount);
}

function addStorageSheet(workbook, invoice) {
  const columns = [
    { key: "period", header: "Periodo", width: 16 },
    { key: "pallets", header: "Pallet stoccati", width: 18 },
    { key: "unit_price", header: "Prezzo pallet/mese", width: 21, style: { numFmt: CURRENCY_FORMAT } },
    { key: "amount", header: "Importo", width: 18, style: { numFmt: CURRENCY_FORMAT } },
    { key: "recorded_at", header: "Registrato il", width: 20, style: { numFmt: DATE_FORMAT } },
  ];
  const sheet = workbook.addWorksheet("Stoccaggio", { properties: { tabColor: { argb: "059669" } } });
  prepareSheet(sheet, "Stoccaggio mensile", `${invoice.ragione_sociale} · quantità e tariffa storicizzate`, columns);
  const storage = invoice.dettaglio?.stoccaggio || {};
  const row = sheet.addRow({
    period: invoice.periodo,
    pallets: number(storage.pallet),
    unit_price: number(storage.prezzo),
    recorded_at: date(storage.registrato_il),
  });
  row.getCell(4).value = { formula: `B${row.number}*C${row.number}` };
  finishSheet(sheet, columns.length, sheet.rowCount);
}

export async function buildBillingWorkbook(invoice) {
  const Workbook = await excelWorkbookClass();
  if (!Workbook) throw new Error("Generatore Excel non disponibile");
  const workbook = new Workbook();
  workbook.creator = "Aimago Logistics";
  workbook.company = "Aimago";
  workbook.subject = `Fatturazione ${invoice.ragione_sociale} ${invoice.periodo}`;
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  addSummarySheet(workbook, invoice);
  addShipmentsSheet(workbook, invoice);
  addProductsSheet(workbook, invoice);
  addInboundSheet(workbook, invoice);
  addPrepSheet(workbook, invoice);
  addStorageSheet(workbook, invoice);
  return workbook;
}

export async function downloadBillingWorkbook(invoice) {
  const workbook = await buildBillingWorkbook(invoice);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fatturazione-${safeFilePart(invoice.ragione_sociale)}-${invoice.periodo}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

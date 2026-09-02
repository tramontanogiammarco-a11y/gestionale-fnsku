const ZEBRA_TIMEOUT_MS = 3500;

function zebraServiceUrl(path) {
  const securePage = typeof window !== "undefined" && window.location.protocol === "https:";
  return `${securePage ? "https" : "http"}://localhost:${securePage ? 9101 : 9100}/${String(path || "").replace(/^\//, "")}`;
}

async function zebraFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ZEBRA_TIMEOUT_MS);
  try {
    const response = await fetch(zebraServiceUrl(path), { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Zebra Browser Print HTTP ${response.status}`);
    return response;
  } catch (error) {
    const failure = new Error("Zebra Browser Print non disponibile");
    failure.cause = error;
    throw failure;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getDefaultZebraPrinter() {
  const response = await zebraFetch("/default?type=printer");
  const printer = await response.json();
  if (!printer?.uid) throw new Error("Nessuna stampante Zebra predefinita");
  return printer;
}

export async function printZebraPackingLabels(labels = []) {
  if (!labels.length) throw new Error("Nessuna etichetta da stampare");
  const printer = await getDefaultZebraPrinter();
  const data = labels.map(packingLabelZpl).join("\n");
  await zebraFetch("/write", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ device: zebraDevicePayload(printer), data }),
  });
  return printer;
}

export async function printZebraLocationLabels(locations = []) {
  if (!locations.length) throw new Error("Nessuna ubicazione da stampare");
  const printer = await getDefaultZebraPrinter();
  const sheets = chunk(locations, 3);
  const data = sheets.map(locationSheetZpl).join("");
  await zebraFetch("/write", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ device: zebraDevicePayload(printer), data }),
  });
  return printer;
}

export async function printZebraPackagingLabels(labels = []) {
  if (!labels.length) throw new Error("Nessun barcode imballaggio da stampare");
  const printer = await getDefaultZebraPrinter();
  const sheets = chunk(labels, 3);
  const data = sheets.map(packagingSheetZpl).join("");
  await zebraFetch("/write", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ device: zebraDevicePayload(printer), data }),
  });
  return printer;
}

export async function printZebraBagLabels(bags = []) {
  if (!bags.length) throw new Error("Nessuna bag da stampare");
  return printZebraLocationLabels(bags.map((bag) => {
    const code = bag.code || bag.codice;
    return { code, displayCode: code, qrData: code, type: "bag" };
  }));
}

function zebraDevicePayload(printer) {
  const payload = ["name", "deviceType", "connection", "uid", "provider", "manufacturer"]
    .reduce((payload, key) => {
      if (printer[key] !== undefined) payload[key] = printer[key];
      return payload;
    }, {});
  payload.version = 2;
  return payload;
}

function packingLabelZpl(label) {
  const carrier = String(label.carrier || label.selected_carrier || "gls").trim().toLowerCase();
  return carrier === "brt" ? brtPackingLabelZpl(label) : glsPackingLabelZpl(label);
}

function packingLabelData(label) {
  const code = zplText(label.code || "PK-NON-DISPONIBILE");
  const order = zplText(label.order_name || "ORDINE");
  const recipient = zplText(label.recipient_name || label.ship_name || "DESTINATARIO");
  const company = zplText(label.recipient_company || label.ship_company || "");
  const address1 = zplText(label.address1 || label.ship_address1 || "INDIRIZZO NON DISPONIBILE");
  const address2 = zplText(label.address2 || label.ship_address2 || "");
  const zip = zplText(label.zip || label.ship_zip || "00000");
  const city = zplText(label.city || label.ship_city || "DESTINAZIONE");
  const province = zplText(label.province || label.ship_province || "");
  const country = zplText(label.country || label.ship_country || "ITALIA");
  const weight = Math.max(0.1, Number(label.weight || label.shipping_billable_weight || 1)).toFixed(1);
  return { code, order, recipient, company, address1, address2, zip, city, province, country, weight };
}

function brtPackingLabelZpl(label) {
  const data = packingLabelData(label);
  const route = (data.zip.match(/\d/g) || []).join("").padEnd(5, "0");
  return [
    "^XA",
    "^MMT",
    "^MNY",
    "^LT0",
    "^PW812",
    "^LL1218",
    "^LH0,0",
    "^FO20,18^GB772,1180,3^FS",
    `^FO42,35^GB185,120,3^FS^FO62,49^A0N,78,78^FD${route.slice(0, 3)}^FS`,
    `^FO248,35^GB125,120,3^FS^FO275,49^A0N,78,78^FD${route.slice(3, 5)}^FS`,
    "^FO394,35^GB120,120,3^FS^FO428,49^A0N,78,78^FD15^FS",
    "^FO540,43^A0N,22,22^FDAIMAGO LOGISTICS^FS",
    `^FO540,79^A0N,20,20^FDKG ${data.weight}^FS`,
    `^FO540,112^A0N,18,18^FDORD ${data.order}^FS`,
    "^FO42,180^BY3,2,142",
    `^BCN,142,N,N,N^FD${data.code}^FS`,
    `^FO42,337^A0N,24,24^FDRIF ${data.code}^FS`,
    "^FO42,386^GB728,3,3^FS",
    "^FO42,414^A0N,116,116^FDBRT!!^FS",
    "^FO42,555^GB728,3,3^FS",
    `^FO55,588^A0N,42,42^FD${data.recipient}^FS`,
    ...(data.company ? [`^FO55,642^A0N,27,27^FD${data.company}^FS`] : []),
    `^FO55,${data.company ? 681 : 648}^A0N,30,30^FD${data.address1}^FS`,
    ...(data.address2 ? [`^FO55,${data.company ? 722 : 689}^A0N,26,26^FD${data.address2}^FS`] : []),
    `^FO55,${data.address2 ? 766 : data.company ? 724 : 691}^A0N,42,42^FD${data.zip} ${data.city} ${data.province}^FS`,
    "^FO42,850^GB728,3,3^FS",
    `^FO55,880^A0N,24,24^FDBRT TEST - ${data.order}^FS`,
    `^FO55,925^A0N,22,22^FD${data.country}^FS`,
    "^FO42,990^GB728,3,3^FS",
    "^FO55,1020^A0N,22,22^FDSCANSIONA DOPO LA STAMPA^FS",
    `^FO55,1060^A0N,34,34^FD${data.code}^FS`,
    "^FO650,1020^BQN,2,4",
    `^FDQA,${data.code}^FS`,
    "^PQ1,0,1,N",
    "^XZ",
  ].join("");
}

function glsPackingLabelZpl(label) {
  const data = packingLabelData(label);
  return [
    "^XA", "^MMT", "^MNY", "^LT0", "^PW812", "^LL1218", "^LH0,0",
    "^FO20,18^GB772,1180,3^FS",
    "^FO42,38^A0N,22,22^FDAIMAGO LOGISTICS^FS",
    `^FO42,74^A0N,19,19^FDORD ${data.order}   KG ${data.weight}^FS`,
    "^FO42,112^GB728,3,3^FS",
    `^FO42,145^A0N,66,66^FD${data.city}^FS`,
    `^FO650,150^A0N,52,52^FD${data.province}^FS`,
    "^FO42,230^GB728,3,3^FS",
    "^FO42,258^A0N,20,20^FDDESTINATARIO^FS",
    `^FO42,296^A0N,42,42^FD${data.recipient}^FS`,
    ...(data.company ? [`^FO42,350^A0N,25,25^FD${data.company}^FS`] : []),
    `^FO42,${data.company ? 390 : 354}^A0N,29,29^FD${data.address1}^FS`,
    ...(data.address2 ? [`^FO42,${data.company ? 432 : 396}^A0N,25,25^FD${data.address2}^FS`] : []),
    `^FO42,${data.address2 ? 472 : data.company ? 434 : 398}^A0N,36,36^FD${data.zip} ${data.city} ${data.province}^FS`,
    `^FO42,530^A0N,23,23^FD${data.country}^FS`,
    "^FO42,575^GB728,3,3^FS",
    "^FO50,610^BQN,2,7",
    `^FDQA,${data.code}^FS`,
    "^FO312,622^A0N,92,92^FDGLS.^FS",
    "^FO312,730^A0N,23,23^FDEXPRESS COURIER^FS",
    "^FO42,820^GB728,3,3^FS",
    "^FO72,858^BY3,2,150",
    `^BCN,150,N,N,N^FD${data.code}^FS`,
    `^FO210,1025^A0N,31,31^FD${data.code}^FS`,
    "^FO42,1082^GB728,3,3^FS",
    "^FO42,1110^A0N,20,20^FDGLS TEST - SCANSIONA DOPO LA STAMPA^FS",
    "^PQ1,0,1,N", "^XZ",
  ].join("");
}

function locationSheetZpl(locations) {
  const cells = locations.flatMap((location, index) => locationCellZpl(location, index * 406));
  return [
    "^XA",
    "^MMT",
    "^MNY",
    "^LT0",
    "^PW812",
    "^LL1218",
    "^LH0,0",
    ...cells,
    "^PQ1,0,1,N",
    "^XZ",
  ].join("");
}

function locationCellZpl(location, offsetY) {
  const scanCode = zplText(location.code || location.codice || "POSIZIONE");
  const displayCode = zplText(location.displayCode || scanCode.replace(/^[SP]/, ""));
  const rawType = String(location.type || location.tipo || "slot").toLowerCase();
  const type = rawType === "pallet" ? "PALLET" : rawType === "bag" ? "BAG" : "SLOT";
  const qrData = zplText(location.qrData || location.qr_data || scanCode);
  return [
    `^FO12,${offsetY + 8}^GB788,390,2^FS`,
    `^FO585,${offsetY + 18}^GB2,370,2^FS`,
    `^FO30,${offsetY + 24}^A0N,21,21^FDAIMAGO MAGAZZINO^FS`,
    `^FO468,${offsetY + 24}^A0N,21,21^FD${type}^FS`,
    `^FO30,${offsetY + 57}^A0N,62,62^FD${displayCode}^FS`,
    `^FO30,${offsetY + 126}^GB525,2,2^FS`,
    `^FO42,${offsetY + 151}^BY2,2,94`,
    `^BCN,94,N,N,N^FD${scanCode}^FS`,
    `^FO30,${offsetY + 273}^GB525,2,2^FS`,
    `^FO30,${offsetY + 292}^A0N,18,18^FDCODICE SCANNER^FS`,
    `^FO30,${offsetY + 320}^A0N,34,34^FD${scanCode}^FS`,
    ...(qrData ? [
      `^FO620,${offsetY + 76}^BQN,2,5^FDQA,${qrData}^FS`,
      `^FO621,${offsetY + 322}^A0N,18,18^FDQR POSIZIONE^FS`,
    ] : []),
  ];
}

function packagingSheetZpl(labels) {
  const cells = labels.flatMap((label, index) => packagingCellZpl(label, index * 406));
  return [
    "^XA",
    "^MMT",
    "^MNY",
    "^LT0",
    "^PW812",
    "^LL1218",
    "^LH0,0",
    ...cells,
    "^PQ1,0,1,N",
    "^XZ",
  ].join("");
}

function packagingCellZpl(label, offsetY) {
  const code = zplText(label.code || "IMBALLAGGIO");
  const title = zplText(label.title || label.titolo || code).toUpperCase();
  return [
    `^FO12,${offsetY + 8}^GB788,390,2^FS`,
    `^FO30,${offsetY + 24}^A0N,20,20^FDAIMAGO PACKING^FS`,
    `^FO30,${offsetY + 58}^A0N,46,46^FD${title}^FS`,
    `^FO30,${offsetY + 116}^GB750,2,2^FS`,
    `^FO52,${offsetY + 145}^BY3,2,112`,
    `^BCN,112,N,N,N^FD${code}^FS`,
    `^FO30,${offsetY + 286}^GB750,2,2^FS`,
    `^FO30,${offsetY + 310}^A0N,34,34^FD${code}^FS`,
    `^FO610,${offsetY + 304}^A0N,18,18^FDSCANSIONA^FS`,
  ];
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function zplText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\^~]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 48);
}

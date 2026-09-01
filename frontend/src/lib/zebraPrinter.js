const ZEBRA_TIMEOUT_MS = 3500;

function zebraServiceUrl(path) {
  const safari = typeof navigator !== "undefined" && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const secureSafari = safari && typeof window !== "undefined" && window.location.protocol === "https:";
  return `${secureSafari ? "https" : "http"}://127.0.0.1:${secureSafari ? 9101 : 9100}/${String(path || "").replace(/^\//, "")}`;
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
  const code = zplText(label.code || "PK-NON-DISPONIBILE");
  const order = zplText(label.order_name || "ORDINE");
  return [
    "^XA",
    "^MMT",
    "^MNY",
    "^LT0",
    "^PW812",
    "^LL1218",
    "^LH0,0",
    "^FO35,35^A0N,52,52^FDAIMAGO^FS",
    `^FO35,112^A0N,28,28^FDORDINE ${order}^FS`,
    "^FO35,165^GB742,3,3^FS",
    "^FO70,250^BY3,2,155",
    `^BCN,155,Y,N,N^FD${code}^FS`,
    "^FO35,520^GB742,3,3^FS",
    "^FO35,570^A0N,26,26^FDETICHETTA PACKING^FS",
    "^FO35,620^A0N,22,22^FDSCANSIONARE IL BARCODE DOPO LA STAMPA^FS",
    "^PQ1,0,1,N",
    "^XZ",
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
  const type = String(location.type || location.tipo || "slot").toLowerCase() === "pallet" ? "PALLET" : "SLOT";
  const qrUrl = zplText(location.qrUrl || location.qr_url || "");
  return [
    `^FO18,${offsetY + 8}^GB776,390,2^FS`,
    `^FO34,${offsetY + 26}^A0N,24,24^FDAIMAGO  ${type}^FS`,
    `^FO34,${offsetY + 64}^A0N,62,62^FD${displayCode}^FS`,
    `^FO34,${offsetY + 148}^BY2,2,112`,
    `^BCN,112,N,N,N^FD${scanCode}^FS`,
    `^FO34,${offsetY + 286}^A0N,24,24^FDBARCODE: ${scanCode}^FS`,
    ...(qrUrl ? [
      `^FO610,${offsetY + 52}^BQN,2,4^FDLA,${qrUrl}^FS`,
      `^FO612,${offsetY + 235}^A0N,18,18^FDAPRI POSIZIONE^FS`,
    ] : []),
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

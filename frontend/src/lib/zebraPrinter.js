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

function zplText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\^~]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
    .slice(0, 48);
}

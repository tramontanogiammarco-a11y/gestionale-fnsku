const ZEBRA_TIMEOUT_MS = 3500;

function zebraServiceUrl(path) {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:";
  return `${secure ? "https" : "http"}://localhost:${secure ? 9101 : 9100}${path}`;
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
  const body = new URLSearchParams();
  body.set("device", JSON.stringify(zebraDevicePayload(printer)));
  body.set("data", data);
  await zebraFetch("/write", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: body.toString(),
  });
  return printer;
}

function zebraDevicePayload(printer) {
  return ["name", "deviceType", "connection", "uid", "version", "provider", "manufacturer"]
    .reduce((payload, key) => {
      if (printer[key] !== undefined) payload[key] = printer[key];
      return payload;
    }, {});
}

function packingLabelZpl(label) {
  const code = zplText(label.code || "PK-NON-DISPONIBILE");
  const order = zplText(label.order_name || "ORDINE");
  return [
    "^XA",
    "^PW812",
    "^LL406",
    "^LH0,0",
    "^FO35,24^A0N,44,44^FDAIMAGO^FS",
    `^FO35,82^A0N,25,25^FDORDINE ${order}^FS`,
    "^FO35,122^GB742,2,2^FS",
    "^FO70,150^BY3,2,105",
    `^BCN,105,Y,N,N^FD${code}^FS`,
    "^FO35,330^A0N,22,22^FDETICHETTA PACKING - SCANSIONARE DOPO LA STAMPA^FS",
    "^XZ",
  ].join("\n");
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

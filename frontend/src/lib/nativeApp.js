import { Capacitor } from "@capacitor/core";

export const isNativeApp = () => Capacitor.isNativePlatform();

const SCAN_INSTRUCTIONS = {
  location: "Inquadra lo slot o il pallet",
  product: "Inquadra il barcode del prodotto",
  bag: "Inquadra il barcode della bag",
  cart: "Inquadra il barcode del carrello",
  carrier_label: "Inquadra l'etichetta del corriere",
  packing: "Inquadra il carrello o la bag",
  station: "Inquadra il QR della Packing Station",
  universal: "Inquadra un barcode o un QR code",
};

export async function scanNativeBarcode(purpose = "universal") {
  if (!isNativeApp()) return null;

  try {
    const [{
      CapacitorBarcodeScanner,
      CapacitorBarcodeScannerCameraDirection,
      CapacitorBarcodeScannerScanOrientation,
      CapacitorBarcodeScannerTypeHintALLOption,
    }, { Haptics, NotificationType }] = await Promise.all([
      import("@capacitor/barcode-scanner"),
      import("@capacitor/haptics"),
    ]);
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHintALLOption.ALL,
      cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
      scanInstructions: SCAN_INSTRUCTIONS[purpose] || SCAN_INSTRUCTIONS.universal,
      scanButton: false,
      cancelButtonAccessibilityLabel: "Chiudi scanner",
      torchButtonOnAccessibilityLabel: "Disattiva torcia",
      torchButtonOffAccessibilityLabel: "Attiva torcia",
    });
    const value = result?.ScanResult?.trim();
    if (!value) return null;
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    return value;
  } catch (error) {
    if (/cancel/i.test(error?.message || String(error))) return null;
    throw error;
  }
}

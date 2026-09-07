import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { isNativeApp } from "@/lib/nativeApp";

export default function NativeAppBridge() {
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!isNativeApp()) return undefined;

    document.documentElement.classList.add("capacitor-native");
    let disposed = false;
    let networkListener;
    Promise.all([
      import("@capacitor/network"),
      import("@capacitor/splash-screen"),
      import("@capacitor/status-bar"),
    ]).then(async ([{ Network }, { SplashScreen }, { StatusBar, Style }]) => {
      if (disposed) return;
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      SplashScreen.hide().catch(() => {});

      const { connected } = await Network.getStatus();
      if (disposed) return;
      wasOfflineRef.current = !connected;
      if (!connected) toast.error("Connessione assente. Riprova quando la rete torna disponibile.");

      networkListener = await Network.addListener("networkStatusChange", (status) => {
        if (!status.connected) {
          wasOfflineRef.current = true;
          toast.error("Connessione assente. Le operazioni sono temporaneamente sospese.");
        } else if (wasOfflineRef.current) {
          wasOfflineRef.current = false;
          toast.success("Connessione ripristinata.");
        }
      });
    }).catch(() => {});

    return () => {
      disposed = true;
      document.documentElement.classList.remove("capacitor-native");
      networkListener?.remove();
    };
  }, []);

  return null;
}

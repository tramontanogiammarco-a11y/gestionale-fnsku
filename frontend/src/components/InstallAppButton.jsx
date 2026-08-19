import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export default function InstallAppButton({ compact = false }) {
  const [installPrompt, setInstallPrompt] = useState(() => window.__aimagoInstallPrompt || null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const ios = isIosDevice();

  useEffect(() => {
    const handlePrompt = (event) => {
      event.preventDefault();
      window.__aimagoInstallPrompt = event;
      setInstallPrompt(event);
    };
    const handleReady = () => setInstallPrompt(window.__aimagoInstallPrompt || null);
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      toast.success("Aimago WMS installata");
    };
    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("aimago-install-ready", handleReady);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("aimago-install-ready", handleReady);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (installed || (!installPrompt && !ios)) return null;

  const install = async () => {
    if (!installPrompt) {
      toast.info("Su Safari tocca Condividi e poi Aggiungi alla schermata Home.");
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice?.outcome === "accepted") {
      window.__aimagoInstallPrompt = null;
      setInstallPrompt(null);
    }
  };

  return (
    <button
      type="button"
      onClick={install}
      title="Installa Aimago WMS"
      aria-label="Installa Aimago WMS"
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-slate-200 bg-white font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50",
        compact ? "h-9 w-9" : "h-9 gap-2 px-3 text-xs"
      )}
    >
      <Download className="h-4 w-4" />
      {!compact && "Installa app"}
    </button>
  );
}

import { useMemo, useRef, useState } from "react";
import { Camera, ExternalLink, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl } from "@/lib/api";
import { entryDdtDocuments } from "@/lib/entryDocuments";
import { Button } from "@/components/ui/button";

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const IMAGE_FILE_NAME = /\.(heic|heif|jpe?g|png|webp)$/i;

export default function InboundDdtPhoto({ entry, onUploaded, compact = false }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const documents = useMemo(() => entryDdtDocuments(entry?.note), [entry?.note]);
  const latest = documents[documents.length - 1] || null;
  const latestUrl = latest ? fileUrl(latest.url || latest.path) : null;

  const uploadPhoto = async (file) => {
    if (!file) return;
    const imageType = String(file.type || "").toLowerCase();
    if (!imageType.startsWith("image/") && !IMAGE_FILE_NAME.test(file.name || "")) {
      toast.error("Seleziona una foto del DDT");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (Number(file.size || 0) > MAX_PHOTO_BYTES) {
      toast.error("La foto DDT non può superare 20 MB");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("tipo", "Foto DDT");
      await api.post(`/entrate/${entry.id}/documento`, formData);
      await onUploaded?.();
      toast.success("Foto DDT salvata");
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Foto DDT non caricata");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section className={`border border-slate-200 bg-white ${compact ? "rounded-md p-3" : "p-4"}`} data-testid="inbound-ddt-photo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex shrink-0 items-center justify-center rounded-md ${latest ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"} ${compact ? "h-10 w-10" : "h-11 w-11"}`}>
            {latest ? <FileCheck2 className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-black text-slate-950">Foto DDT</h2>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500">Opzionale</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {latest ? `${documents.length} ${documents.length === 1 ? "foto caricata" : "foto caricate"}` : "Scatta una foto o sceglila dalla libreria"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {latestUrl && (
            <Button asChild type="button" variant="outline" size={compact ? "sm" : "default"}>
              <a href={latestUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" /> Apri
              </a>
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            data-testid="inbound-ddt-photo-input"
            onChange={(event) => uploadPhoto(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant={latest ? "outline" : "default"}
            size={compact ? "sm" : "default"}
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            data-testid="inbound-ddt-photo-upload"
          >
            {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Camera className="mr-1.5 h-4 w-4" />}
            {latest ? "Aggiungi" : "Carica foto"}
          </Button>
        </div>
      </div>
    </section>
  );
}


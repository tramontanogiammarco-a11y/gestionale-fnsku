import { useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, fileUrl, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function TransparencyLabelFiles({ row, canUpload = false, canDelete = false, onChanged }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const files = row?.transparency_labels || [];

  const upload = async (selectedFiles) => {
    const pending = [...(selectedFiles || [])];
    if (!pending.length) return;
    setUploading(true);
    try {
      for (const file of pending) {
        const formData = new FormData();
        formData.append("file", file);
        await api.post(`/preparazioni-righe/${row.id}/transparency-labels`, formData);
      }
      toast.success(pending.length === 1 ? "Etichetta Transparency caricata" : `${pending.length} etichette Transparency caricate`);
      await onChanged?.();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
      await onChanged?.();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (file) => {
    if (!window.confirm(`Rimuovere ${file.file_name}?`)) return;
    setDeletingId(file.id);
    try {
      await api.delete(`/preparazioni-righe/${row.id}/transparency-labels/${file.id}`);
      toast.success("Etichetta Transparency rimossa");
      await onChanged?.();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail || error.message));
    } finally {
      setDeletingId(null);
    }
  };

  if (!files.length && !canUpload) return <span className="text-xs text-amber-700">Etichette mancanti</span>;

  return (
    <div className="mt-2 space-y-2" data-testid={`transparency-labels-${row.id}`}>
      {files.map((file) => (
        <div key={file.id} className="flex max-w-sm items-center gap-2 text-xs">
          <FileText className="h-4 w-4 shrink-0 text-teal-700" />
          <a
            href={fileUrl(file.storage_path)}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate font-medium text-teal-700 hover:underline"
            title={file.file_name}
          >
            {file.file_name}
          </a>
          <a href={fileUrl(file.storage_path)} target="_blank" rel="noreferrer" title="Apri etichetta" aria-label={`Apri ${file.file_name}`}>
            <Download className="h-4 w-4" />
          </a>
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => remove(file)}
              disabled={deletingId === file.id}
              title="Rimuovi etichetta"
              data-testid={`remove-transparency-label-${file.id}`}
            >
              {deletingId === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      ))}
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="application/pdf,image/png,image/jpeg"
            className="hidden"
            onChange={(event) => upload(event.target.files)}
            data-testid={`transparency-label-input-${row.id}`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            data-testid={`upload-transparency-label-${row.id}`}
          >
            {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            {files.length ? "Aggiungi etichette" : "Allega etichette"}
          </Button>
        </>
      )}
    </div>
  );
}

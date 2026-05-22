"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileUp, Loader2, Paperclip, Trash2 } from "lucide-react";

type ContextDoc = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  hasText?: boolean;
};

type Props = {
  scope: "meeting" | "project";
  entityId: string;
  /** Korte uitleg onder de titel */
  description?: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ContextDocumentsPanel({
  scope,
  entityId,
  description,
}: Props) {
  const [documents, setDocuments] = useState<ContextDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const apiBase =
    scope === "meeting"
      ? `/api/meetings/${entityId}/documents`
      : `/api/projects/${entityId}/documents`;

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiBase);
      if (!res.ok) throw new Error("Laden mislukt");
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
    } catch {
      setError("Documenten konden niet worden geladen.");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiBase, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Upload mislukt");
        return;
      }
      await loadDocuments();
    } catch {
      setError("Upload mislukt. Probeer het opnieuw.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(docId: string) {
    setDeletingId(docId);
    setError(null);
    try {
      const res = await fetch(`${apiBase}?docId=${encodeURIComponent(docId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Verwijderen mislukt");
        return;
      }
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      setError("Verwijderen mislukt");
    } finally {
      setDeletingId(null);
    }
  }

  const defaultDescription =
    scope === "project"
      ? "Documenten op projectniveau worden bij elke analyse van meetings in dit project meegenomen."
      : "Documenten op meetingniveau worden alleen bij analyses van deze meeting meegenomen. Projectdocumenten tellen ook mee.";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Contextdocumenten
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            {description ?? defaultDescription} Ondersteund: PDF, Word (.docx), .txt, .md (max. 10 MB).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            Uploaden
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Laden…
        </p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nog geen documenten. Voeg bijvoorbeeld een projectplan, offerte of notities toe.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-800 truncate">{doc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(doc.sizeBytes)}
                  {doc.hasText === false && " · geen tekst geëxtraheerd"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-gray-400 hover:text-red-600"
                disabled={deletingId === doc.id}
                onClick={() => handleDelete(doc.id)}
                aria-label={`Verwijder ${doc.fileName}`}
              >
                {deletingId === doc.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

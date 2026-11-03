"use client";

import { useState } from "react";
import { Search, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration } from "@/lib/utils";
import type { TranscriptSegment } from "@/types";

type Props = {
  content: string | null | undefined;
  segments?: TranscriptSegment[];
  /** Whisper is nog bezig — transcript wordt straks bijgewerkt. */
  isProvisional?: boolean;
  /** Spreker hernoemen in het hele transcript (ook het stemprofiel). */
  onRenameSpeaker?: (from: string, to: string) => Promise<void>;
};

const SPEAKER_COLORS = [
  "bg-indigo-100 text-indigo-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-sky-100 text-sky-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
];

export default function TranscriptView({ content, segments = [], isProvisional, onRenameSpeaker }: Props) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const speakers = [...new Set(segments.map((s) => s.speaker).filter(Boolean) as string[])];
  const speakerColor = (speaker: string) => SPEAKER_COLORS[speakers.indexOf(speaker) % SPEAKER_COLORS.length];

  const submitRename = async () => {
    if (!renaming || !onRenameSpeaker || !newName.trim() || newName.trim() === renaming) {
      setRenaming(null);
      return;
    }
    setSaving(true);
    try {
      await onRenameSpeaker(renaming, newName.trim());
      setRenaming(null);
    } finally {
      setSaving(false);
    }
  };

  const safeContent =
    typeof content === "string"
      ? content
      : content == null
        ? ""
        : typeof content === "object"
          ? JSON.stringify(content)
          : String(content);

  const isFailed = safeContent.startsWith("⚠️ Transcriptie mislukt");

  const filtered = search
    ? segments.filter((s) =>
        s.text.toLowerCase().includes(search.toLowerCase())
      )
    : segments;

  const highlight = (text: string) => {
    if (!search) return text;
    const parts = text.split(new RegExp(`(${search})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === search.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
          Transcript
          <span className="text-xs text-gray-400 font-normal">
            ({segments.length} segments)
          </span>
          {isProvisional && !isFailed && (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
              Voorlopig
            </span>
          )}
          {isFailed && (
            <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-700">
              Mislukt
            </span>
          )}
        </button>
        {!collapsed && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
            <Input
              placeholder="Zoek in transcript…"
              className="pl-8 h-8 text-xs w-48"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {isProvisional && !isFailed && !collapsed && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Whisper verwerkt de opname op de achtergrond. De pagina ververst automatisch zodra het transcript klaar is.
        </p>
      )}

      {isFailed && !collapsed && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 whitespace-pre-wrap">
          {safeContent}
        </p>
      )}

      {!collapsed && !isFailed && speakers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-gray-500">Sprekers:</span>
          {speakers.map((sp) =>
            renaming === sp ? (
              <span key={sp} className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => !saving && setRenaming(null)}
                  placeholder="Naam"
                  className="h-7 w-40 text-xs"
                />
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
              </span>
            ) : (
              <button
                key={sp}
                type="button"
                disabled={!onRenameSpeaker}
                title={onRenameSpeaker ? "Klik om de naam aan te passen" : undefined}
                onClick={() => { setRenaming(sp); setNewName(/^Spreker \d+$/.test(sp) ? "" : sp); }}
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${speakerColor(sp)} ${onRenameSpeaker ? "hover:ring-2 hover:ring-gray-300" : ""}`}
              >
                {sp}
              </button>
            ),
          )}
        </div>
      )}

      {!collapsed && !isFailed && (
        <ScrollArea className="h-96 rounded-xl border border-gray-200 bg-gray-50">
          <div className="p-4 space-y-3">
            {segments.length > 0 ? (
              filtered.map((seg, i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex-shrink-0 font-mono text-xs text-gray-400 mt-0.5 w-12">
                    {formatDuration(Math.floor(seg.start))}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {seg.speaker && (
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${speakerColor(seg.speaker)}`}>
                        {seg.speaker}
                      </span>
                    )}
                    {highlight(seg.text)}
                  </p>
                </div>
              ))
            ) : safeContent ? (
              <p className="text-sm text-gray-500 whitespace-pre-wrap">{safeContent}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">Transcript wordt verwerkt…</p>
            )}
            {filtered.length === 0 && search && (
              <p className="text-sm text-gray-400 text-center py-8">
                No results for "{search}"
              </p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

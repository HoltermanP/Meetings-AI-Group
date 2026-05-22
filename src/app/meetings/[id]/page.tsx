"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import MainLayout from "@/components/layout/MainLayout";
import AudioRecorder from "@/components/meeting/AudioRecorder";
import NotesEditor from "@/components/meeting/NotesEditor";
import ActionItemsList from "@/components/meeting/ActionItemsList";
import ChatPanel from "@/components/meeting/ChatPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wand2, Trash2, Download, Loader2, Mic, FileText,
  CheckSquare, MessageSquare, Edit2, Check, X, Briefcase, Calendar, Users, Video
} from "lucide-react";
import TranscriptView from "@/components/meeting/TranscriptView";
import AgendaView, { type AgendaItem } from "@/components/meeting/AgendaView";
import ParticipantsList from "@/components/meeting/ParticipantsList";
import AnalysisReportSelector, {
  DEFAULT_ANALYSIS_REPORT_TYPE,
} from "@/components/meeting/AnalysisReportSelector";
import ContextDocumentsPanel from "@/components/meeting/ContextDocumentsPanel";
import type { AnalysisReportType } from "@/lib/analysis-report-types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { formatDateTime, formatDuration, platformIcon } from "@/lib/utils";
import { notesToHtml } from "@/lib/notes-format";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState("");
  const [rawNotes, setRawNotes] = useState("");
  const [templates, setTemplates] = useState<
    { id: string; name: string; docxPath?: string | null }[]
  >([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportFormat, setExportFormat] = useState<"word" | "pdf">("word");
  const pdfSourceRef = useRef<HTMLDivElement>(null);
  const emptyActionItems = useMemo(() => [], []);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  /** >0 wanneer de opname automatisch moet starten (één-klik vanaf dashboard). */
  const [recordAutoStartToken, setRecordAutoStartToken] = useState(0);
  const [reportType, setReportType] = useState<AnalysisReportType>(DEFAULT_ANALYSIS_REPORT_TYPE);
  const [lastReportLabel, setLastReportLabel] = useState<string | null>(null);
  const [includeProjectContext, setIncludeProjectContext] = useState(true);

  useEffect(() => {
    loadMeeting();
  }, [id]);

  // Eén-klik opname: ?record=1 in de URL → opname meteen starten.
  // De parameter wordt daarna verwijderd zodat een refresh niet opnieuw start.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("record") === "1") {
      setRecordAutoStartToken(1);
      url.searchParams.delete("record");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((list) => setTemplates(Array.isArray(list) ? list : []))
      .catch(() => setTemplates([]));
  }, []);

  async function loadMeeting() {
    const data = await fetch(`/api/meetings/${id}`).then((r) => r.json());
    setMeeting(data);
    setTitle(data.title || "");
    setRawNotes(data.notes?.rawNotes || "");
    setTemplateId(data.templateId || "");
    if (data.agenda) {
      try { setAgendaItems(JSON.parse(data.agenda)); } catch { /* skip */ }
    }
    setLoading(false);
  }

  async function saveTitle() {
    await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setMeeting((m: any) => ({ ...m, title }));
    setEditingTitle(false);
  }

  async function runAnalysis() {
    setGeneratingNotes(true);
    try {
      const res = await fetch(`/api/meetings/${id}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawNotes,
          reportType,
          includeProjectContext: meeting?.projectId ? includeProjectContext : false,
        }),
      });

      const contentType = res.headers.get("content-type") || "";

      if (!res.ok && !contentType.includes("text/event-stream")) {
        let msg = `Analyserapport genereren mislukt (${res.status}).`;
        try {
          const errBody = await res.json();
          if (typeof errBody.error === "string") msg = errBody.error;
        } catch {
          /* keep default */
        }
        alert(msg);
        return;
      }

      /** Tijdens stream: ruwe AI-tekst weglaten zodra het JSON-blok begint (leesbaarder voorvertoning). */
      const stripIncompleteJsonFence = (s: string) => {
        const i = s.indexOf("```json");
        return i === -1 ? s : s.slice(0, i).trimEnd();
      };

      if (!res.body || !contentType.includes("text/event-stream")) {
        alert("Geen streaming-reactie van de server. Probeer het opnieuw.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let rawAccum = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const block of chunks) {
          const dataLine = block
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6))
            .join("\n");
          if (!dataLine.trim()) continue;
          let payload: {
            type?: string;
            text?: string;
            meeting?: unknown;
            error?: string;
            reportLabel?: string;
          };
          try {
            payload = JSON.parse(dataLine) as typeof payload;
          } catch {
            alert("Ongeldige streamedata van de server.");
            return;
          }
          if (payload.type === "delta" && typeof payload.text === "string") {
            rawAccum += payload.text;
            const preview = stripIncompleteJsonFence(rawAccum);
            setMeeting((m: any) => ({
              ...m,
              notes: { ...m?.notes, content: preview },
            }));
          } else if (payload.type === "done" && payload.meeting && typeof payload.meeting === "object") {
            const m = payload.meeting as {
              notes?: unknown;
              actionItems?: unknown;
              template?: unknown;
            };
            if (typeof payload.reportLabel === "string") {
              setLastReportLabel(payload.reportLabel);
            }
            setMeeting((prev: any) => ({
              ...prev,
              ...m,
              notes: m.notes ?? prev.notes,
              actionItems: m.actionItems ?? prev.actionItems,
              template: m.template ?? prev.template,
            }));
          } else if (payload.type === "error") {
            alert(typeof payload.error === "string" ? payload.error : "Analyserapport genereren mislukt.");
            return;
          }
        }
      }
    } finally {
      setGeneratingNotes(false);
    }
  }

  async function saveTemplateChoice(nextId: string) {
    setTemplateId(nextId);
    setSavingTemplate(true);
    try {
      await fetch(`/api/meetings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: nextId || null }),
      });
      setMeeting((m: any) => ({
        ...m,
        templateId: nextId || null,
        template: nextId ? templates.find((t) => t.id === nextId) : null,
      }));
    } finally {
      setSavingTemplate(false);
    }
  }

  async function deleteMeeting() {
    if (!confirm("Deze meeting verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
    await fetch(`/api/meetings/${id}`, { method: "DELETE" });
    router.push("/meetings");
  }

  async function exportWordSimple() {
    setExportingWord(true);
    try {
      const res = await fetch(`/api/meetings/${id}/export-word`);
      if (!res.ok) {
        alert("Word-export mislukt");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meeting.title.replace(/[^a-z0-9]/gi, "-")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingWord(false);
    }
  }

  async function exportPdf() {
    const el = pdfSourceRef.current;
    if (!el) return;
    setExportingPdf(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          // Tailwind v4 uses oklch() colors which html2canvas can't parse.
          // Override all color CSS variables with hex fallbacks.
          const style = clonedDoc.createElement("style");
          style.textContent = `
            :root {
              --color-white: #ffffff; --color-black: #000000;
              --color-gray-50: #f9fafb; --color-gray-100: #f3f4f6;
              --color-gray-200: #e5e7eb; --color-gray-300: #d1d5db;
              --color-gray-400: #9ca3af; --color-gray-500: #6b7280;
              --color-gray-600: #4b5563; --color-gray-700: #374151;
              --color-gray-800: #1f2937; --color-gray-900: #111827;
              --color-slate-50: #f8fafc; --color-slate-100: #f1f5f9;
              --color-slate-200: #e2e8f0; --color-slate-300: #cbd5e1;
              --color-slate-400: #94a3b8; --color-slate-500: #64748b;
              --color-slate-600: #475569; --color-slate-700: #334155;
              --color-slate-800: #1e293b; --color-slate-900: #0f172a;
              --color-indigo-100: #e0e7ff; --color-indigo-500: #6366f1;
              --color-indigo-600: #4f46e5; --color-indigo-700: #4338ca;
              --color-blue-500: #3b82f6; --color-blue-600: #2563eb;
              --color-red-500: #ef4444; --color-red-600: #dc2626;
              --color-green-500: #22c55e; --color-green-600: #16a34a;
              --color-yellow-400: #facc15; --color-amber-500: #f59e0b;
            }
          `;
          clonedDoc.head.appendChild(style);
        },
      });
      const imgData = canvas.toDataURL("image/png", 0.92);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 14;
      const maxW = pageW - 2 * margin;
      const maxH = pageH - 2 * margin;
      const imgW = maxW;
      const imgH = (canvas.height * imgW) / canvas.width;
      if (imgH <= maxH) {
        pdf.addImage(imgData, "PNG", margin, margin, imgW, imgH);
      } else {
        let remaining = imgH;
        let srcY = 0;
        const pxPerMm = canvas.width / imgW;
        while (remaining > 0) {
          const sliceMm = Math.min(maxH, remaining);
          const slicePx = sliceMm * pxPerMm;
          const slice = document.createElement("canvas");
          slice.width = canvas.width;
          slice.height = Math.min(Math.ceil(slicePx), canvas.height - srcY);
          const ctx = slice.getContext("2d");
          if (ctx && slice.height > 0) {
            ctx.drawImage(canvas, 0, srcY, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
            pdf.addImage(slice.toDataURL("image/png"), "PNG", margin, margin, imgW, sliceMm);
          }
          srcY += slice.height;
          remaining -= sliceMm;
          if (remaining > 0) pdf.addPage();
        }
      }
      pdf.save(`${meeting.title.replace(/[^a-z0-9]/gi, "-")}.pdf`);
    } catch (e) {
      console.error(e);
      alert("PDF maken mislukt. Probeer Word-export.");
    } finally {
      setExportingPdf(false);
    }
  }

  async function runExport() {
    if (exportFormat === "word") await exportWordSimple();
    else await exportPdf();
  }

  const onTranscribed = useCallback(
    async (_transcript: string, newTitle: string, meta?: { provisional?: boolean }) => {
      // Eerste call (provisional=true): lokaal isProvisional aanzetten zodat de
      // polling-loop hieronder begint te pollen — dan groeit de transcriptie
      // per chunk vanzelf in de UI.
      if (meta?.provisional) {
        setMeeting((m: any) => ({
          ...(m || {}),
          status: "processing",
          transcript: { ...(m?.transcript || {}), isProvisional: true },
        }));
        return;
      }
      // Finale call (provisional=false): haal definitieve data op uit DB
      try {
        const res = await fetch(`/api/meetings/${id}`);
        if (res.ok) {
          const data = await res.json();
          setMeeting(data);
          if (data.title) setTitle(data.title);
          return;
        }
      } catch {
        /* fallback hieronder */
      }
      setMeeting((m: any) => ({
        ...m,
        status: "completed",
        title: newTitle || m.title,
        transcript: {
          ...m.transcript,
          isProvisional: false,
        },
      }));
      if (newTitle) setTitle(newTitle);
    },
    [id]
  );

  useEffect(() => {
    const prov = meeting?.transcript?.isProvisional;
    if (!prov || !id) return;
    const t = setInterval(() => {
      fetch(`/api/meetings/${id}`)
        .then((r) => r.json())
        .then((data) => {
          if (!data) return;
          // Tijdens chunk-uploads: refresh de meeting state zodat de UI de
          // groeiende transcript-content live laat zien. Bij definitieve klaar
          // (isProvisional=false) ook setMeeting — de polling stopt vanzelf
          // omdat dit useEffect dan opnieuw evalueert met prov=false.
          setMeeting(data);
          if (data.title) setTitle(data.title);
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [meeting?.transcript?.isProvisional, id]);

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      </MainLayout>
    );
  }

const pendingActions = meeting.actionItems?.filter((i: any) => !i.completed).length || 0;

  const notesHtml = meeting?.notes?.content ? notesToHtml(meeting.notes.content) : "";

  return (
    <MainLayout>
      {/* Off-screen bron voor PDF (zelfde opmaak als scherm) */}
      {/* PDF: alleen verslag-HTML — zelfde als gekozen format, geen extra titel/datum/actielijst */}
      {meeting?.notes && (
        <div className="fixed left-[-9999px] top-0 w-[210mm] p-8" style={{ backgroundColor: '#ffffff', color: '#111827' }}>
          <div
            ref={pdfSourceRef}
            className="prose prose-slate max-w-none text-[11pt] leading-relaxed [&_h2]:text-[1.15rem] [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5"
            dangerouslySetInnerHTML={{ __html: notesHtml || "<p></p>" }}
          />
        </div>
      )}
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xl">{platformIcon(meeting.platform)}</span>
                {editingTitle ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveTitle();
                        if (e.key === "Escape") setEditingTitle(false);
                      }}
                      className="min-w-0 flex-1 border-b-2 border-indigo-500 bg-transparent text-lg font-semibold text-gray-900 outline-none sm:text-xl"
                      autoFocus
                    />
                    <button onClick={saveTitle} className="text-green-600 hover:text-green-700">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => setEditingTitle(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <h1
                    className="cursor-pointer text-lg font-semibold text-gray-900 transition-colors hover:text-indigo-600 sm:text-xl"
                    onClick={() => setEditingTitle(true)}
                  >
                    {meeting.title}
                    <Edit2 className="ml-2 inline h-3.5 w-3.5 text-gray-400 opacity-0 group-hover:opacity-100" />
                  </h1>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 sm:gap-3">
                <span>{formatDateTime(meeting.createdAt)}</span>
                {meeting.duration && <span>{formatDuration(meeting.duration)}</span>}
                <Badge variant={meeting.status === "completed" ? "success" : "secondary"}>
                  {meeting.status}
                </Badge>
                {pendingActions > 0 && (
                  <Badge variant="warning">{pendingActions} open taken</Badge>
                )}
              </div>
              {meeting.scheduledAt && meeting.status === "scheduled" && (
                <div className="mt-2 flex items-center gap-2 text-sm text-indigo-700">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(meeting.scheduledAt).toLocaleString("nl-NL", {
                    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
                  })}
                </div>
              )}
              {meeting.project && (
                <Link
                  href={`/projects/${meeting.project.id}`}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-gray-100"
                  style={{ color: meeting.project.color }}
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  {meeting.project.name}
                </Link>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {meeting.transcript && (
                <Button
                  onClick={runAnalysis}
                  disabled={generatingNotes || meeting.transcript?.isProvisional}
                  className="gap-2"
                  size="sm"
                >
                  {generatingNotes ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  <span className="sm:hidden">Analyseren</span>
                  <span className="hidden sm:inline">
                    {meeting.notes ? "Opnieuw analyseren" : "Analyseren"}
                  </span>
                </Button>
              )}
              {meeting.notes && (
                <>
                  <Select
                    value={exportFormat}
                    onValueChange={(v) => setExportFormat(v as "word" | "pdf")}
                  >
                    <SelectTrigger className="h-9 w-full min-w-0 flex-[1_1_120px] text-xs sm:w-[140px] sm:flex-initial">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="word">Word (.docx)</SelectItem>
                      <SelectItem value="pdf">PDF</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={runExport}
                    disabled={exportingWord || exportingPdf}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    {exportingWord || exportingPdf ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Download
                  </Button>
                </>
              )}
              {meeting.teamsJoinUrl && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                >
                  <a href={meeting.teamsJoinUrl} target="_blank" rel="noopener noreferrer">
                    <Video className="h-4 w-4" />
                    <span className="hidden sm:inline">Teams-meeting</span>
                    <span className="sm:hidden">Teams</span>
                  </a>
                </Button>
              )}
              <Button onClick={deleteMeeting} variant="outline" size="sm" className="gap-2 text-red-600 hover:border-red-200 hover:text-red-700" title="Verwijderen">
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Verwijderen</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden lg:flex-row">
          {/* Main content */}
          <div className="min-w-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
            {/* Agenda */}
            {agendaItems.length > 0 && meeting.status !== "completed" && (
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Calendar className="h-4 w-4" /> Agenda
                </h2>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <AgendaView
                    meetingId={id}
                    items={agendaItems}
                    onChange={setAgendaItems}
                  />
                </div>
              </div>
            )}

            {/* Participants */}
            <div>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Users className="h-4 w-4" /> Deelnemers
              </h2>
              <ParticipantsList
                meetingId={id}
                participants={meeting.participants || []}
                onChange={(participants) => setMeeting((m: any) => ({ ...m, participants }))}
              />
            </div>

            {/* Recording — opnamemodus wordt automatisch bepaald uit de meeting */}
            {meeting.status !== "completed" && (() => {
              const isOnlineMeeting = Boolean(
                meeting.teamsJoinUrl ||
                  ["teams", "zoom", "google_meet", "webex"].includes(
                    String(meeting.platform || "").toLowerCase(),
                  ),
              );
              return (
                <div>
                  <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Mic className="h-4 w-4" /> Opname
                  </h2>
                  <AudioRecorder
                    meetingId={id}
                    presetCaptureMode={isOnlineMeeting ? "hybrid" : "physical"}
                    // Fysiek: opname start direct (alleen microfoon, geen venster).
                    // Online: niet automatisch — de browser eist een klik vlak
                    // vóór het scherm-deelvenster, dus de gebruiker klikt Start.
                    autoStartToken={isOnlineMeeting ? 0 : recordAutoStartToken}
                    statusHint={
                      isOnlineMeeting
                        ? "Online meeting — je microfoon + het geluid van de call. Klik op ‘Start opname’ en kies in het venster het tabblad of scherm van het gesprek, mét ‘Geluid delen’ aangevinkt."
                        : "Fysieke meeting — opname via de microfoon."
                    }
                    onTranscribed={onTranscribed}
                  />
                </div>
              );
            })()}

            <ContextDocumentsPanel scope="meeting" entityId={id} />

            {/* Transcript — getoond zodra beschikbaar, "Voorlopig" zolang Whisper nog bezig is */}
            {meeting.transcript && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Transcript
                </h2>
                <TranscriptView
                  content={
                    typeof meeting.transcript?.content === "string"
                      ? meeting.transcript.content
                      : meeting.transcript?.content
                        ? JSON.stringify(meeting.transcript.content)
                        : ""
                  }
                  segments={(() => {
                    const raw = meeting.transcript?.segments;
                    if (!raw) return [];
                    if (Array.isArray(raw)) return raw;
                    if (typeof raw === "string") {
                      try {
                        const parsed = JSON.parse(raw);
                        return Array.isArray(parsed) ? parsed : [];
                      } catch {
                        return [];
                      }
                    }
                    return [];
                  })()}
                  isProvisional={Boolean(meeting.transcript?.isProvisional)}
                />
              </div>
            )}

            {/* Analyserapport + optioneel template */}
            {meeting.transcript && !meeting.transcript?.isProvisional && (
              <div className="rounded-xl border border-indigo-200 bg-white p-4 sm:p-5 space-y-4 shadow-sm">
                <AnalysisReportSelector
                  value={reportType}
                  onChange={setReportType}
                  disabled={generatingNotes}
                />
                {meeting.projectId && (
                  <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-gray-300"
                      checked={includeProjectContext}
                      disabled={generatingNotes}
                      onChange={(e) => setIncludeProjectContext(e.target.checked)}
                    />
                    <span>
                      <span className="font-medium">Projectcontext meenemen</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        Projectdocumenten en transcripten van eerdere meetings in dit project
                        worden meegenomen in het rapport.
                      </span>
                    </span>
                  </label>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-1 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Het gekozen rapporttype bepaalt structuur en toon. Optioneel template hieronder
                    voor extra actie-instructies of Word-export.
                  </p>
                  <Button
                    onClick={runAnalysis}
                    disabled={generatingNotes}
                    size="lg"
                    className="gap-2 shrink-0 w-full sm:w-auto"
                  >
                    {generatingNotes ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    {meeting.notes ? "Opnieuw analyseren" : "Analyseren"}
                  </Button>
                </div>
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <Label className="text-gray-700 text-xs">Optioneel: template</Label>
                  <Select
                    value={templateId || "__none__"}
                    onValueChange={(v) => saveTemplateChoice(v === "__none__" ? "" : v)}
                    disabled={savingTemplate || generatingNotes}
                  >
                    <SelectTrigger className="max-w-full bg-gray-50 sm:max-w-md">
                      <SelectValue placeholder="Template" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Geen template</SelectItem>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Raw notes input */}
            {meeting.status !== "completed" && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-2">Jouw notities (optioneel)</h2>
                <textarea
                  value={rawNotes}
                  onChange={(e) => setRawNotes(e.target.value)}
                  placeholder="Noteer tijdens de meeting punten die mee moeten in de AI-notities."
                  className="w-full h-32 rounded-xl border border-gray-200 p-3 text-sm text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}


            {/* Generated Notes */}
            {meeting.notes && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4" /> Analyserapport
                  {lastReportLabel && (
                    <Badge variant="secondary" className="font-normal text-xs">
                      {lastReportLabel}
                    </Badge>
                  )}
                </h2>
                <NotesEditor
                  key={meeting.notes.updatedAt || meeting.notes.id}
                  meetingId={id}
                  initialContent={meeting.notes.content}
                />
              </div>
            )}

            {/* Action Items — bij project: gedeelde projectlijst altijd tonen zodra meeting bestaat */}
            {(meeting.projectId || meeting.actionItems?.length > 0 || meeting.notes) && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                  <CheckSquare className="h-4 w-4" /> Actiepunten
                </h2>
                {meeting.project && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Gedeelde lijst voor project &quot;{meeting.project.name}&quot;. Acties zijn hetzelfde in alle
                    meetings van dit project.
                  </p>
                )}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <ActionItemsList
                    meetingId={id}
                    items={meeting.actionItems ?? emptyActionItems}
                    participants={meeting.participants || []}
                    onChange={(items) => setMeeting((m: any) => ({ ...m, actionItems: items }))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Chat sidebar */}
          {meeting.transcript && (
            <div className="flex min-h-[min(50vh,28rem)] w-full shrink-0 flex-col border-t border-gray-200 bg-white lg:min-h-0 lg:w-80 lg:border-l lg:border-t-0">
              <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3">
                <MessageSquare className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Chat over meeting</span>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChatPanel
                  meetingId={id}
                  initialMessages={meeting.chatMessages || []}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}

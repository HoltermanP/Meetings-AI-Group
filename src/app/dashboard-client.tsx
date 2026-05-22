"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, CalendarPlus, Calendar, Play, Briefcase, Mic, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import MeetingCard from "@/components/meeting/MeetingCard";
import NewMeetingDialog from "@/components/meeting/NewMeetingDialog";
import PlanFromDashboardDialog from "@/components/meeting/PlanFromDashboardDialog";
import { useQuickRecord } from "@/lib/use-quick-record";

type ScheduledMeeting = {
  id: string;
  title: string;
  scheduledAt: string | null;
  project: { id: string; name: string; color: string } | null;
};

type Project = { id: string; name: string; color: string };

type Props = {
  scheduledMeetings: ScheduledMeeting[];
  recentMeetings: any[];
  projects: Project[];
};

export default function DashboardClient({ scheduledMeetings: initial, recentMeetings, projects }: Props) {
  const [openNew, setOpenNew] = useState(false);
  const [openPlan, setOpenPlan] = useState(false);
  const [scheduled, setScheduled] = useState(initial);
  const syncStarted = useRef(false);
  const {
    startRecording,
    openConflict,
    closeAndRetry,
    loading: starting,
    error: recordError,
    conflict,
  } = useQuickRecord();

  // Stil synchroniseren met Outlook bij openen dashboard (als gekoppeld)
  useEffect(() => {
    // Guard tegen React StrictMode double-invocation
    if (syncStarted.current) return;
    syncStarted.current = true;

    async function silentSync() {
      try {
        const statusRes = await fetch("/api/calendar/status");
        if (!statusRes.ok) return;
        const status = await statusRes.json() as { connected: boolean };
        if (!status.connected) return;

        // Probeer subscription te vernieuwen (best-effort, voor real-time webhook)
        fetch("/api/calendar/subscription/renew", { method: "POST" }).catch(() => {});

        const syncRes = await fetch("/api/calendar/sync", { method: "POST" });
        if (!syncRes.ok) return;
        const result = await syncRes.json() as { created: number };

        if (result.created > 0) {
          // Herlaad geplande meetings vanuit de API
          const meetingsRes = await fetch("/api/meetings?status=scheduled&minimal=true");
          if (!meetingsRes.ok) return;
          const meetings = await meetingsRes.json() as ScheduledMeeting[];
          if (Array.isArray(meetings)) setScheduled(meetings);
        }
      } catch {
        // Stil falen: dashboard blijft gewoon werken
      }
    }
    silentSync();
  }, []);

  return (
    <>
      {/* Snelle opname — één klik */}
      <div className="mb-8 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white shadow-md sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-100">
              Snel starten
            </p>
            <h2 className="text-lg font-semibold">Opname met één klik</h2>
            <p className="text-sm text-indigo-100 max-w-xl">
              Teams in je agenda? Dan microfoon + systeemgeluid. Anders alleen microfoon.
              De titel komt uit je agenda of wordt na afloop door AI bepaald.
            </p>
          </div>
          <Button
            size="lg"
            variant="secondary"
            onClick={startRecording}
            disabled={starting}
            className="w-full shrink-0 gap-2 bg-white text-indigo-700 hover:bg-indigo-50 sm:w-auto"
          >
            {starting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            {starting ? "Opname voorbereiden…" : "Start opname"}
            {!starting && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
        {recordError && (
          <p className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-sm text-white">
            {recordError}
          </p>
        )}
        {conflict && (
          <div className="mt-3 rounded-lg bg-white/15 px-3 py-3 text-sm text-white">
            <p className="font-medium">Er loopt al een opname: “{conflict.title}”.</p>
            <p className="mt-0.5 text-xs text-indigo-100">
              Hervat die opname, of sluit ’m af om een nieuwe te starten.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={openConflict}
                disabled={starting}
                className="gap-2 bg-white text-indigo-700 hover:bg-indigo-50"
              >
                <Play className="h-4 w-4" />
                Opname hervatten
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={closeAndRetry}
                disabled={starting}
                className="gap-2 bg-indigo-800/60 text-white hover:bg-indigo-800"
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                {starting ? "Bezig…" : "Afsluiten & nieuwe starten"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Geplande vergaderingen */}
      {scheduled.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-gray-900">Geplande vergaderingen</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scheduled.map((m) => (
              <div key={m.id} className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-indigo-500" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Gepland</span>
                  </div>
                  {m.project && (
                    <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: m.project.color + "20", color: m.project.color }}>
                      <Briefcase className="h-3 w-3" />
                      {m.project.name}
                    </span>
                  )}
                </div>
                <p className="mb-1 font-semibold text-gray-900 leading-snug">{m.title}</p>
                {m.scheduledAt && (
                  <p className="text-sm text-indigo-700">
                    {new Date(m.scheduledAt).toLocaleString("nl-NL", {
                      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                )}
                <div className="mt-3">
                  <Link href={`/meetings/${m.id}`}>
                    <Button size="sm" className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700">
                      <Play className="h-3.5 w-3.5" />
                      Openen
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header recente meetings + knoppen */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-gray-900">Recente meetings</h2>
        <div className="flex gap-2">
          <Button onClick={() => setOpenPlan(true)} size="sm" variant="outline" className="gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            <CalendarPlus className="h-4 w-4" />
            Plannen
          </Button>
          <Button onClick={() => setOpenNew(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Nieuwe meeting
          </Button>
        </div>
      </div>

      {/* Recente meetings grid */}
      {recentMeetings.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-gray-200 p-8 text-center sm:p-12">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-50">
            <Mic className="h-8 w-8 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-700">Nog geen meetings</h3>
            <p className="mt-1 text-sm text-gray-400">Start een opname of plan een vergadering</p>
          </div>
          <Button size="lg" onClick={startRecording} disabled={starting} className="gap-2">
            {starting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
            {starting ? "Opname voorbereiden…" : "Start opname"}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {recentMeetings.map((m) => (
            <MeetingCard key={m.id} meeting={m} />
          ))}
        </div>
      )}

      <NewMeetingDialog open={openNew} onClose={() => setOpenNew(false)} />

      {openPlan && (
        <PlanFromDashboardDialog
          projects={projects}
          onClose={() => setOpenPlan(false)}
          onCreated={(meeting) => {
            setScheduled((prev) => [
              {
                id: meeting.id,
                title: meeting.title,
                scheduledAt: meeting.scheduledAt || null,
                project: meeting.projectId ? (projects.find((p) => p.id === meeting.projectId) ?? null) : null,
              },
              ...prev,
            ]);
            setOpenPlan(false);
          }}
        />
      )}
    </>
  );
}

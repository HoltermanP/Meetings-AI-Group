"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import MainLayout from "@/components/layout/MainLayout";
import ProjectActionItemsList from "@/components/meeting/ProjectActionItemsList";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Briefcase, ArrowLeft, Users, Plus, Trash2, Loader2, CalendarPlus, Calendar, Play, CheckSquare, Mic, Link2
} from "lucide-react";
import Link from "next/link";
import PlanMeetingDialog from "@/components/project/PlanMeetingDialog";
import ContextDocumentsPanel from "@/components/meeting/ContextDocumentsPanel";

type Project = {
  id: string;
  name: string;
  color: string;
  plannerPlanId: string | null;
  plannerBucketId: string | null;
  sharePointDriveId: string | null;
  sharePointFolderPath: string | null;
  teamsWebhookUrl: string | null;
};

type ActionItem = {
  id: string;
  title: string;
  assignee: string | null;
  description: string | null;
  dueDate: string | null;
  completed: boolean;
};

type Participant = {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
};

type Meeting = {
  id: string;
  title: string;
  createdAt: string;
  status: string;
  scheduledAt?: string | null;
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [employees, setEmployees] = useState<{ id: string; firstName: string; lastName: string; email: string }[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [deletingParticipant, setDeletingParticipant] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPlanDialog, setShowPlanDialog] = useState(false);

  useEffect(() => {
    loadProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadProject() {
    try {
      const [projectRes, itemsRes, participantsRes, meetingsRes] = await Promise.all([
        fetch(`/api/projects/${id}`),
        fetch(`/api/projects/${id}/action-items`),
        fetch(`/api/projects/${id}/participants`),
        fetch(`/api/meetings?projectId=${id}&minimal=true`),
      ]);

      if (!projectRes.ok) {
        router.push("/");
        return;
      }

      const [proj, items, parts, mtgs] = await Promise.all([
        projectRes.json(),
        itemsRes.json(),
        participantsRes.json(),
        meetingsRes.json(),
      ]);

      setProject(proj);
      setActionItems(items);
      setParticipants(parts);
      setMeetings(mtgs);
    } catch (err) {
      console.error("Failed to load project:", err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject() {
    setDeletingProject(true);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/");
    } finally {
      setDeletingProject(false);
    }
  }

  async function loadEmployees() {
    if (employees.length > 0) return;
    setLoadingEmployees(true);
    try {
      const data = await fetch("/api/employees").then((r) => r.json());
      setEmployees(Array.isArray(data) ? data : []);
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function addParticipantFromEmployee(emp: { id: string; firstName: string; lastName: string; email: string }) {
    setAddingParticipant(true);
    try {
      const res = await fetch(`/api/projects/${id}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${emp.firstName} ${emp.lastName}`, email: emp.email }),
      });
      if (res.ok) {
        const newParticipant = await res.json();
        setParticipants((prev) => [...prev, newParticipant]);
      }
    } finally {
      setAddingParticipant(false);
    }
  }

  async function removeParticipant(participantId: string) {
    setDeletingParticipant(participantId);
    try {
      const res = await fetch(`/api/projects/${id}/participants`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (res.ok) {
        setParticipants(participants.filter((p) => p.id !== participantId));
      }
    } finally {
      setDeletingParticipant(null);
    }
  }

  if (loading) {
    return (
      <MainLayout title="Project">
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </MainLayout>
    );
  }

  if (!project) {
    return (
      <MainLayout title="Project">
        <div className="p-8 text-red-600">Project not found</div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title={project.name}>
      <div className="mx-auto max-w-4xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link href="/" className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex flex-1 items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: project.color + "20", color: project.color }}
            >
              <Briefcase className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Zeker weten?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={deletingProject}
                onClick={deleteProject}
              >
                {deletingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verwijderen"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>
                Annuleren
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="text-gray-500 hover:text-red-600 hover:border-red-300"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="mb-6">
          <ContextDocumentsPanel scope="project" entityId={id} />
        </div>

        {/* Plan vergadering knop */}
        <div className="mb-4">
          <button
            onClick={() => setShowPlanDialog(true)}
            className="flex items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-600 hover:bg-indigo-100 transition-colors"
          >
            <CalendarPlus className="h-4 w-4" />
            Vergadering plannen
          </button>
        </div>

        {/* Geplande vergaderingen */}
        {meetings.filter((m) => m.status === "scheduled").map((m) => (
          <div key={m.id} className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-indigo-500" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Gepland</span>
                </div>
                <p className="font-semibold text-gray-900">{m.title}</p>
                {m.scheduledAt && (
                  <p className="mt-0.5 text-sm text-indigo-700">
                    {new Date(m.scheduledAt).toLocaleString("nl-NL", {
                      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
                    })}
                  </p>
                )}
              </div>
              <Link href={`/meetings/${m.id}`}>
                <Button size="sm" className="gap-2 shrink-0">
                  <Play className="h-3.5 w-3.5" />
                  Openen
                </Button>
              </Link>
            </div>
          </div>
        ))}

        {/* Stats als navigatietegels */}
        <Tabs defaultValue="actions" className="space-y-6" onValueChange={(v) => { if (v === "team") loadEmployees(); }}>

          <TabsList className="mb-0 grid h-auto w-full grid-cols-4 gap-3 bg-transparent p-0">
            <TabsTrigger
              value="actions"
              className="flex h-auto flex-col items-start rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all data-[state=active]:border-indigo-300 data-[state=active]:bg-indigo-50 data-[state=active]:shadow-none"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100">
                <CheckSquare className="h-4 w-4 text-orange-600" />
              </div>
              <span className="mt-3 text-xs font-medium text-gray-500">Actiepunten</span>
              <span className="mt-0.5 text-2xl font-bold text-gray-900">{actionItems.length}</span>
              <span className="mt-0.5 text-xs text-gray-400">
                {actionItems.filter((i) => i.completed).length} afgerond
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="team"
              className="flex h-auto flex-col items-start rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all data-[state=active]:border-indigo-300 data-[state=active]:bg-indigo-50 data-[state=active]:shadow-none"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
                <Users className="h-4 w-4 text-indigo-600" />
              </div>
              <span className="mt-3 text-xs font-medium text-gray-500">Teamleden</span>
              <span className="mt-0.5 text-2xl font-bold text-gray-900">{participants.length}</span>
            </TabsTrigger>
            <TabsTrigger
              value="meetings"
              className="flex h-auto flex-col items-start rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all data-[state=active]:border-indigo-300 data-[state=active]:bg-indigo-50 data-[state=active]:shadow-none"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100">
                <Mic className="h-4 w-4 text-green-600" />
              </div>
              <span className="mt-3 text-xs font-medium text-gray-500">Meetings</span>
              <span className="mt-0.5 text-2xl font-bold text-gray-900">{meetings.length}</span>
            </TabsTrigger>
            <TabsTrigger
              value="integrations"
              className="flex h-auto flex-col items-start rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all data-[state=active]:border-indigo-300 data-[state=active]:bg-indigo-50 data-[state=active]:shadow-none"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100">
                <Link2 className="h-4 w-4 text-purple-600" />
              </div>
              <span className="mt-3 text-xs font-medium text-gray-500">Integraties</span>
              <span className="mt-0.5 text-sm font-semibold text-gray-700">
                {[project.plannerPlanId, project.sharePointDriveId, project.teamsWebhookUrl].filter(Boolean).length}/3
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Action Items Tab */}
          <TabsContent value="actions" className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-lg font-semibold">Gedeelde actielijst</h2>
              <p className="mb-4 text-sm text-gray-600">
                Deze acties worden gebruikt voor alle meetings in dit project.
              </p>
              <ProjectActionItemsList
                projectId={id}
                items={actionItems}
                participants={participants}
                onChange={setActionItems}
              />
            </div>
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team" className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              {/* Current participants */}
              {participants.length === 0 ? (
                <p className="mb-4 text-sm text-gray-400">Nog geen deelnemers toegevoegd.</p>
              ) : (
                <div className="mb-5 space-y-1.5">
                  {participants.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                        {p.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                        {p.email && <p className="truncate text-xs text-gray-400">{p.email}</p>}
                      </div>
                      <button
                        onClick={() => removeParticipant(p.id)}
                        disabled={deletingParticipant === p.id}
                        className="flex-shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
                      >
                        {deletingParticipant === p.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Employee picker */}
              <div className="border-t border-gray-100 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">Medewerker toevoegen</h3>
                </div>
                {loadingEmployees ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Laden...
                  </div>
                ) : employees.length === 0 && !loadingEmployees ? (
                  <button
                    onClick={loadEmployees}
                    className="w-full rounded-xl border border-dashed border-indigo-200 px-4 py-3 text-sm text-indigo-500 hover:bg-indigo-50 transition-colors"
                  >
                    <Plus className="mr-2 inline h-4 w-4" />
                    Medewerkers laden
                  </button>
                ) : null}
                {employees.length > 0 && (() => {
                  const addedEmails = new Set(participants.map((p) => p.email).filter(Boolean));
                  const available = employees.filter((e) => !addedEmails.has(e.email));
                  return available.length === 0 ? (
                    <p className="text-xs text-gray-400">Alle medewerkers zijn al toegevoegd.</p>
                  ) : (
                    <div className="space-y-1 rounded-xl border border-gray-100 p-1.5">
                      {available.map((emp) => (
                        <button
                          key={emp.id}
                          onClick={() => addParticipantFromEmployee(emp)}
                          disabled={addingParticipant}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-indigo-50 transition-colors disabled:opacity-50"
                        >
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                            {emp.firstName[0]}{emp.lastName[0]}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-800">{emp.firstName} {emp.lastName}</p>
                            <p className="truncate text-xs text-gray-400">{emp.email}</p>
                          </div>
                          <Plus className="h-4 w-4 flex-shrink-0 text-gray-300" />
                        </button>
                      ))}
                    </div>
                  );
                })()}
                {employees.length === 0 && !loadingEmployees && (
                  <button
                    onClick={loadEmployees}
                    className="mt-2 w-full rounded-xl border border-dashed border-gray-200 px-4 py-3 text-xs text-gray-400 hover:border-indigo-200 hover:text-indigo-500 transition-colors"
                  >
                    <Plus className="mr-1.5 inline h-3.5 w-3.5" />
                    Medewerkers laden
                  </button>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Meetings Tab */}
          <TabsContent value="meetings" className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-lg font-semibold">Eerdere meetings</h2>
              {meetings.filter((m) => m.status !== "scheduled").length === 0 ? (
                <p className="text-sm text-gray-500">Nog geen afgeronde meetings in dit project</p>
              ) : (
                <div className="space-y-2">
                  {meetings.filter((m) => m.status !== "scheduled").map((m) => (
                    <Link
                      key={m.id}
                      href={`/meetings/${m.id}`}
                      className="block rounded-lg bg-gray-50 p-3 hover:bg-gray-100 transition-colors"
                    >
                      <p className="font-medium text-gray-900">{m.title}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(m.createdAt).toLocaleDateString("nl-NL")}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
          {/* Integraties Tab */}
          <TabsContent value="integrations" className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-3">
              <h2 className="text-lg font-semibold">Microsoft 365 koppelingen</h2>
              <p className="text-sm text-gray-600">
                Beheer integraties via{" "}
                <a href="/admin/config" className="text-indigo-600 underline">
                  Configuratie → Koppelingen per project
                </a>.
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${project.plannerPlanId ? "bg-green-500" : "bg-gray-300"}`} />
                  <span className="text-gray-700">Planner</span>
                  {project.plannerPlanId && <span className="text-xs text-gray-400">gekoppeld</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${project.sharePointDriveId ? "bg-green-500" : "bg-gray-300"}`} />
                  <span className="text-gray-700">SharePoint</span>
                  {project.sharePointDriveId && (
                    <span className="text-xs text-gray-400">
                      {project.sharePointFolderPath || "Notulen"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${project.teamsWebhookUrl ? "bg-green-500" : "bg-gray-300"}`} />
                  <span className="text-gray-700">Teams notificaties</span>
                  {project.teamsWebhookUrl && <span className="text-xs text-gray-400">webhook actief</span>}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {showPlanDialog && project && (
        <PlanMeetingDialog
          projectId={id}
          projectName={project.name}
          onClose={() => setShowPlanDialog(false)}
          onCreated={(meeting) => {
            setMeetings((prev) => [{ id: meeting.id, title: meeting.title, createdAt: new Date().toISOString(), status: "scheduled", scheduledAt: meeting.scheduledAt }, ...prev]);
            setShowPlanDialog(false);
          }}
        />
      )}
    </MainLayout>
  );
}

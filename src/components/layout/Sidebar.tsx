"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Mic,
  FileText,
  Settings,
  Plus,
  Search,
  ChevronRight,
  Folder,
  Briefcase,
  Users,
  CheckSquare,
  SlidersHorizontal,
  AudioLines,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import NewProjectDialog from "@/components/project/NewProjectDialog";

type FolderType = {
  id: string;
  name: string;
  color: string;
  _count: { meetings: number };
};

type ProjectType = {
  id: string;
  name: string;
  color: string;
  _count: { meetings: number };
};

type SidebarProps = {
  /** Wordt aangeroepen na navigatie (bv. mobiel menu sluiten) */
  onNavigate?: () => void;
};

export default function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProjectId = searchParams.get("projectId");
  const [folders, setFolders] = useState<FolderType[]>([]);
  const [projects, setProjects] = useState<ProjectType[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    fetch("/api/folders")
      .then((r) => r.json())
      .then(setFolders)
      .catch(() => {});
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {});
  }, []);

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/meetings", label: "Meetings", icon: FileText },
    { href: "/acties", label: "Acties", icon: CheckSquare },
    { href: "/record", label: "Opname starten", icon: Mic },
    { href: "/medewerkers", label: "Medewerkers", icon: Users },
    { href: "/stemprofielen", label: "Stemprofielen", icon: AudioLines },
  ];

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-gray-50">
      {/* pr-12 op mobiel: ruimte voor sheet sluitknop */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-4 pr-12 md:pr-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600">
          <Mic className="h-4 w-4 text-white" />
        </div>
        <span className="truncate font-semibold text-gray-900">MeetingAI</span>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search meetings..."
            className="h-8 bg-white pl-8 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchQuery) {
                onNavigate?.();
                window.location.href = `/meetings?search=${encodeURIComponent(searchQuery)}`;
              }
            }}
          />
        </div>
      </div>

      {/* Nav */}
      <nav className="min-h-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-0.5 p-2">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => onNavigate?.()}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors md:py-2",
                  pathname === href
                    ? "bg-indigo-100 font-medium text-indigo-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}

            {/* Projects section */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setProjectsExpanded(!projectsExpanded)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
              >
                <span>Projecten</span>
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    projectsExpanded && "rotate-90",
                  )}
                />
              </button>

              {projectsExpanded && (
                <div className="mt-1 space-y-0.5">
                  {projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      onClick={() => onNavigate?.()}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors md:py-2",
                        pathname === `/projects/${project.id}`
                          ? "bg-indigo-100 text-indigo-700"
                          : "text-gray-600 hover:bg-gray-100",
                      )}
                    >
                      <Briefcase
                        className="h-4 w-4 shrink-0"
                        style={{ color: project.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <span className="text-xs text-gray-400">{project._count.meetings}</span>
                    </Link>
                  ))}
                  <button
                    type="button"
                    onClick={() => setNewProjectOpen(true)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600 md:py-2"
                  >
                    <Plus className="h-4 w-4" />
                    Nieuw project
                  </button>
                </div>
              )}
            </div>

            {/* Folders section */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setFoldersExpanded(!foldersExpanded)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
              >
                <span>Folders</span>
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    foldersExpanded && "rotate-90",
                  )}
                />
              </button>

              {foldersExpanded && (
                <div className="mt-1 space-y-0.5">
                  {folders.map((folder) => (
                    <Link
                      key={folder.id}
                      href={`/meetings?folderId=${folder.id}`}
                      onClick={() => onNavigate?.()}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors md:py-2",
                        pathname.includes(folder.id)
                          ? "bg-indigo-100 text-indigo-700"
                          : "text-gray-600 hover:bg-gray-100",
                      )}
                    >
                      <Folder
                        className="h-4 w-4 shrink-0"
                        style={{ color: folder.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      <span className="text-xs text-gray-400">{folder._count.meetings}</span>
                    </Link>
                  ))}
                  <button
                    type="button"
                    onClick={async () => {
                      const name = prompt("Mapnaam:");
                      if (!name) return;
                      await fetch("/api/folders", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name }),
                      });
                      const updated = await fetch("/api/folders").then((r) => r.json());
                      setFolders(updated);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600 md:py-2"
                  >
                    <Plus className="h-4 w-4" />
                    Nieuwe map
                  </button>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </nav>

      {newProjectOpen && (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onCreated={(project) => {
            setProjects((prev) => [...prev, project].sort((a, b) => a.name.localeCompare(b.name)));
            setNewProjectOpen(false);
          }}
        />
      )}

      {/* Bottom nav */}
      <div className="border-t border-gray-200 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] space-y-0.5">
        <Link
          href="/settings"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors md:py-2",
            pathname === "/settings"
              ? "bg-indigo-100 text-indigo-700"
              : "text-gray-600 hover:bg-gray-100",
          )}
        >
          <Settings className="h-4 w-4" />
          Instellingen
        </Link>
        <Link
          href="/admin/config"
          onClick={() => onNavigate?.()}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors md:py-2",
            pathname === "/admin/config"
              ? "bg-indigo-100 text-indigo-700"
              : "text-gray-600 hover:bg-gray-100",
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Configuratie
        </Link>
      </div>
    </aside>
  );
}

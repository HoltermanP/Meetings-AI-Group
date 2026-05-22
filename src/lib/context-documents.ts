import { prisma } from "@/lib/prisma";

const MAX_CHARS_PER_DOC = 12_000;
const MAX_TOTAL_DOC_CHARS = 40_000;
const MAX_CHARS_PER_MEETING = 6_000;
const MAX_OTHER_MEETINGS = 8;

export type ContextDocumentForPrompt = {
  fileName: string;
  scope: "meeting" | "project";
  text: string;
};

export type ProjectMeetingForPrompt = {
  title: string;
  date: string;
  isCurrent: boolean;
  transcript: string;
};

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n[… ingekort …]`;
}

export async function loadDocumentsForMeetingAnalysis(
  meetingId: string,
  projectId: string | null,
): Promise<ContextDocumentForPrompt[]> {
  const docs = await prisma.contextDocument.findMany({
    where: {
      OR: [
        { meetingId },
        ...(projectId ? [{ projectId }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { fileName: true, extractedText: true, meetingId: true, projectId: true },
  });

  const result: ContextDocumentForPrompt[] = [];
  let total = 0;

  for (const d of docs) {
    const raw = d.extractedText?.trim();
    if (!raw) continue;
    const scope = d.meetingId ? "meeting" : "project";
    const budget = Math.min(MAX_CHARS_PER_DOC, MAX_TOTAL_DOC_CHARS - total);
    if (budget <= 0) break;
    const text = truncate(raw, budget);
    total += text.length;
    result.push({ fileName: d.fileName, scope, text });
  }

  return result;
}

export async function loadOtherProjectMeetingsForAnalysis(
  meetingId: string,
  projectId: string,
): Promise<ProjectMeetingForPrompt[]> {
  const meetings = await prisma.meeting.findMany({
    where: {
      projectId,
      id: { not: meetingId },
      transcript: { isNot: null },
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_OTHER_MEETINGS,
    select: {
      id: true,
      title: true,
      startedAt: true,
      createdAt: true,
      transcript: { select: { content: true } },
    },
  });

  return meetings
    .filter((m) => m.transcript?.content?.trim())
    .map((m) => {
      const date = (m.startedAt ?? m.createdAt).toISOString().slice(0, 10);
      return {
        title: m.title,
        date,
        isCurrent: false,
        transcript: truncate(m.transcript!.content, MAX_CHARS_PER_MEETING),
      };
    });
}

export function formatDocumentsForPrompt(docs: ContextDocumentForPrompt[]): string {
  if (!docs.length) return "";
  const blocks = docs.map((d) => {
    const label = d.scope === "project" ? "projectdocument" : "meetingdocument";
    return `### ${d.fileName} (${label})\n${d.text}`;
  });
  return `\n\nCONTEXTDOCUMENTEN (geüpload door gebruiker — gebruik als aanvullende bron naast het transcript):\n${blocks.join("\n\n")}`;
}

export function formatProjectMeetingsForPrompt(meetings: ProjectMeetingForPrompt[]): string {
  if (!meetings.length) return "";
  const blocks = meetings.map(
    (m) => `### Eerdere meeting: ${m.title} (${m.date})\n${m.transcript}`,
  );
  return `\n\nANDERE MEETINGS IN DIT PROJECT (voor projectbreed rapport):\n${blocks.join("\n\n")}`;
}

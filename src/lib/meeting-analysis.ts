import { prisma } from "@/lib/prisma";
import { generateMeetingNotes } from "@/lib/openai";
import { findActionItemsForMeeting } from "@/lib/meeting-action-items";
import { userMessageForLlmFailure } from "@/lib/llm";
import { createPlannerTask } from "@/lib/planner";
import { uploadToSharePoint } from "@/lib/sharepoint";
import { notesToHtml, buildNotesOnlyExportHtml } from "@/lib/notes-format";
import {
  DEFAULT_ANALYSIS_REPORT_TYPE,
  getAnalysisReportDefinition,
  isAnalysisReportType,
  type AnalysisReportType,
} from "@/lib/analysis-report-types";
import {
  formatDocumentsForPrompt,
  formatProjectMeetingsForPrompt,
  loadDocumentsForMeetingAnalysis,
  loadOtherProjectMeetingsForAnalysis,
} from "@/lib/context-documents";

const encoder = new TextEncoder();

function sse(obj: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export type MeetingForAnalysis = Awaited<ReturnType<typeof loadMeetingForAnalysis>>;

export async function loadMeetingForAnalysis(meetingId: string, userId: string) {
  return prisma.meeting.findFirst({
    where: { id: meetingId, userId },
    include: {
      transcript: true,
      notes: true,
      template: true,
      participants: true,
      project: {
        select: {
          id: true,
          plannerPlanId: true,
          plannerBucketId: true,
          sharePointDriveId: true,
          sharePointFolderPath: true,
          teamsWebhookUrl: true,
          template: {
            select: { aiContextInstructions: true, outputFocus: true },
          },
        },
      },
    },
  });
}

export function parseAnalysisRequestBody(
  body: unknown,
): { reportType: AnalysisReportType; rawNotes: string; includeProjectContext: boolean } {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const reportType = isAnalysisReportType(o.reportType)
    ? o.reportType
    : DEFAULT_ANALYSIS_REPORT_TYPE;
  const rawNotes = typeof o.rawNotes === "string" ? o.rawNotes : "";
  const includeProjectContext = o.includeProjectContext !== false;
  return { reportType, rawNotes, includeProjectContext };
}

export async function buildAnalysisExtraContext(
  meetingId: string,
  projectId: string | null,
  includeProjectContext: boolean,
): Promise<string> {
  const docs = await loadDocumentsForMeetingAnalysis(meetingId, projectId);
  let extra = formatDocumentsForPrompt(docs);

  if (includeProjectContext && projectId) {
    const otherMeetings = await loadOtherProjectMeetingsForAnalysis(meetingId, projectId);
    extra += formatProjectMeetingsForPrompt(otherMeetings);
  }

  return extra.trim();
}

/** SSE-stream: analyseert transcript en werkt notities + actiepunten bij. */
export function createMeetingAnalysisStream(
  meeting: NonNullable<MeetingForAnalysis>,
  userId: string,
  reportType: AnalysisReportType,
  rawNotes: string,
  extraContext: string,
): ReadableStream<Uint8Array> {
  const meetingId = meeting.id;
  const reportDef = getAnalysisReportDefinition(reportType);

  const reportStructure = meeting.template?.content?.trim() || "";
  const wordKeys = meeting.template?.docxPlaceholderKeys
    ? (() => {
        try {
          const parsed = JSON.parse(meeting.template!.docxPlaceholderKeys!);
          return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
          return [];
        }
      })()
    : [];

  const templatePayload = meeting.template
    ? {
        reportStructure: reportStructure || meeting.template.content,
        actionItemsInstructions: meeting.template.actionItemsInstructions,
        wordPlaceholderKeys: wordKeys,
      }
    : null;

  const participants = meeting.participants.map((p) => ({
    name: p.name,
    email: p.email,
  }));

  const meetingTypeContext =
    meeting.template?.aiContextInstructions ??
    meeting.project?.template?.aiContextInstructions ??
    null;

  const outputFocus =
    meeting.template?.outputFocus ?? meeting.project?.template?.outputFocus ?? null;

  const transcriptContent = meeting.transcript!.content;

  return new ReadableStream({
    async start(controller) {
      const send = (chunk: Uint8Array) => controller.enqueue(chunk);
      try {
        const { notes, summary, actionItems: aiActionItems } = await generateMeetingNotes(
          transcriptContent,
          templatePayload,
          rawNotes,
          {
            participants,
            meetingTypeContext,
            outputFocus,
            reportType,
            extractActionItems: reportDef.extractActionItems,
            extraContext: extraContext || null,
          },
          {
            onStreamDelta: (text) => {
              send(sse({ type: "delta", text }));
            },
          },
        );

        await prisma.notes.upsert({
          where: { meetingId },
          update: { content: notes, summary, rawNotes },
          create: { meetingId, content: notes, summary, rawNotes },
        });

        await prisma.actionItem.deleteMany({ where: { meetingId } });

        if (reportDef.extractActionItems && aiActionItems.length > 0) {
          const created = await prisma.$transaction(
            aiActionItems.map((item) =>
              prisma.actionItem.create({
                data: {
                  meetingId,
                  projectId: meeting.projectId ?? undefined,
                  title: item.title,
                  assignee: item.assignee,
                  description: item.description,
                },
              }),
            ),
          );

          const project = meeting.project;
          if (project?.plannerPlanId && project.plannerBucketId) {
            await Promise.all(
              created.map(async (dbItem) => {
                const taskId = await createPlannerTask(
                  userId,
                  project.plannerPlanId!,
                  project.plannerBucketId!,
                  {
                    title: dbItem.title,
                    description: dbItem.description,
                    dueDate: dbItem.dueDate,
                  },
                );
                if (taskId) {
                  await prisma.actionItem.update({
                    where: { id: dbItem.id },
                    data: { plannerTaskId: taskId },
                  });
                }
              }),
            );
          }
        }

        const project = meeting.project;
        if (project?.sharePointDriveId && notes) {
          const folder = project.sharePointFolderPath || "Notulen";
          const dateStr = new Date().toISOString().slice(0, 10);
          const safeName = meeting.title.replace(/[/\\:*?"<>|]/g, "_");
          const fileName = `${safeName}_${dateStr}.docx`;
          const HTMLtoDOCX = (await import("html-to-docx")).default;
          const docxBuffer = await HTMLtoDOCX(
            buildNotesOnlyExportHtml(notesToHtml(notes)),
            "<p></p>",
            { title: meeting.title, creator: "AI Meetings", font: "Calibri", fontSize: 22 },
          );
          await uploadToSharePoint(
            userId,
            project.sharePointDriveId,
            folder,
            fileName,
            Buffer.from(docxBuffer as Buffer),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ).catch((e) => console.error("[analyze] SharePoint upload fout:", e));
        }

        const updatedMeeting = await prisma.meeting.findUnique({
          where: { id: meetingId },
          include: { notes: true, template: true },
        });
        if (!updatedMeeting) {
          send(sse({ type: "error", error: "Not found" }));
          return;
        }

        const actionItems = await findActionItemsForMeeting(updatedMeeting);
        send(
          sse({
            type: "done",
            meeting: { ...updatedMeeting, actionItems },
            reportType,
            reportLabel: reportDef.label,
          }),
        );
      } catch (e) {
        console.error("[analyze]", e);
        send(sse({ type: "error", error: userMessageForLlmFailure(e) }));
      } finally {
        controller.close();
      }
    },
  });
}

export function analysisStreamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

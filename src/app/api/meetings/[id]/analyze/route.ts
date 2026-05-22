import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { userMessageForLlmFailure } from "@/lib/llm";
import {
  analysisStreamResponse,
  buildAnalysisExtraContext,
  createMeetingAnalysisStream,
  loadMeetingForAnalysis,
  parseAnalysisRequestBody,
} from "@/lib/meeting-analysis";

/** Uitgebreide rapporten kunnen lang duren (hoge tokenlimiet). */
export const maxDuration = 300;

/**
 * Genereert een analyserapport uit het meeting-transcript (SSE-stream).
 * Body: { reportType?: AnalysisReportType, rawNotes?: string }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const meeting = await loadMeetingForAnalysis(id, session.user.id);

    if (!meeting) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!meeting.transcript?.content?.trim()) {
      return NextResponse.json({ error: "Geen transcript beschikbaar" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { reportType, rawNotes, includeProjectContext } = parseAnalysisRequestBody(body);
    const notesFallback = rawNotes || meeting.notes?.rawNotes || "";

    const extraContext = await buildAnalysisExtraContext(
      meeting.id,
      meeting.projectId,
      includeProjectContext,
    );

    const stream = createMeetingAnalysisStream(
      meeting,
      session.user.id,
      reportType,
      notesFallback,
      extraContext,
    );

    return analysisStreamResponse(stream);
  } catch (e) {
    console.error("[analyze]", e);
    return NextResponse.json({ error: userMessageForLlmFailure(e) }, { status: 500 });
  }
}

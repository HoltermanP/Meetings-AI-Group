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

export const maxDuration = 300;

/** @deprecated Gebruik POST /api/meetings/[id]/analyze — zelfde flow, met optioneel reportType. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const meeting = await loadMeetingForAnalysis(id, session.user.id);

    if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!meeting.transcript) {
      return NextResponse.json({ error: "No transcript available" }, { status: 400 });
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
    console.error("[generate-notes]", e);
    return NextResponse.json({ error: userMessageForLlmFailure(e) }, { status: 500 });
  }
}

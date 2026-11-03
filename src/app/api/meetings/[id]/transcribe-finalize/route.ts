import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateTitle } from "@/lib/openai";
import { isProvisionalMeetingTitle } from "@/lib/meeting-recording";
import { rebuildTranscriptFromChunks } from "@/lib/transcript-chunks";

export const maxDuration = 60;

/**
 * Rondt een opname af nadat alle segmenten via /transcribe-chunk binnen zijn:
 * transcript definitief maken, meeting op 'completed' en titel genereren.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const meeting = await prisma.meeting.findFirst({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { totalDuration?: number };

  const { content, chunkCount } = await rebuildTranscriptFromChunks(id, false);

  const updateData: { status: string; endedAt: Date; title?: string; duration?: number } = {
    status: "completed",
    endedAt: meeting.endedAt ?? new Date(),
  };
  if (typeof body.totalDuration === "number" && body.totalDuration > 0) {
    updateData.duration = Math.round(body.totalDuration);
  }
  if (content && isProvisionalMeetingTitle(meeting.title)) {
    try {
      updateData.title = await generateTitle(content);
    } catch (err) {
      console.error(`[finalize ${id}] generateTitle faalde:`, err);
    }
  }
  await prisma.meeting.update({ where: { id }, data: updateData });
  console.log(`[finalize ${id}] ${chunkCount} segmenten, ${content.length} chars`);

  return NextResponse.json({ ok: true, chunkCount, transcriptLength: content.length });
}

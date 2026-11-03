import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renameSpeakerInMeeting } from "@/lib/speakers";

/** Handmatige correctie: spreker hernoemen in het hele transcript (+ stemprofiel). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: meetingId } = await params;
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId } });
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  const from = typeof body?.from === "string" ? body.from : "";
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  if (!from || !to || to.length > 60) {
    return NextResponse.json({ error: "Velden 'from' en 'to' zijn verplicht" }, { status: 400 });
  }
  if (from === to) return NextResponse.json({ ok: true });

  await renameSpeakerInMeeting(meetingId, from, to);
  const transcript = await prisma.transcript.findUnique({ where: { meetingId } });
  return NextResponse.json({ ok: true, transcript });
}

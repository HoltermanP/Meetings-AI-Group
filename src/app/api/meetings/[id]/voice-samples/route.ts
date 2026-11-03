import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAnonymousSpeaker, matchEmployeeId } from "@/lib/speakers";

/** ~10 s WAV 16 kHz mono = 320 KB → ~430 KB als base64. */
const MAX_SAMPLE_CHARS = 600_000;

/**
 * Slaat een in de browser geknipt fragment op als stemprofiel. Bestaat er al een
 * vast profiel met deze naam, dan blijft dat staan (eerste fragment wint).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: meetingId } = await params;
  const meeting = await prisma.meeting.findFirst({ where: { id: meetingId } });
  if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; sample?: unknown; seconds?: unknown }
    | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const sample = typeof body?.sample === "string" ? body.sample : "";
  const seconds = typeof body?.seconds === "number" ? body.seconds : NaN;

  if (!name || name.length > 60) return NextResponse.json({ error: "Ongeldige naam" }, { status: 400 });
  if (!sample.startsWith("data:audio/wav;base64,") || sample.length > MAX_SAMPLE_CHARS) {
    return NextResponse.json({ error: "Ongeldig fragment" }, { status: 400 });
  }
  if (!(seconds >= 2 && seconds <= 10.5)) {
    return NextResponse.json({ error: "Fragment moet 2–10 seconden zijn" }, { status: 400 });
  }

  const anonymous = isAnonymousSpeaker(name);
  const existing = await prisma.voiceProfile.findFirst({
    where: anonymous
      ? { meetingId, isAnonymous: true, name }
      : { isAnonymous: false, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ id: existing.id, created: false });

  const profile = await prisma.voiceProfile.create({
    data: {
      name,
      isAnonymous: anonymous,
      sample,
      sampleSeconds: seconds,
      meetingId,
      employeeId: anonymous ? null : await matchEmployeeId(meetingId, name),
    },
    select: { id: true },
  });
  return NextResponse.json({ id: profile.id, created: true }, { status: 201 });
}

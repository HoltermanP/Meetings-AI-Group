import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renameSpeakerInMeeting, transcribeChunkWithSpeakers } from "@/lib/speakers";
import { nextChunkPosition, rebuildTranscriptFromChunks } from "@/lib/transcript-chunks";

/**
 * Per-segment Whisper-transcriptie, al tíjdens de opname. Elk segment is een complete
 * WebM van ~5 minuten (≈ 1,2 MB op 32 kbps): past binnen Vercel's 4,5 MB body-limit
 * én Whisper's 25 MB. Elk segment wordt los opgeslagen (TranscriptChunk), zodat een
 * mislukte of dubbele upload het bestaande transcript nooit beschadigt.
 */
export const maxDuration = 300;

type Segment = { start: number; end: number; text: string; speaker?: string };

async function authorize(params: Promise<{ id: string }>) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { id } = await params;
  const meeting = await prisma.meeting.findFirst({ where: { id } });
  if (!meeting) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { id };
}

/** GET — waar een (voortgezette) opname verder moet: volgende index en tijdsoffset. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await authorize(params);
  if ("error" in a) return a.error;
  return NextResponse.json(await nextChunkPosition(a.id));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await authorize(params);
  if ("error" in a) return a.error;
  const { id } = a;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const audioBlob = formData.get("audio") as Blob | null;
  const indexStr = formData.get("index") as string | null;
  const offsetStr = formData.get("offsetSeconds") as string | null;
  const durationStr = formData.get("durationSeconds") as string | null;
  const mimeType = (formData.get("mimeType") as string) || "audio/webm";

  if (!audioBlob || !indexStr) {
    return NextResponse.json(
      { error: "Velden 'audio' en 'index' zijn verplicht" },
      { status: 400 }
    );
  }

  const index = Number.parseInt(indexStr, 10);
  const offsetSeconds = offsetStr ? Number.parseFloat(offsetStr) : 0;
  const durationSeconds = durationStr ? Number.parseFloat(durationStr) : null;
  if (Number.isNaN(index) || index < 0) {
    return NextResponse.json({ error: "Ongeldige index" }, { status: 400 });
  }

  const t0 = Date.now();
  try {
    const buffer = Buffer.from(await audioBlob.arrayBuffer());
    console.log(
      `[chunk ${id}#${index}] ${Math.round(buffer.length / 1024)} KB ontvangen, offset=${offsetSeconds}s`
    );

    const { text, segments, sampleRequests, renames } = await transcribeChunkWithSpeakers(
      id,
      index,
      buffer,
      mimeType
    );
    console.log(`[chunk ${id}#${index}] transcriptie klaar in ${Date.now() - t0}ms — ${text.length} chars`);

    const adjustedSegments: Segment[] = segments.map((s) => ({
      ...s,
      start: s.start + offsetSeconds,
      end: s.end + offsetSeconds,
    }));

    const data = {
      offsetSeconds,
      durationSeconds: durationSeconds != null && !Number.isNaN(durationSeconds) ? durationSeconds : null,
      content: text.trim(),
      segments: JSON.stringify(adjustedSegments),
    };
    await prisma.transcriptChunk.upsert({
      where: { meetingId_index: { meetingId: id, index } },
      update: data,
      create: { meetingId: id, index, ...data },
    });

    // "Spreker 1" uit een eerder segment heeft nu een naam: overal doorvoeren.
    for (const r of renames) await renameSpeakerInMeeting(id, r.from, r.to);

    // Een al afgeronde meeting (bv. herstel van een achtergebleven segment) blijft definitief.
    const current = await prisma.transcript.findUnique({
      where: { meetingId: id },
      select: { isProvisional: true },
    });
    const { content, chunkCount } = await rebuildTranscriptFromChunks(
      id,
      current ? current.isProvisional : true
    );

    return NextResponse.json({
      ok: true,
      index,
      chunkCount,
      transcriptLength: content.length,
      // De browser knipt deze stukken uit het segment voor nieuwe stemprofielen.
      sampleRequests,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[chunk ${id}#${index}] FAIL na ${Date.now() - t0}ms:`, msg);
    // Transcript bewust niet aanraken: de client probeert dit segment opnieuw.
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

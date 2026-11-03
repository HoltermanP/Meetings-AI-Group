import { prisma } from "@/lib/prisma";
import type { TranscriptSegment } from "@/types";

export function parseSegments(raw: string | null | undefined): TranscriptSegment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TranscriptSegment[]) : [];
  } catch {
    return [];
  }
}

/** Transcripttekst met sprekers ("Jan: …") zodat notulen weten wie wat zei. */
export function buildTranscriptContent(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const text = s.text.trim();
      if (!text) return null;
      return s.speaker ? `${s.speaker}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Bouwt het Transcript opnieuw op uit alle TranscriptChunks (op volgorde van index).
 * Idempotent: een chunk die twee keer binnenkomt of in een andere volgorde
 * aankomt, levert hetzelfde transcript op.
 */
export async function rebuildTranscriptFromChunks(
  meetingId: string,
  isProvisional: boolean
): Promise<{ content: string; chunkCount: number }> {
  const chunks = await prisma.transcriptChunk.findMany({
    where: { meetingId },
    orderBy: { index: "asc" },
  });

  const segments = chunks.flatMap((c) => parseSegments(c.segments));
  const content = segments.some((s) => s.speaker)
    ? buildTranscriptContent(segments)
    : chunks
        .map((c) => c.content.trim())
        .filter(Boolean)
        .join(" ");

  await prisma.transcript.upsert({
    where: { meetingId },
    update: { content, segments: JSON.stringify(segments), isProvisional },
    create: {
      meetingId,
      content,
      segments: JSON.stringify(segments),
      isProvisional,
    },
  });

  return { content, chunkCount: chunks.length };
}

/**
 * Hernoemt een spreker in alle chunks en bouwt het Transcript opnieuw op.
 * Retourneert false als de meeting geen chunks heeft (oudere opnames).
 */
export async function renameSpeakerInChunks(meetingId: string, from: string, to: string): Promise<boolean> {
  const chunks = await prisma.transcriptChunk.findMany({
    where: { meetingId },
    select: { id: true, segments: true },
  });
  if (chunks.length === 0) return false;

  for (const c of chunks) {
    const segments = parseSegments(c.segments);
    if (!segments.some((s) => s.speaker === from)) continue;
    await prisma.transcriptChunk.update({
      where: { id: c.id },
      data: {
        segments: JSON.stringify(segments.map((s) => (s.speaker === from ? { ...s, speaker: to } : s))),
      },
    });
  }

  const current = await prisma.transcript.findUnique({
    where: { meetingId },
    select: { isProvisional: true },
  });
  await rebuildTranscriptFromChunks(meetingId, current ? current.isProvisional : true);
  return true;
}

/** Volgende vrije chunk-index en tijdsoffset — om een onderbroken opname voort te zetten. */
export async function nextChunkPosition(
  meetingId: string
): Promise<{ nextIndex: number; nextOffsetSeconds: number; chunkCount: number }> {
  const chunks = await prisma.transcriptChunk.findMany({
    where: { meetingId },
    select: { index: true, offsetSeconds: true, durationSeconds: true, segments: true },
  });

  let nextIndex = 0;
  let nextOffsetSeconds = 0;
  for (const c of chunks) {
    nextIndex = Math.max(nextIndex, c.index + 1);
    const lastEnd = parseSegments(c.segments).reduce((max, s) => Math.max(max, s.end), 0);
    const end = Math.max(c.offsetSeconds + (c.durationSeconds ?? 0), lastEnd);
    nextOffsetSeconds = Math.max(nextOffsetSeconds, end);
  }
  return { nextIndex, nextOffsetSeconds: Math.ceil(nextOffsetSeconds), chunkCount: chunks.length };
}

import { toFile } from "openai";
import type { VoiceProfile } from "@prisma/client";
import { openai, transcribeAudio } from "@/lib/openai";
import { prisma } from "@/lib/prisma";
import { chatCompletion } from "@/lib/llm";
import { buildTranscriptContent, parseSegments, renameSpeakerInChunks } from "@/lib/transcript-chunks";
import type { TranscriptSegment } from "@/types";

/**
 * Sprekerherkenning: gpt-4o-transcribe-diarize scheidt sprekers en herkent tot
 * 4 bekende stemmen aan de hand van korte fragmenten (stemprofielen). Namen van
 * onbekende stemmen haalt een LLM uit het gesprek zelf ("ik ben Jan", "Piet, wat
 * vind jij?"); daarna knipt de browser een fragment voor een nieuw stemprofiel.
 */

export const DIARIZE_MODEL = "gpt-4o-transcribe-diarize";
/** Limiet van de OpenAI-API voor known_speaker_references. */
export const MAX_KNOWN_SPEAKERS = 4;

const ANON_PREFIX = "Spreker ";
const MIN_SAMPLE_SECONDS = 2;
const MAX_SAMPLE_SECONDS = 10;
const TARGET_SAMPLE_SECONDS = 8;

export type ReferenceProfile = Pick<VoiceProfile, "id" | "name" | "isAnonymous" | "sample">;

/** Vraag aan de browser: knip dit stuk uit het segment en sla het op als stemprofiel. */
export type SampleRequest = {
  name: string;
  anonymous: boolean;
  /** Seconden t.o.v. het begin van het geüploade segment (niet van de opname). */
  start: number;
  end: number;
};

export function isAnonymousSpeaker(label: string | undefined): boolean {
  return Boolean(label && new RegExp(`^${ANON_PREFIX}\\d+$`).test(label));
}

export function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("mp3") || mimeType.includes("mpeg") || mimeType.includes("mpga")) return "mp3";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

/** Plakt opeenvolgende stukjes van dezelfde spreker samen tot één beurt. */
export function mergeSpeakerTurns(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (prev && seg.speaker && prev.speaker === seg.speaker && seg.start - prev.end < 2) {
      prev.end = seg.end;
      prev.text = `${prev.text.trim()} ${seg.text.trim()}`;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

/**
 * Kiest maximaal 4 stemprofielen om mee te sturen, in volgorde van waarschijnlijkheid:
 * eerder in deze meeting gehoord → deelnemers van de meeting → recent gehoord.
 */
export async function selectReferenceProfiles(
  meetingId: string,
  existingSegments: TranscriptSegment[],
): Promise<ReferenceProfile[]> {
  const [participants, anonymous, named] = await Promise.all([
    prisma.participant.findMany({ where: { meetingId } }),
    prisma.voiceProfile.findMany({
      where: { meetingId, isAnonymous: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, isAnonymous: true, sample: true },
    }),
    // Zonder toestemming alleen bruikbaar in de meeting waarin het is opgenomen.
    prisma.voiceProfile.findMany({
      where: { isAnonymous: false, OR: [{ consentAt: { not: null } }, { meetingId }] },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
      select: { id: true, name: true, isAnonymous: true, sample: true, employeeId: true },
    }),
  ]);

  const byName = new Map(named.map((p) => [p.name.toLowerCase(), p]));
  const picked: ReferenceProfile[] = [];
  const add = (p: ReferenceProfile | undefined) => {
    if (p && picked.length < MAX_KNOWN_SPEAKERS && !picked.some((x) => x.id === p.id)) picked.push(p);
  };

  for (const label of new Set(existingSegments.map((s) => s.speaker).filter(Boolean) as string[])) {
    add(isAnonymousSpeaker(label) ? anonymous.find((a) => a.name === label) : byName.get(label.toLowerCase()));
  }
  for (const p of participants) {
    add(
      (p.employeeId ? named.find((n) => n.employeeId === p.employeeId) : undefined) ??
        byName.get(p.name.trim().toLowerCase()),
    );
  }
  for (const p of named) add(p);

  return picked;
}

export async function transcribeDiarized(
  audioBuffer: Buffer,
  mimeType: string,
  references: ReferenceProfile[],
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  const file = await toFile(audioBuffer, `segment.${audioFileExtension(mimeType)}`, {
    type: mimeType.split(";")[0],
  });

  const response = await openai.audio.transcriptions.create({
    file,
    model: DIARIZE_MODEL,
    language: "nl",
    response_format: "diarized_json",
    chunking_strategy: "auto",
    ...(references.length > 0
      ? {
          known_speaker_names: references.map((r) => r.name),
          known_speaker_references: references.map((r) => r.sample),
        }
      : {}),
  });

  const diarized = response as { text: string; segments?: Array<{ start: number; end: number; text: string; speaker: string }> };
  return {
    text: diarized.text,
    segments: (diarized.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker,
    })),
  };
}

/**
 * Laat een LLM uit het gesprek afleiden welke naam bij welke onbekende spreker hoort.
 * Alleen bij duidelijk bewijs; twijfel = geen naam (een fout profiel is erger dan geen).
 */
export async function detectSpeakerNames(
  segments: TranscriptSegment[],
  unresolvedLabels: string[],
  knownLabels: string[],
  candidateNames: string[],
): Promise<Record<string, string>> {
  if (unresolvedLabels.length === 0 || segments.length === 0) return {};

  const dialogue = segments
    .map((s) => `[${s.speaker ?? "?"}] ${s.text.trim()}`)
    .join("\n")
    .slice(0, 30_000);

  const system = `Je koppelt sprekerlabels in een Nederlands vergadertranscript aan echte namen. Antwoord alleen met JSON.`;
  const user = `Elke regel begint met een sprekerlabel tussen [ ]. Bepaal voor deze labels wie het is: ${unresolvedLabels.map((l) => `"${l}"`).join(", ")}.
${knownLabels.length ? `Deze labels zijn al bekende personen: ${knownLabels.join(", ")}.` : ""}
${candidateNames.length ? `Verwachte deelnemers: ${candidateNames.join(", ")}.` : ""}

Geldig bewijs:
- Iemand stelt zichzelf voor ("ik ben Jan", "met Piet", "Jan hier").
- Iemand wordt bij naam aangesproken met een vraag of beurt, en het label van de volgende beurt reageert daar direct op.
- Iemand wordt bij naam bedankt of aangesproken direct na zijn eigen beurt ("dank je, Piet").

Regels:
- Alleen bij duidelijk bewijs. Bij twijfel: label weglaten.
- Een naam die alleen in een gesprek óver iemand valt, is geen bewijs.
- Gebruik de volledige naam uit de deelnemerslijst als de voornaam daar eenduidig bij past; anders de naam zoals genoemd.
- Nooit twee labels dezelfde naam geven, en geen naam van een al bekend label.

TRANSCRIPT:
${dialogue}

Antwoord: JSON-array [{"label":"A","name":"Jan de Vries","evidence":"korte quote"}], of [] als niets zeker is.`;

  let raw: string;
  try {
    raw = await chatCompletion("speakers", system, user, 600);
  } catch (err) {
    console.error("[speakers] naamherkenning faalde:", err);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
  } catch {
    return {};
  }
  if (!Array.isArray(parsed)) return {};

  const taken = new Set(knownLabels.map((l) => l.toLowerCase()));
  const result: Record<string, string> = {};
  for (const item of parsed as Array<{ label?: unknown; name?: unknown }>) {
    const label = typeof item.label === "string" ? item.label : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!unresolvedLabels.includes(label) || name.length < 2 || name.length > 60) continue;
    if (isAnonymousSpeaker(name) || taken.has(name.toLowerCase())) continue;
    result[label] = name;
    taken.add(name.toLowerCase());
  }
  return result;
}

/** Eerstvolgend vrij "Spreker N" binnen deze meeting. */
export async function nextAnonymousNumber(meetingId: string, segments: TranscriptSegment[]): Promise<number> {
  const profiles = await prisma.voiceProfile.findMany({
    where: { meetingId, isAnonymous: true },
    select: { name: true },
  });
  const numbers = [...segments.map((s) => s.speaker), ...profiles.map((p) => p.name)]
    .filter(isAnonymousSpeaker)
    .map((l) => Number.parseInt(l!.slice(ANON_PREFIX.length), 10));
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

export function anonymousName(n: number): string {
  return `${ANON_PREFIX}${n}`;
}

/**
 * Kiest het beste stuk audio van één spreker voor een stemprofiel (2–10 s,
 * bij voorkeur ~8 s uit één doorlopende beurt).
 */
export function pickSampleWindow(
  segments: TranscriptSegment[],
  speaker: string,
): { start: number; end: number } | null {
  const own = segments.filter((s) => s.speaker === speaker && s.end - s.start >= MIN_SAMPLE_SECONDS);
  if (own.length === 0) return null;
  const best = own.reduce((a, b) =>
    Math.abs(Math.min(b.end - b.start, MAX_SAMPLE_SECONDS) - TARGET_SAMPLE_SECONDS) <
    Math.abs(Math.min(a.end - a.start, MAX_SAMPLE_SECONDS) - TARGET_SAMPLE_SECONDS)
      ? b
      : a,
  );
  const length = best.end - best.start;
  if (length <= MAX_SAMPLE_SECONDS) return { start: best.start, end: best.end };
  // Lange beurt: sla de inademing aan het begin over
  const start = best.start + 0.5;
  return { start, end: start + TARGET_SAMPLE_SECONDS };
}

/** Voegt een herkende spreker toe als deelnemer (voor actiepunt-eigenaren in notulen). */
export async function ensureParticipant(meetingId: string, name: string): Promise<void> {
  const existing = await prisma.participant.findFirst({
    where: { meetingId, name: { equals: name, mode: "insensitive" } },
  });
  if (!existing) await prisma.participant.create({ data: { meetingId, name } });
}

/**
 * Hernoemt een spreker in het hele transcript van een meeting en werkt het
 * stemprofiel bij: een anoniem profiel wordt een vast profiel onder de nieuwe
 * naam, of vervalt als die persoon al een profiel heeft.
 */
export async function renameSpeakerInMeeting(meetingId: string, from: string, to: string): Promise<void> {
  const transcript = (await renameSpeakerInChunks(meetingId, from, to))
    ? null
    : await prisma.transcript.findUnique({ where: { meetingId } });
  if (transcript) {
    const segments = parseSegments(transcript.segments).map((s) =>
      s.speaker === from ? { ...s, speaker: to } : s,
    );
    await prisma.transcript.update({
      where: { meetingId },
      data: { segments: JSON.stringify(segments), content: buildTranscriptContent(segments) },
    });
  }

  if (!isAnonymousSpeaker(to)) await ensureParticipant(meetingId, to);

  const anonProfile = isAnonymousSpeaker(from)
    ? await prisma.voiceProfile.findFirst({ where: { meetingId, isAnonymous: true, name: from } })
    : null;
  if (!anonProfile || isAnonymousSpeaker(to)) return;

  const namedProfile = await prisma.voiceProfile.findFirst({
    where: { isAnonymous: false, name: { equals: to, mode: "insensitive" } },
  });
  if (namedProfile) {
    await prisma.voiceProfile.update({ where: { id: namedProfile.id }, data: { lastSeenAt: new Date() } });
    await prisma.voiceProfile.delete({ where: { id: anonProfile.id } });
  } else {
    await prisma.voiceProfile.update({
      where: { id: anonProfile.id },
      data: {
        name: to,
        isAnonymous: false,
        lastSeenAt: new Date(),
        employeeId: await matchEmployeeId(meetingId, to),
      },
    });
  }
}

/** Koppelt een naam aan een medewerker via de deelnemerslijst van de meeting. */
export async function matchEmployeeId(meetingId: string, name: string): Promise<string | null> {
  const participant = await prisma.participant.findFirst({
    where: { meetingId, name: { equals: name, mode: "insensitive" }, employeeId: { not: null } },
  });
  return participant?.employeeId ?? null;
}

/**
 * Transcribeert één opnamesegment mét sprekers: bekende stemmen meesturen, namen
 * van onbekende sprekers uit het gesprek halen, en aangeven van welke sprekers de
 * browser een fragment moet knippen. Valt terug op Whisper als diarization faalt.
 * Segmenttijden zijn relatief t.o.v. het begin van dit segment.
 */
export async function transcribeChunkWithSpeakers(
  meetingId: string,
  index: number,
  audioBuffer: Buffer,
  mimeType: string,
): Promise<{
  text: string;
  segments: TranscriptSegment[];
  sampleRequests: SampleRequest[];
  /** Anonieme sprekers uit eerdere segmenten die nu een naam hebben. */
  renames: Array<{ from: string; to: string }>;
}> {
  const earlierChunks = await prisma.transcriptChunk.findMany({
    where: { meetingId, index: { lt: index } },
    orderBy: { index: "asc" },
    select: { segments: true },
  });
  const earlier = earlierChunks.flatMap((c) => parseSegments(c.segments));
  const references = await selectReferenceProfiles(meetingId, earlier);

  let diarized: { text: string; segments: TranscriptSegment[] };
  try {
    diarized = await transcribeDiarized(audioBuffer, mimeType, references);
  } catch (err) {
    console.error(`[speakers ${meetingId}#${index}] diarization faalde, terugval op Whisper:`, err);
    const plain = await transcribeAudio(audioBuffer, mimeType);
    return { text: plain.text, segments: plain.segments, sampleRequests: [], renames: [] };
  }

  const referenceNames = new Set(references.map((r) => r.name));
  const labels = [...new Set(diarized.segments.map((s) => s.speaker).filter(Boolean) as string[])];
  const unresolved = labels.filter((l) => !referenceNames.has(l) || isAnonymousSpeaker(l));
  const known = labels.filter((l) => referenceNames.has(l) && !isAnonymousSpeaker(l));
  const participants = await prisma.participant.findMany({ where: { meetingId }, select: { name: true } });

  const found = await detectSpeakerNames(
    diarized.segments,
    unresolved,
    known,
    participants.map((p) => p.name),
  );

  let nextAnon = await nextAnonymousNumber(meetingId, earlier);
  const mapping: Record<string, string> = {};
  const renames: Array<{ from: string; to: string }> = [];
  for (const label of labels) {
    if (found[label]) {
      mapping[label] = found[label];
      if (isAnonymousSpeaker(label)) renames.push({ from: label, to: found[label] });
    } else if (referenceNames.has(label)) {
      mapping[label] = label;
    } else {
      mapping[label] = anonymousName(nextAnon++);
    }
  }

  const labeled = diarized.segments.map((s) => ({ ...s, speaker: s.speaker ? mapping[s.speaker] : undefined }));
  const speakers = [...new Set(labeled.map((s) => s.speaker).filter(Boolean) as string[])];
  const named = speakers.filter((n) => !isAnonymousSpeaker(n));

  await prisma.voiceProfile.updateMany({
    where: { isAnonymous: false, name: { in: named } },
    data: { lastSeenAt: new Date() },
  });
  for (const name of named) await ensureParticipant(meetingId, name);

  const [anonProfiles, namedProfiles] = await Promise.all([
    prisma.voiceProfile.findMany({ where: { meetingId, isAnonymous: true }, select: { name: true } }),
    prisma.voiceProfile.findMany({
      where: { isAnonymous: false, OR: named.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })) },
      select: { name: true },
    }),
  ]);
  const hasProfile = new Set([...anonProfiles, ...namedProfiles].map((p) => p.name.toLowerCase()));
  // Een anoniem profiel dat nu een naam krijgt, wordt gepromoveerd — geen nieuw fragment nodig.
  for (const r of renames) {
    if (hasProfile.has(r.from.toLowerCase())) hasProfile.add(r.to.toLowerCase());
  }

  // Diarization levert stukjes per bijzin (vaak < 2 s): kies uit samengevoegde beurten.
  const turns = mergeSpeakerTurns(labeled);
  const sampleRequests: SampleRequest[] = [];
  for (const name of speakers) {
    if (hasProfile.has(name.toLowerCase())) continue;
    const window = pickSampleWindow(turns, name);
    if (window) sampleRequests.push({ name, anonymous: isAnonymousSpeaker(name), ...window });
  }

  console.log(
    `[speakers ${meetingId}#${index}] refs=[${[...referenceNames].join(", ")}] sprekers=[${speakers.join(", ")}] ` +
      `nieuw herkend=${JSON.stringify(found)} fragmenten=${sampleRequests.length}`,
  );

  return {
    text: diarized.text,
    segments: turns,
    sampleRequests,
    renames,
  };
}

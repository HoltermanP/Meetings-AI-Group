import OpenAI from "openai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { chatCompletion, chatCompletionMulti, chatCompletionNotesStream } from "@/lib/llm";
import {
  getAnalysisReportStructure,
  getAnalysisReportMaxTokens,
  isComprehensiveReportType,
  type AnalysisReportType,
} from "@/lib/analysis-report-types";

/** Whisper-transcriptie blijft via OpenAI (geen Anthropic speech-to-text). */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** Alle gegenereerde teksten (notities, chat, titels) in het Nederlands. */
const TAAL_NL =
  "Schrijf ALLES in het Nederlands: koppen, notities, samenvatting, actiepunten en toelichtingen. Behoud namen en vakjargon uit het transcript waar nodig.";

/** Vast, leesbaar format als er geen template is — ook wat op scherm/PDF/Word komt. */
const STANDAARD_VERSLAG_FORMAT = `Er is geen sjabloon gekozen. Gebruik exact deze Markdown-structuur (##-koppen in deze volgorde). Vul elke sectie uit op basis van het transcript; alleen lege secties mag je weglaten of één zin "(Niet besproken.)".

## Samenvatting
3–5 zinnen: doel, belangrijkste uitkomst.

## Vergaderverloop
Genummerde of bulletlijst: wat er in chronologische of thematische volgorde aan bod kwam.

## Besluiten
Bulletlijst van genomen besluiten; zo geen: "(Geen expliciete besluiten.)"

## Actiepunten (in dit verslag)
Markdown-lijst met taken, eigenaar waar bekend — dezelfde taken komen ook in het JSON-blok.

## Bijzonderheden / vervolg (optioneel)
Alleen als relevant; anders weglaten.

Geen andere koppen, geen colofon, geen titelregel met datum boven ## Samenvatting. Alleen deze structuur.`;

const AI_KIEST_ACTIES =
  "Er zijn geen vaste regels voor actiepunten: extraheer concrete taken uit het transcript; gebruik per item waar mogelijk title, assignee (eigenaar), description (korte toelichting).";

/** Output cap voor verslag + JSON-acties; ~1500–2000 tokens volstaat meestal. */
const MEETING_NOTES_MAX_OUTPUT_TOKENS = 2000;

export type GenerateNotesTemplate = {
  reportStructure?: string | null;
  actionItemsInstructions?: string | null;
  /** Word-velden ({{key}}) die de AI moet vullen — dan past het verslag in het sjabloon */
  wordPlaceholderKeys?: string[];
};

export type GenerateMeetingNotesContext = {
  /** Namen (en optioneel e-mail) van ingeschreven deelnemers; de AI probeert assignee hierop te matchen. */
  participants?: Array<{ name: string; email?: string | null }>;
  /** Extra AI-systeemcontext vanuit het overlegtype (bijv. focus dagstart, context vestiging). */
  meetingTypeContext?: string | null;
  /** Korte omschrijving van de focus van dit overlegtype (wordt bovenaan system prompt gezet). */
  outputFocus?: string | null;
  /** Gekozen consultancy-rapporttype (overschrijft standaard verslagstructuur). */
  reportType?: AnalysisReportType;
  /** Actiepunten als JSON naar de database extraheren */
  extractActionItems?: boolean;
  /** Geüploade documenten + eerdere projectmeetings (geformatteerde tekst). */
  extraContext?: string | null;
};

type MeetingNotesPromptBundle = {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  hasWordFields: boolean;
  fillKeys: string[];
};

function formatParticipantsForPrompt(
  participants: GenerateMeetingNotesContext["participants"]
): string {
  if (!participants?.length) return "";
  const lines = participants
    .map((p) => {
      const name = p.name?.trim();
      if (!name) return null;
      const em = p.email?.trim();
      return em ? `- ${name} (${em})` : `- ${name}`;
    })
    .filter(Boolean)
    .join("\n");
  if (!lines) return "";
  return `

BEKENDE DEELNEMERS VAN DEZE MEETING
${lines}

Regels voor het JSON-veld "assignee" bij elk actiepunt:
- Lees uit het transcript wie de taak op zich neemt of toegewezen krijgt.
- Kies waar mogelijk exact één naam uit de lijst hierboven (zelfde schrijfwijze) als eigenaar.
- Als iemand anders in het transcript wordt genoemd die niet in de lijst staat, gebruik die naam zoals genoemd.
- Laat "assignee" weg of gebruik null alleen als er geen redelijke eigenaar uit het gesprek volgt.`;
}

function buildMeetingNotesPrompts(
  transcript: string,
  template?: GenerateNotesTemplate | null,
  rawNotes?: string,
  context?: GenerateMeetingNotesContext | null
): MeetingNotesPromptBundle {
  const fillKeys = (template?.wordPlaceholderKeys || []).filter(Boolean);
  const hasWordFields = fillKeys.length > 0;

  const reportType = context?.reportType;
  const extractActionItems = context?.extractActionItems ?? true;

  const hasReportTemplate = Boolean(template?.reportStructure?.trim()) && !reportType;
  const reportBlock = reportType
    ? getAnalysisReportStructure(reportType)
    : hasReportTemplate
      ? `Het verslag moet ALLEEN bestaan uit inhoud volgens onderstaande sjabloonstructuur (vertaal koppen naar Nederlands waar nodig). Voeg geen extra secties, inleiding, samenvatting-kop of datumkop toe die niet in de structuur staan. Geen tekst vóór de eerste ##-kop behalve als de structuur dat expliciet vraagt.

Sjabloonstructuur:
${template!.reportStructure}`
      : STANDAARD_VERSLAG_FORMAT;

  const actionBlock = !extractActionItems
    ? `Geen aparte actielijst extraheren. Lever een lege JSON-array: [].`
    : template?.actionItemsInstructions?.trim()
      ? `Actiepunten — volg strikt deze instructies voor extractie en velden:\n${template.actionItemsInstructions}\n\nLever de actiepunten als JSON-array van objecten met minstens "title"; voeg toe wat de instructies vragen (bijv. assignee, dueDate als tekst, priority).`
      : `${AI_KIEST_ACTIES}\n\nLever een JSON-array van objecten: { "title": string, "assignee"?: string, "description"?: string }.`;

  const participantBlock = formatParticipantsForPrompt(context?.participants);

  const meetingTypeBlock = context?.meetingTypeContext?.trim()
    ? `\nOVERLEGTYPE CONTEXT (volg dit strikt):\n${context.meetingTypeContext.trim()}\n`
    : "";

  const outputFocusBlock = context?.outputFocus?.trim()
    ? `\nFOCUS VAN DIT OVERLEG: ${context.outputFocus.trim()}\n`
    : "";

  const documentsBlock = context?.extraContext?.trim()
    ? `\nAANVULLENDE BRONNEN: Naast het transcript van deze meeting ontvang je contextdocumenten en/of transcripten van eerdere meetings in hetzelfde project. Gebruik die bronnen actief in je analyse; benoem tegenstrijdigheden of lacunes waar relevant.\n`
    : "";

  const wordBlock = hasWordFields
    ? `
WORD-SJABLOON (verplicht)
Het exportdocument heeft deze invulvelden. Je MOET elk veld vullen met inhoud uit het transcript (Nederlands). Gebruik exact deze JSON-keys (geen andere keys):
${JSON.stringify(fillKeys)}

Regels:
- Elke key = één tekstblok voor die plek in Word (alinea's met \\n waar nodig).
- Geen Markdown-koppen # in korte velden; bij "notes" mag wel ##-structuur als dat veld het hele verslag bevat.
- Leeg als echt niets past: "".
`
    : "";

  const roleLine = reportType
    ? isComprehensiveReportType(reportType)
      ? "Je bent een senior partner bij een top-tier management consultancy. Je levert uitgebreide, board-ready analyserapporten en adviesrapporten in het Nederlands — diepgaand, gestructureerd en onderbouwd."
      : "Je bent een senior management consultant. Je zet vergadertranscripten om naar professionele analyserapporten in het Nederlands."
    : "Je bent een expert in het maken van vergadernotities en actielijsten. Je zet transcripten om naar duidelijke, gestructureerde notities in het Nederlands.";

  const systemPrompt = `${roleLine}

${TAAL_NL}
${outputFocusBlock}${meetingTypeBlock}${documentsBlock}
VERSLAG:
${reportBlock}
${wordBlock}

ACTIELIJST:
${actionBlock}`;

  const extraContextBlock = context?.extraContext?.trim()
    ? `\n${context.extraContext.trim()}`
    : "";

  const userPrompt = hasWordFields
    ? `Analyseer dit vergadertranscript.

TRANSCRIPT:
${transcript}
${participantBlock}
${extraContextBlock}

${rawNotes ? `\nAANVULLENDE NOTITIES VAN DEELNEMER:\n${rawNotes}` : ""}

Lever in één antwoord, in deze volgorde:
1) Een codeblok JSON-object met ALLE velden: ${fillKeys.map((k) => `"${k}"`).join(", ")} — strings, Nederlands.
Voorbeeld:
\`\`\`json
{ ${fillKeys.map((k) => `"${k}":"…"`).join(", ")} }
\`\`\`
2) Een codeblok JSON-array van actiepunten (title, optioneel assignee, description).
\`\`\`json
[]
\`\`\``
    : `Analyseer dit vergadertranscript.

TRANSCRIPT:
${transcript}
${participantBlock}
${extraContextBlock}

${rawNotes ? `\nAANVULLENDE NOTITIES VAN DEELNEMER:\n${rawNotes}` : ""}

Lever in één antwoord:
1. Het volledige verslag in Markdown (Nederlands).
2. Een codeblok alleen met JSON-array van actiepunten (objecten met title, optioneel assignee/description), bijvoorbeeld:
\`\`\`json
[{"title":"…","assignee":"…","description":"…"}]
\`\`\`
Als er geen actiepunten zijn: [].`;

  const reportMaxTokens = reportType ? getAnalysisReportMaxTokens(reportType) : 4096;

  return {
    systemPrompt,
    userPrompt,
    maxTokens: hasWordFields ? 8192 : reportMaxTokens,
    hasWordFields,
    fillKeys,
  };
}

export async function generateMeetingNotes(
  transcript: string,
  template?: GenerateNotesTemplate | null,
  rawNotes?: string,
  context?: GenerateMeetingNotesContext | null,
  options?: { onStreamDelta?: (text: string) => void }
): Promise<{
  notes: string;
  summary: string;
  actionItems: Array<{ title: string; assignee?: string; description?: string }>;
  wordPlaceholders?: Record<string, string>;
}> {
  const { systemPrompt, userPrompt, maxTokens, hasWordFields, fillKeys } = buildMeetingNotesPrompts(
    transcript,
    template,
    rawNotes,
    context
  );

  const content = options?.onStreamDelta
    ? await chatCompletionNotesStream(systemPrompt, userPrompt, maxTokens, options.onStreamDelta)
    : await chatCompletion("notes", systemPrompt, userPrompt, maxTokens);

  return parseGeneratedMeetingNotesContent(content, hasWordFields, fillKeys);
}

function parseGeneratedMeetingNotesContent(
  content: string,
  hasWordFields: boolean,
  fillKeys: string[]
): {
  notes: string;
  summary: string;
  actionItems: Array<{ title: string; assignee?: string; description?: string }>;
  wordPlaceholders?: Record<string, string>;
} {
  const jsonBlocks = [...content.matchAll(/```json\n?([\s\S]*?)\n?```/g)].map((x) => x[1].trim());
  let actionItems: Array<{ title: string; assignee?: string; description?: string }> = [];
  let wordPlaceholders: Record<string, string> = {};

  if (hasWordFields && jsonBlocks.length >= 1) {
    const tryObject = (raw: string): boolean => {
      let s = raw.trim();
      if (!s) return false;
      try {
        const o = JSON.parse(s) as Record<string, unknown>;
        if (!o || typeof o !== "object" || Array.isArray(o)) return false;
        let hit = false;
        for (const k of fillKeys) {
          if (k in o) {
            const v = o[k];
            wordPlaceholders[k] = typeof v === "string" ? v : v != null ? String(v) : "";
            hit = true;
          }
        }
        return hit;
      } catch {
        return false;
      }
    };
    /** AI geeft soms trailing comma of comment — licht opruimen */
    const relaxedParse = (raw: string) => {
      if (tryObject(raw)) return;
      const noTrail = raw.replace(/,\s*([}\]])/g, "$1");
      if (noTrail !== raw) tryObject(noTrail);
    };
    for (const block of jsonBlocks) {
      relaxedParse(block);
      if (Object.keys(wordPlaceholders).length >= fillKeys.length) break;
    }
    if (Object.keys(wordPlaceholders).length === 0) {
      for (const block of jsonBlocks) {
        relaxedParse(block);
        if (Object.keys(wordPlaceholders).length > 0) break;
      }
    }
    for (let i = 0; i < jsonBlocks.length; i++) {
      try {
        const parsed = JSON.parse(jsonBlocks[i].replace(/,\s*([}\]])/g, "$1"));
        if (Array.isArray(parsed)) {
          actionItems = parsed.map((item: unknown) => {
            if (typeof item === "string") return { title: item };
            const o = item as { title?: string; assignee?: string; description?: string };
            return {
              title: o.title || String(item),
              assignee: o.assignee,
              description: o.description,
            };
          });
          break;
        }
      } catch {
        /* ignore */
      }
    }
  } else {
    const actionItemMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
    if (actionItemMatch) {
      try {
        const parsed = JSON.parse(actionItemMatch[1]);
        if (Array.isArray(parsed)) {
          actionItems = parsed.map((item: unknown) => {
            if (typeof item === "string") return { title: item };
            const o = item as { title?: string; assignee?: string; description?: string };
            return {
              title: o.title || String(item),
              assignee: o.assignee,
              description: o.description,
            };
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  let notesForStorage: string;
  if (hasWordFields && Object.keys(wordPlaceholders).length > 0) {
    notesForStorage = fillKeys
      .map((k) => {
        const body = wordPlaceholders[k] || "";
        if (k === "notes") return body;
        const label = k.replace(/_/g, " ");
        return `## ${label}\n\n${body}`;
      })
      .join("\n\n");
  } else if (hasWordFields) {
    /** JSON voor Word mislukte — geen alles wissen: rest van antwoord = verslag */
    notesForStorage = content
      .replace(/```json\n?[\s\S]*?\n?```/g, "")
      .trim();
    if (!notesForStorage && fillKeys.includes("notes")) {
      notesForStorage =
        "_(Word-velden konden niet worden uitgelezen; genereer opnieuw of controleer het JSON-blok in het AI-antwoord.)_";
    }
  } else {
    notesForStorage = content.replace(/```json\n?[\s\S]*?\n?```/g, "").trim();
  }

  const summaryMatch = notesForStorage.match(/## (?:Samenvatting|Summary|samenvatting)\n([\s\S]*?)(?=\n##|$)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : (wordPlaceholders.samenvatting || "").slice(0, 500);

  return {
    notes: notesForStorage,
    summary,
    actionItems,
    ...(hasWordFields ? { wordPlaceholders } : {}),
  };
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = "audio/webm"
): Promise<{
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
}> {
  const ext = mimeType.includes("mp3") || mimeType.includes("mpeg") || mimeType.includes("mpga")
    ? "mp3"
    : mimeType.includes("mp4") || mimeType.includes("m4a")
      ? "mp4"
      : mimeType.includes("wav")
        ? "wav"
        : mimeType.includes("ogg")
          ? "ogg"
          : "webm";

  const tmpPath = join(tmpdir(), `recording-${Date.now()}.${ext}`);

  try {
    await writeFile(tmpPath, audioBuffer);

    const { createReadStream } = await import("fs");
    const stream = createReadStream(tmpPath);

    const response = await openai.audio.transcriptions.create({
      file: stream as never,
      model: "whisper-1",
      language: "nl",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const segments =
      (response as { segments?: Array<{ start: number; end: number; text: string }> }).segments?.map(
        (s) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        })
      ) || [];

    return {
      text: response.text,
      segments,
    };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function chatWithTranscript(
  transcript: string,
  notes: string,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<string> {
  const systemPrompt = `Je helpt bij vragen over één vergadering. Je hebt het transcript en de notities. Wees beknopt en nauwkeurig.

${TAAL_NL}

TRANSCRIPT:
${transcript}

NOTITIES:
${notes}`;

  return chatCompletionMulti("chat", systemPrompt, messages, 1024);
}

export async function extractActionItems(
  transcript: string
): Promise<Array<{ title: string; assignee?: string; description?: string }>> {
  const content = await chatCompletion(
    "actions",
    `Je extraheert gestructureerde data uit transcripten. ${TAAL_NL} Antwoord alleen met JSON als gevraagd.`,
    `Haal alle actiepunten uit dit vergadertranscript. Geef een JSON-array met objecten: title (verplicht), assignee (optioneel), description (optioneel). Waarden in het Nederlands waar het om taken gaat.

TRANSCRIPT:
${transcript}

Alleen geldige JSON, geen andere tekst.`,
    1024
  );

  try {
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned) as Array<{ title: string; assignee?: string; description?: string }>;
  } catch {
    return [];
  }
}

export async function generateTitle(transcript: string): Promise<string> {
  const text = await chatCompletion(
    "title",
    "",
    `Bedenk een korte, duidelijke titel (5–8 woorden) voor deze vergadering op basis van het transcript. Alleen de titel, verder niets. Nederlands.

TRANSCRIPT (eerste 500 tekens):
${transcript.slice(0, 500)}`,
    100
  );
  return text.trim().replace(/^["']|["']$/g, "") || "Naamloze meeting";
}

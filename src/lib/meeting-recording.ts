import type { AudioCaptureMode } from "@/types";
import type { OutlookEvent } from "@/lib/microsoft-graph";

/** Prefix voor automatisch gegenereerde titels (datum/tijd). */
export const AUTO_TITLE_PREFIX = "Opname ";

const DEFAULT_MEETING_DURATION_MS = 60 * 60 * 1000;
const CALENDAR_BUFFER_MS = 5 * 60 * 1000;

export function formatFallbackMeetingTitle(date = new Date()): string {
  const formatted = date.toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${AUTO_TITLE_PREFIX}${formatted}`;
}

/** Titels die na transcriptie door AI vervangen mogen worden. */
export function isProvisionalMeetingTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t === "Naamloze meeting" || t === "Untitled Meeting") return true;
  return t.startsWith(AUTO_TITLE_PREFIX);
}

export function isTeamsOutlookEvent(event: OutlookEvent): boolean {
  return (
    event.isOnlineMeeting &&
    (event.onlineMeetingProvider ?? "").toLowerCase().includes("teams")
  );
}

export function eventStartEnd(event: OutlookEvent): { start: Date; end: Date } {
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (end.getTime() <= start.getTime()) {
    return { start, end: new Date(start.getTime() + DEFAULT_MEETING_DURATION_MS) };
  }
  return { start, end };
}

export function isWithinMeetingWindow(
  start: Date,
  end: Date,
  now = new Date(),
  bufferMs = CALENDAR_BUFFER_MS
): boolean {
  return (
    now.getTime() >= start.getTime() - bufferMs &&
    now.getTime() <= end.getTime() + bufferMs
  );
}

export function findActiveOutlookEvent(
  events: OutlookEvent[],
  now = new Date()
): OutlookEvent | null {
  for (const event of events) {
    const { start, end } = eventStartEnd(event);
    if (isWithinMeetingWindow(start, end, now)) return event;
  }
  return null;
}

export function resolveCaptureMode(isTeamsMeeting: boolean): AudioCaptureMode {
  return isTeamsMeeting ? "hybrid" : "physical";
}

export type QuickStartCaptureHint =
  | "teams_hybrid"
  | "microphone_only";

export function captureHintMessage(hint: QuickStartCaptureHint): string {
  if (hint === "teams_hybrid") {
    return "Teams-vergadering in je agenda — microfoon + systeemgeluid (deel je Teams-tab of scherm met geluid).";
  }
  return "Geen Teams-vergadering nu — opname via microfoon.";
}

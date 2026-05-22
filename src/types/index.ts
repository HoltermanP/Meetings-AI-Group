import type { Meeting, Transcript, Notes, ActionItem, Template, Folder, Participant, ChatMessage } from "@prisma/client";

export type MeetingWithRelations = Meeting & {
  transcript?: Transcript | null;
  notes?: Notes | null;
  actionItems?: ActionItem[];
  participants?: Participant[];
  chatMessages?: ChatMessage[];
  template?: Template | null;
  folder?: Folder | null;
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
};

export type RecordingState = "idle" | "recording" | "paused" | "processing" | "done";

/** Fysiek = alleen microfoon. Hybride/online = microfoon + systeem-audio gemengd. */
export type AudioCaptureMode = "physical" | "online" | "hybrid";

export type Platform = "zoom" | "google_meet" | "teams" | "slack" | "webex" | "other";

export type { AnalysisReportType } from "@/lib/analysis-report-types";

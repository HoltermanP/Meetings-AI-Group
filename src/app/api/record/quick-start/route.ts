import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  captureHintMessage,
  findActiveOutlookEvent,
  formatFallbackMeetingTitle,
  isTeamsOutlookEvent,
  eventStartEnd,
  resolveCaptureMode,
  type QuickStartCaptureHint,
} from "@/lib/meeting-recording";
import {
  listUpcomingOutlookEvents,
  MsAuthRequiredError,
  type OutlookEvent,
} from "@/lib/microsoft-graph";

const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const CALENDAR_BUFFER_MS = 5 * 60 * 1000;

function isWithinWindow(
  start: Date,
  end: Date,
  now: Date,
): boolean {
  return (
    now.getTime() >= start.getTime() - CALENDAR_BUFFER_MS &&
    now.getTime() <= end.getTime() + CALENDAR_BUFFER_MS
  );
}

type DbMeetingCandidate = {
  id: string;
  title: string;
  status: string;
  scheduledAt: Date | null;
  scheduledEndAt: Date | null;
  platform: string | null;
  teamsJoinUrl: string | null;
  outlookEventId: string | null;
};

function findActiveDbMeeting(
  meetings: DbMeetingCandidate[],
  now: Date
): DbMeetingCandidate | null {
  for (const m of meetings) {
    if (!m.scheduledAt) continue;
    const start = m.scheduledAt;
    const end =
      m.scheduledEndAt ??
      new Date(start.getTime() + DEFAULT_DURATION_MS);
    if (isWithinWindow(start, end, now)) return m;
  }
  return null;
}

/**
 * Eén-klik opname: detecteert lopende Teams/agenda-vergadering, kiest opnamemodus,
 * en maakt of hergebruikt een meeting met passende titel.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const userId = session.user.id;
  const now = new Date();

  const inProgress = await prisma.meeting.findFirst({
    where: { userId, status: "recording" },
    select: { id: true, title: true },
  });
  if (inProgress) {
    return NextResponse.json(
      {
        error: "Er loopt al een opname",
        meetingId: inProgress.id,
        title: inProgress.title,
      },
      { status: 409 },
    );
  }

  let activeEvent: OutlookEvent | null = null;
  try {
    const events = await listUpcomingOutlookEvents(userId);
    activeEvent = findActiveOutlookEvent(events, now);
  } catch (err) {
    if (!(err instanceof MsAuthRequiredError)) {
      console.warn("[quick-start] Outlook ophalen mislukt:", err);
    }
  }

  const scheduledCandidates = await prisma.meeting.findMany({
    where: {
      userId,
      status: { in: ["scheduled", "draft"] },
      scheduledAt: { not: null },
    },
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      scheduledEndAt: true,
      platform: true,
      teamsJoinUrl: true,
      outlookEventId: true,
    },
    orderBy: { scheduledAt: "asc" },
  });

  const activeDb = findActiveDbMeeting(scheduledCandidates, now);

  const isTeamsMeeting = activeEvent
    ? isTeamsOutlookEvent(activeEvent)
    : Boolean(
        activeDb &&
          (activeDb.platform === "teams" ||
            Boolean(activeDb.teamsJoinUrl)),
      );

  const captureMode = resolveCaptureMode(isTeamsMeeting);
  const captureHint: QuickStartCaptureHint = isTeamsMeeting
    ? "teams_hybrid"
    : "microphone_only";

  let meetingId: string;
  let title: string;
  let titleSource: "calendar" | "datetime";

  if (activeEvent) {
    const { start, end } = eventStartEnd(activeEvent);
    const eventTitle = activeEvent.subject?.trim() || formatFallbackMeetingTitle(now);
    title = eventTitle;
    titleSource = "calendar";

    const linked = activeDb?.outlookEventId === activeEvent.id
      ? activeDb
      : await prisma.meeting.findFirst({
          where: { userId, outlookEventId: activeEvent.id },
          select: {
            id: true,
            title: true,
            status: true,
            scheduledAt: true,
            scheduledEndAt: true,
            platform: true,
            teamsJoinUrl: true,
            outlookEventId: true,
          },
        });

    if (linked && ["scheduled", "draft"].includes(linked.status)) {
      const updated = await prisma.meeting.update({
        where: { id: linked.id },
        data: {
          title: eventTitle,
          scheduledAt: start,
          scheduledEndAt: end,
          platform: isTeamsOutlookEvent(activeEvent) ? "teams" : linked.platform,
          teamsJoinUrl: activeEvent.onlineMeeting?.joinUrl ?? linked.teamsJoinUrl,
          status: "draft",
        },
      });
      meetingId = updated.id;
    } else {
      const created = await prisma.meeting.create({
        data: {
          userId,
          title: eventTitle,
          status: "draft",
          platform: isTeamsOutlookEvent(activeEvent) ? "teams" : "other",
          scheduledAt: start,
          scheduledEndAt: end,
          outlookEventId: activeEvent.id,
          teamsJoinUrl: activeEvent.onlineMeeting?.joinUrl ?? null,
        },
      });
      meetingId = created.id;
    }
  } else if (activeDb) {
    title = activeDb.title;
    titleSource = "calendar";
    const updated = await prisma.meeting.update({
      where: { id: activeDb.id },
      data: { status: "draft" },
    });
    meetingId = updated.id;
  } else {
    title = formatFallbackMeetingTitle(now);
    titleSource = "datetime";
    const created = await prisma.meeting.create({
      data: {
        userId,
        title,
        status: "draft",
        startedAt: null,
      },
    });
    meetingId = created.id;
  }

  return NextResponse.json({
    meetingId,
    title,
    titleSource,
    captureMode,
    captureHint,
    hint: captureHintMessage(captureHint),
    isTeamsMeeting,
  });
}

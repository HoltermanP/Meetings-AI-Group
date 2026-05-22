/**
 * Microsoft Graph change notification webhook.
 *
 * Microsoft stuurt hier POST-verzoeken naartoe als een kalender-event
 * wordt aangemaakt, gewijzigd of verwijderd.
 *
 * Stap 1 – validatie: Microsoft stuurt eerst een GET (of POST met
 *   validationToken) om te bevestigen dat het endpoint bestaat.
 * Stap 2 – verwerking: daarna stuurt Microsoft POST-berichten met
 *   change-notificaties. We halen het gewijzigde event op via Graph
 *   en synchroniseren het naar de meetings-tabel.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { graphFetch, type OutlookEvent } from "@/lib/microsoft-graph";

// Microsoft stuurt een GET met ?validationToken=... bij aanmaken subscription
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("validationToken");
  if (token) {
    return new NextResponse(token, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({ ok: true });
}

// Microsoft stuurt een POST met change-notificaties
export async function POST(req: NextRequest) {
  // Validatietoken kan ook als query-param bij de eerste POST komen
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  let body: { value?: GraphNotification[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const notifications = body.value ?? [];

  for (const notification of notifications) {
    // clientState = userId (we sturen dat zelf mee bij subscription aanmaken)
    const userId = notification.clientState;
    if (!userId) continue;

    // Controleer of de user bestaat en Outlook-tokens heeft
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, msRefreshToken: true },
    });
    if (!user?.msRefreshToken) continue;

    try {
      await processNotification(userId, notification);
    } catch (err) {
      console.error("Webhook notificatie verwerken mislukt:", err);
    }
  }

  // Microsoft verwacht altijd 202 Accepted
  return new NextResponse(null, { status: 202 });
}

// ---------------------------------------------------------------------------
// Verwerking per notificatie
// ---------------------------------------------------------------------------

async function processNotification(userId: string, notification: GraphNotification) {
  const changeType = notification.changeType;
  const resourceData = notification.resourceData;

  if (!resourceData?.id) return;

  const outlookEventId = resourceData.id;

  if (changeType === "deleted") {
    // Event verwijderd in Outlook → meeting op 'geannuleerd' zetten of verwijderen
    const meeting = await prisma.meeting.findFirst({
      where: { userId, outlookEventId },
    });
    if (!meeting) return;

    // Alleen geplande (nog niet gestarte) meetings verwijderen
    if (meeting.status === "scheduled") {
      await prisma.meeting.delete({ where: { id: meeting.id } });
    }
    return;
  }

  // created of updated: event ophalen via Graph
  const res = await graphFetch(
    userId,
    `/me/events/${outlookEventId}?$select=id,subject,start,end,attendees,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,body`
  );

  if (res.status === 404) {
    // Event bestaat niet meer
    return;
  }
  if (!res.ok) {
    console.error("Event ophalen mislukt:", await res.text());
    return;
  }

  const event = (await res.json()) as OutlookEvent;
  const scheduledAt = new Date(event.start.dateTime);
  const scheduledEndAt = new Date(event.end.dateTime);
  const isTeams =
    event.isOnlineMeeting &&
    (event.onlineMeetingProvider ?? "").toLowerCase().includes("teams");

  const existing = await prisma.meeting.findFirst({
    where: { userId, outlookEventId },
  });

  if (existing) {
    // Bijwerken als het nog gepland is
    if (existing.status === "scheduled") {
      await prisma.meeting.update({
        where: { id: existing.id },
        data: {
          title: event.subject || existing.title,
          scheduledAt,
          scheduledEndAt,
          platform: isTeams ? "teams" : existing.platform ?? "other",
          teamsJoinUrl: event.onlineMeeting?.joinUrl ?? existing.teamsJoinUrl,
        },
      });
    }
    return;
  }

  // Nieuw event: meeting aanmaken
  const participants = (event.attendees ?? []).slice(0, 20).map((a) => ({
    name: a.emailAddress.name || a.emailAddress.address,
    email: a.emailAddress.address,
  }));

  await prisma.meeting.create({
    data: {
      userId,
      title: event.subject || "Outlook-meeting",
      status: "scheduled",
      platform: isTeams ? "teams" : "other",
      scheduledAt,
      scheduledEndAt,
      outlookEventId,
      teamsJoinUrl: event.onlineMeeting?.joinUrl ?? null,
      participants: { create: participants },
    },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GraphNotification = {
  changeType: "created" | "updated" | "deleted";
  clientState?: string;
  resourceData?: {
    id?: string;
    "@odata.type"?: string;
  };
};

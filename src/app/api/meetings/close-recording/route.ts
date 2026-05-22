import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Sluit alle lopende opnames ("recording") van de ingelogde gebruiker af.
 * Gebruikt om een vastgelopen opname op te ruimen zodat een nieuwe kan starten.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const result = await prisma.meeting.updateMany({
    where: { userId: session.user.id, status: "recording" },
    data: { status: "completed", endedAt: new Date() },
  });

  return NextResponse.json({ closed: result.count });
}

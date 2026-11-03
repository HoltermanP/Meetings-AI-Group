import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Vaste stemprofielen (zonder audio — die haalt de pagina per profiel op). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profiles = await prisma.voiceProfile.findMany({
    where: { isAnonymous: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sampleSeconds: true,
      lastSeenAt: true,
      consentAt: true,
      createdAt: true,
      meeting: { select: { id: true, title: true } },
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  return NextResponse.json(profiles);
}

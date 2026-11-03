import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAnonymousSpeaker } from "@/lib/speakers";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { name?: unknown; consent?: unknown } | null;
  const data: { name?: string; consentAt?: Date | null } = {};

  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60 || isAnonymousSpeaker(name)) {
      return NextResponse.json({ error: "Ongeldige naam" }, { status: 400 });
    }
    const clash = await prisma.voiceProfile.findFirst({
      where: { isAnonymous: false, id: { not: id }, name: { equals: name, mode: "insensitive" } },
    });
    if (clash) return NextResponse.json({ error: `Er is al een stemprofiel voor ${clash.name}` }, { status: 409 });
    data.name = name;
  }
  if (typeof body?.consent === "boolean") data.consentAt = body.consent ? new Date() : null;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Niets te wijzigen" }, { status: 400 });

  const profile = await prisma.voiceProfile.update({
    where: { id },
    data,
    select: { id: true, name: true, consentAt: true },
  });
  return NextResponse.json(profile);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.voiceProfile.deleteMany({ where: { id } });
  return NextResponse.json({ success: true });
}

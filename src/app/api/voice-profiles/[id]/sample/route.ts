import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** Het opgeslagen fragment als WAV, om in de browser af te spelen. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const profile = await prisma.voiceProfile.findUnique({ where: { id }, select: { sample: true } });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const base64 = profile.sample.slice(profile.sample.indexOf(",") + 1);
  return new NextResponse(new Uint8Array(Buffer.from(base64, "base64")), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=300" },
  });
}

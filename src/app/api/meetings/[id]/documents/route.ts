import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ALLOWED_DOCUMENT_MIMES,
  extractTextFromBuffer,
  MAX_DOCUMENT_BYTES,
  mimeFromFileName,
} from "@/lib/document-extract";
import { removeContextDocument, writeContextDocument } from "@/lib/uploads";

async function getOwnedMeeting(meetingId: string, userId: string) {
  return prisma.meeting.findFirst({
    where: { id: meetingId, userId },
    select: { id: true, projectId: true },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const meeting = await getOwnedMeeting(id, session.user.id);
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const documents = await prisma.contextDocument.findMany({
    where: { meetingId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      extractedText: true,
    },
  });

  return NextResponse.json(
    documents.map((d) => ({
      ...d,
      hasText: Boolean(d.extractedText?.trim()),
      extractedText: undefined,
    })),
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const meeting = await getOwnedMeeting(id, session.user.id);
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen" }, { status: 400 });
  }

  if (file.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json(
      { error: "Bestand is te groot (max. 10 MB)" },
      { status: 400 },
    );
  }

  const mimeType =
    (file.type && ALLOWED_DOCUMENT_MIMES.has(file.type) ? file.type : null) ||
    mimeFromFileName(file.name);
  if (!mimeType || !ALLOWED_DOCUMENT_MIMES.has(mimeType)) {
    return NextResponse.json(
      { error: "Alleen PDF, Word (.docx), .txt en .md zijn toegestaan" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extractedText: string | null = null;
  try {
    extractedText = await extractTextFromBuffer(buffer, mimeType, file.name);
  } catch (e) {
    console.error("[documents/upload]", e);
    return NextResponse.json(
      { error: "Tekst kon niet uit het bestand worden gehaald" },
      { status: 422 },
    );
  }

  if (!extractedText?.trim()) {
    return NextResponse.json(
      { error: "Geen leesbare tekst gevonden in het document" },
      { status: 422 },
    );
  }

  const doc = await prisma.contextDocument.create({
    data: {
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      storagePath: "",
      extractedText,
      userId: session.user.id,
      meetingId: id,
    },
  });

  const storagePath = await writeContextDocument(
    session.user.id,
    doc.id,
    file.name,
    buffer,
  );

  const updated = await prisma.contextDocument.update({
    where: { id: doc.id },
    data: { storagePath },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ...updated, hasText: true }, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const meeting = await getOwnedMeeting(id, session.user.id);
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const docId = searchParams.get("docId");
  if (!docId) {
    return NextResponse.json({ error: "docId ontbreekt" }, { status: 400 });
  }

  const doc = await prisma.contextDocument.findFirst({
    where: { id: docId, meetingId: id, userId: session.user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await removeContextDocument(doc.storagePath);
  await prisma.contextDocument.delete({ where: { id: docId } });

  return NextResponse.json({ ok: true });
}

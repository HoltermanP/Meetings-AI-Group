-- CreateTable
CREATE TABLE "TranscriptChunk" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "offsetSeconds" DOUBLE PRECISION NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "content" TEXT NOT NULL,
    "segments" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptChunk_meetingId_index_key" ON "TranscriptChunk"("meetingId", "index");

-- AddForeignKey
ALTER TABLE "TranscriptChunk" ADD CONSTRAINT "TranscriptChunk_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

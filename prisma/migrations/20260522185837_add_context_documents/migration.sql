-- CreateTable
CREATE TABLE "ContextDocument" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "extractedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "meetingId" TEXT,
    "projectId" TEXT,

    CONSTRAINT "ContextDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContextDocument_meetingId_idx" ON "ContextDocument"("meetingId");

-- CreateIndex
CREATE INDEX "ContextDocument_projectId_idx" ON "ContextDocument"("projectId");

-- CreateIndex
CREATE INDEX "ContextDocument_userId_idx" ON "ContextDocument"("userId");

-- AddForeignKey
ALTER TABLE "ContextDocument" ADD CONSTRAINT "ContextDocument_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextDocument" ADD CONSTRAINT "ContextDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "scheduledEndAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_userId_outlookEventId_key" ON "Meeting"("userId", "outlookEventId");

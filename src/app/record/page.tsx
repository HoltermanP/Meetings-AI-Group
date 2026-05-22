"use client";

import MainLayout from "@/components/layout/MainLayout";
import QuickRecordPanel from "@/components/meeting/QuickRecordPanel";

export default function RecordPage() {
  return (
    <MainLayout title="Opname">
      <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-8">
        <QuickRecordPanel />
      </div>
    </MainLayout>
  );
}

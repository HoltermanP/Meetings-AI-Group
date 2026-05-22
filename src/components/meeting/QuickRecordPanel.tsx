"use client";

import { Mic, Loader2, Monitor, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuickRecord } from "@/lib/use-quick-record";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

/**
 * Eén-klik opname starten. Detecteert automatisch de opnamemodus en opent
 * meteen de meeting-pagina, waar de opname zelf begint.
 */
export default function QuickRecordPanel({ className }: Props) {
  const { startRecording, openConflict, closeAndRetry, loading, error, conflict } =
    useQuickRecord();

  return (
    <div className={cn("flex flex-col items-center gap-6 w-full max-w-md mx-auto", className)}>
      {error && (
        <div className="w-full rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {conflict && (
        <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-800">
            Er loopt al een opname: “{conflict.title}”.
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            Hervat die opname, of sluit ’m af om een nieuwe te starten.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={openConflict} disabled={loading}>
              Opname hervatten
            </Button>
            <Button size="sm" onClick={closeAndRetry} disabled={loading}>
              {loading ? "Bezig…" : "Afsluiten & nieuwe starten"}
            </Button>
          </div>
        </div>
      )}

      <div className="relative flex h-28 w-28 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-indigo-100 animate-pulse" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-indigo-600 shadow-lg">
          <Mic className="h-10 w-10 text-white" />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">Opname starten</h2>
        <p className="text-sm text-gray-500 leading-relaxed">
          Eén klik: we openen de meeting en starten de opname. We kijken in je agenda
          of er nu een Teams-vergadering loopt en kiezen automatisch microfoon of
          microfoon + systeemgeluid.
        </p>
      </div>

      <ul className="w-full text-left text-xs text-gray-600 space-y-2 rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3">
        <li className="flex gap-2">
          <Users className="h-4 w-4 shrink-0 text-indigo-500 mt-0.5" />
          <span>Teams in agenda → microfoon + geluid van je scherm/tab</span>
        </li>
        <li className="flex gap-2">
          <Mic className="h-4 w-4 shrink-0 text-indigo-500 mt-0.5" />
          <span>Geen Teams nu → alleen microfoon</span>
        </li>
        <li className="flex gap-2">
          <Monitor className="h-4 w-4 shrink-0 text-indigo-500 mt-0.5" />
          <span>Naam uit agenda, anders datum/tijd, daarna AI op basis van het gesprek</span>
        </li>
      </ul>

      <Button
        onClick={startRecording}
        disabled={loading}
        size="lg"
        className="w-full h-14 text-base gap-2 shadow-md"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Opname voorbereiden…
          </>
        ) : (
          <>
            <Mic className="h-5 w-5" />
            Start opname
          </>
        )}
      </Button>
    </div>
  );
}

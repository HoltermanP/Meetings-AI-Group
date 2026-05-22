"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

type QuickStartResponse = {
  meetingId?: string;
  title?: string;
  error?: string;
};

export type RecordConflict = { meetingId: string; title: string };

/**
 * Eén-klik opname starten: roept /api/record/quick-start aan (detecteert
 * Teams-/agenda-vergadering, kiest de opnamemodus, maakt of hergebruikt een
 * meeting) en navigeert meteen naar de meeting-pagina, waar de opname
 * automatisch start (?record=1).
 *
 * Loopt er al een opname, dan komt die terug als `conflict`; de gebruiker kan
 * dan zelf kiezen: hervatten (openConflict) of afsluiten + nieuwe starten
 * (closeAndRetry).
 */
export function useQuickRecord() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<RecordConflict | null>(null);

  /** Kern: quick-start aanroepen en navigeren, of een conflict tonen. */
  const runQuickStart = useCallback(async () => {
    const res = await fetch("/api/record/quick-start", { method: "POST" });
    const data = (await res.json()) as QuickStartResponse;

    // Er loopt al een opname — laat de gebruiker kiezen.
    if (res.status === 409 && data.meetingId) {
      setConflict({ meetingId: data.meetingId, title: data.title || "Lopende opname" });
      setLoading(false);
      return;
    }

    if (!res.ok || !data.meetingId) {
      setError(data.error || "Opname starten mislukt");
      setLoading(false);
      return;
    }

    // Navigeer naar de meeting-pagina; daar start de opname automatisch.
    // loading blijft true: de pagina navigeert weg.
    router.push(`/meetings/${data.meetingId}?record=1`);
  }, [router]);

  const startRecording = useCallback(async () => {
    if (loading) return;
    setError(null);
    setConflict(null);
    setLoading(true);
    try {
      await runQuickStart();
    } catch {
      setError("Kon geen verbinding maken met de server.");
      setLoading(false);
    }
  }, [loading, runQuickStart]);

  /** Open de lopende opname zonder opnieuw te starten. */
  const openConflict = useCallback(() => {
    if (conflict) router.push(`/meetings/${conflict.meetingId}`);
  }, [conflict, router]);

  /** Sluit alle lopende opnames af en start meteen een nieuwe. */
  const closeAndRetry = useCallback(async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/meetings/close-recording", { method: "POST" });
      if (!res.ok) {
        setError("Lopende opname afsluiten mislukt.");
        setLoading(false);
        return;
      }
      setConflict(null);
      await runQuickStart();
    } catch {
      setError("Kon geen verbinding maken met de server.");
      setLoading(false);
    }
  }, [loading, runQuickStart]);

  return { startRecording, openConflict, closeAndRetry, loading, error, conflict };
}

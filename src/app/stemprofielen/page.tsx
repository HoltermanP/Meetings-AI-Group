"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import MainLayout from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AudioLines, Pencil, Trash2, Check, X, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";

type Profile = {
  id: string;
  name: string;
  sampleSeconds: number;
  lastSeenAt: string;
  consentAt: string | null;
  createdAt: string;
  meeting: { id: string; title: string } | null;
  employee: { id: string; firstName: string; lastName: string } | null;
};

export default function StemprofielenPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/voice-profiles")
      .then((r) => r.json())
      .then((data) => { setProfiles(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function saveName(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/voice-profiles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Opslaan mislukt"); return; }
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, name: data.name } : p)));
      setEditId(null);
    } finally {
      setBusy(null);
    }
  }

  async function setConsent(p: Profile, consent: boolean) {
    const question = consent
      ? `Bevestig dat ${p.name} uitdrukkelijk toestemming heeft gegeven om zijn of haar stem vast te leggen voor herkenning in meetings.`
      : `Toestemming van ${p.name} intrekken? Het profiel wordt dan niet meer gebruikt in andere meetings.`;
    if (!confirm(question)) return;
    setBusy(p.id);
    setError(null);
    try {
      const res = await fetch(`/api/voice-profiles/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Opslaan mislukt"); return; }
      setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, consentAt: data.consentAt } : x)));
    } finally {
      setBusy(null);
    }
  }

  const pending = profiles.filter((p) => !p.consentAt).length;

  async function remove(p: Profile) {
    if (!confirm(`Stemprofiel van ${p.name} verwijderen? Deze stem wordt dan niet meer automatisch herkend.`)) return;
    setBusy(p.id);
    try {
      await fetch(`/api/voice-profiles/${p.id}`, { method: "DELETE" });
      setProfiles((prev) => prev.filter((x) => x.id !== p.id));
    } finally {
      setBusy(null);
    }
  }

  return (
    <MainLayout title="Stemprofielen">
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
            <AudioLines className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Stemprofielen</h1>
            <p className="text-xs text-gray-500">
              {profiles.length} bekende stem{profiles.length !== 1 ? "men" : ""}
              {pending > 0 && <span className="text-amber-700"> · {pending} wacht{pending === 1 ? "" : "en"} op toestemming</span>}
            </p>
          </div>
        </div>

        <p className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-xs leading-relaxed text-gray-600">
          Een stemprofiel ontstaat vanzelf zodra in een meeting duidelijk wordt wie er spreekt — iemand stelt zich voor of wordt bij naam aangesproken.
          Het profiel is een kort fragment (max. 10 seconden) en wordt in volgende meetings gebruikt om die stem te herkennen.
          Per opnamesegment worden maximaal 4 bekende stemmen meegestuurd: eerst wie al sprak, dan de deelnemers, dan wie recent sprak.
          Klopt een naam niet? Pas hem aan of verwijder het profiel.
        </p>
        <p className="mb-5 -mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
          Een stemprofiel is een biometrisch gegeven (AVG art. 9). Zonder vastgelegde toestemming wordt een profiel alleen gebruikt
          in de meeting waarin het is opgenomen. Leg toestemming pas vast nadat de persoon die uitdrukkelijk heeft gegeven.
        </p>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        ) : profiles.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 py-12 text-center">
            <AudioLines className="h-6 w-6 text-gray-400" />
            <p className="font-medium text-gray-700">Nog geen stemprofielen</p>
            <p className="text-sm text-gray-400">Ze verschijnen hier na de eerste opname waarin namen vallen</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {profiles.map((p) => (
              <div key={p.id} className="rounded-2xl border border-gray-100 bg-white p-3 hover:border-gray-200">
                <div className="flex items-center gap-3">
                  {editId === p.id ? (
                    <>
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveName(p.id)}
                        className="h-8 flex-1 text-sm"
                      />
                      <Button size="sm" onClick={() => saveName(p.id)} disabled={busy === p.id || !editName.trim()}>
                        {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditId(null); setError(null); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm font-semibold text-gray-900">
                          {p.name}
                          {p.consentAt ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                              Toestemming
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                              Wacht op toestemming
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-gray-500">
                          {Math.round(p.sampleSeconds)} s fragment · laatst gehoord{" "}
                          {formatDistanceToNow(new Date(p.lastSeenAt), { addSuffix: true, locale: nl })}
                          {p.meeting && (
                            <>
                              {" · uit "}
                              <Link href={`/meetings/${p.meeting.id}`} className="text-indigo-600 hover:underline">
                                {p.meeting.title}
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        title={p.consentAt ? "Toestemming intrekken" : "Toestemming vastleggen"}
                        onClick={() => setConsent(p, !p.consentAt)}
                        disabled={busy === p.id}
                        className={p.consentAt
                          ? "rounded-lg p-1.5 text-emerald-600 hover:bg-gray-100"
                          : "rounded-lg p-1.5 text-amber-600 hover:bg-amber-50"}
                      >
                        {p.consentAt ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        title="Naam aanpassen"
                        onClick={() => { setEditId(p.id); setEditName(p.name); setError(null); }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Verwijderen"
                        onClick={() => remove(p)}
                        disabled={busy === p.id}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </>
                  )}
                </div>
                <audio controls preload="none" src={`/api/voice-profiles/${p.id}/sample`} className="mt-2 h-8 w-full" />
              </div>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}

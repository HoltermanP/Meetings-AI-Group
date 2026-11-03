"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Mic, MicOff, Pause, Play, Square, Loader2, Monitor, Users, RefreshCw, ChevronDown, Smartphone, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/lib/utils";
import type { AudioCaptureMode, RecordingState } from "@/types";
import { cn } from "@/lib/utils";
import { deleteSegment, listSegments, saveSegment, type StoredSegment } from "@/lib/recording-store";
import { clipToWavDataUrl, decodeAudio } from "@/lib/audio-clip";

export type TranscribeResultMeta = {
  provisional?: boolean;
};

export type { AudioCaptureMode };

type Props = {
  meetingId: string;
  onTranscribed: (transcript: string, title: string, meta?: TranscribeResultMeta) => void;
  /** Vereenvoudigde bediening: geen modus-keuze, één startknop. */
  variant?: "full" | "quick";
  /** Vooraf bepaalde opnamemodus — geen modus-keuze meer.
   *  'quick'-variant: start automatisch (autoStartToken).
   *  'full'-variant: toont één 'Start opname'-knop. */
  presetCaptureMode?: AudioCaptureMode | null;
  autoStartToken?: number;
  /** Korte uitleg boven de knoppen (bv. Teams gedetecteerd). */
  statusHint?: string | null;
};

/** Hoe lang elke MediaRecorder-segment maximaal opneemt voordat-ie wordt geroteerd.
 *  5 min × 32 kbps ≈ 1,2 MB — past binnen Vercel's 4,5 MB body-limit én Whisper's 25 MB.
 *  Elk segment wordt meteen tijdens de opname geüpload en getranscribeerd.
 */
const SEGMENT_DURATION_SECONDS = 5 * 60;
const CHUNK_INTERVAL_MS = 1000;
/** Lopend segment elke 30 s lokaal wegschrijven — bij een crash hooguit 30 s audio kwijt. */
const CHECKPOINT_EVERY_CHUNKS = 30;
/** Wachttijden tussen upload-pogingen van één segment (daarna later opnieuw). */
const RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];
/** Iets ruimer dan maxDuration (300 s) van /transcribe-chunk. */
const UPLOAD_TIMEOUT_MS = 330_000;

type ActiveRecorder = {
  recorder: MediaRecorder;
  chunks: Blob[];
  index: number;
  offsetSeconds: number;
};

type SampleRequest = { name: string; start: number; end: number };

/**
 * Knipt per nieuw herkende spreker een fragment uit het segment en slaat het op als
 * stemprofiel. Mag nooit de upload laten falen — een gemist profiel komt later wel.
 */
async function saveVoiceSamples(meetingId: string, blob: Blob, requests: SampleRequest[]): Promise<void> {
  try {
    const audio = await decodeAudio(blob);
    for (const r of requests) {
      const { dataUrl, seconds } = await clipToWavDataUrl(audio, r.start, r.end);
      await fetch(`/api/meetings/${meetingId}/voice-samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: r.name, sample: dataUrl, seconds }),
      });
    }
  } catch (err) {
    console.warn("[stemprofiel] fragment opslaan mislukt:", err);
  }
}

type QueuedSegment = Pick<StoredSegment, "index" | "offsetSeconds" | "durationSeconds" | "blob">;

/**
 * Vraagt schermdeling met audio. Één aanroep — geen retry die de
 * "user gesture handler"-fout zou veroorzaken.
 */
function getDisplayMediaWithAudio(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    // 'browser' opent de kiezer meteen op het tabblad-overzicht — daar zit
    // (zeker op macOS) de enige bron die tab-audio kan meegeven.
    video: { displaySurface: "browser" },
    audio: true,
    // Extra hints; browsers die ze niet kennen, negeren ze stilletjes.
    systemAudio: "include",
    surfaceSwitching: "include",
    selfBrowserSurface: "exclude", // verberg de AI-Meetings-tab zelf
  } as DisplayMediaStreamOptions);
}

const NO_AUDIO_ERROR = isMacOS()
  ? `Geen audio ontvangen van de schermdeling.\n\n` +
    `Op macOS werkt systeemgeluid alleen via een browsertab:\n` +
    `• Sluit Teams of Meet in Chrome/Edge\n` +
    `• Klik op Start, kies "Tab" in het deelvenster\n` +
    `• Selecteer de juiste tab en vink "Tabblad-audio delen" aan\n\n` +
    `Voor de desktop-app (Teams/Zoom) gebruik je de microfoonmodus of installeer je BlackHole.`
  : `Geen audio ontvangen. Kies een scherm of venster en vink "Geluid delen" aan.`;

function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
}

/** Safari herkent aan aanwezigheid van "Safari" zonder "Chrome" of "Chromium" in de UA. */
function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome/i.test(ua) && !/Chromium/i.test(ua);
}

function isPhoneMic(label: string): boolean {
  const l = label.toLowerCase();
  return (
    l.includes("iphone") ||
    l.includes("ipad") ||
    l.includes("continuity") ||
    /\bandroid\b/.test(l) ||
    /\bgalaxy\b/.test(l) ||
    /\bpixel\b/.test(l)
  );
}


export default function AudioRecorder({
  meetingId,
  onTranscribed,
  variant = "full",
  presetCaptureMode = null,
  autoStartToken = 0,
  statusHint = null,
}: Props) {
  const isQuick = variant === "quick";
  /** Eén-knops bediening zonder modus-keuze — geldt voor de quick-variant én
   *  voor de meeting-pagina die de modus vooraf doorgeeft. */
  const simpleMode = presetCaptureMode != null;
  const [captureMode, setCaptureMode] = useState<AudioCaptureMode | null>(null);
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  /** Bij fysieke meeting: gebruiker moet expliciet aangeven of een telefoon als microfoon gekoppeld wordt. */
  const [usePhoneMic, setUsePhoneMic] = useState<"unset" | "yes" | "no">("unset");
  /** Onthoudt of de selectie automatisch op een telefoon-mic is gezet, zodat we niet over een handmatige keuze heen schrijven. */
  const autoSelectedPhoneRef = useRef(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeModeRef = useRef<AudioCaptureMode | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  /** De MediaRecorder die nu opneemt, met de data van het lopende segment. */
  const activeRef = useRef<ActiveRecorder | null>(null);
  /** Afgesloten segmenten die nog naar de server moeten (oudste eerst). */
  const queueRef = useRef<QueuedSegment[]>([]);
  const uploadRunRef = useRef<Promise<void> | null>(null);
  /** True als het oudste segment na alle retries nog niet geüpload kon worden. */
  const uploadStalledRef = useRef(false);
  const firstUploadNotifiedRef = useRef(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Upload na Stop vastgelopen — gebruiker kan opnieuw proberen of toch afronden. */
  const [finishFailed, setFinishFailed] = useState(false);
  /** Lokaal bewaarde segmenten van een eerdere, onderbroken sessie. */
  const [recoverable, setRecoverable] = useState<{ count: number; seconds: number } | null>(null);

  /** Timer die elke SEGMENT_DURATION_SECONDS de recorder roteert. */
  const rotateTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** True zolang we actief opnemen (niet gepauzeerd) — rotatie mag alleen dan. */
  const isRecordingRef = useRef(false);
  /** Tijdstip (epoch ms) dat overeenkomt met seconde 0 van de (voortgezette) opname. */
  const startTimeRef = useRef(0);
  const durationRef = useRef(0);

  const clearRotateTimer = useCallback(() => {
    if (rotateTimerRef.current) {
      clearTimeout(rotateTimerRef.current);
      rotateTimerRef.current = null;
    }
  }, []);

  /** Opnameduur in seconden, ook geldig tijdens pauze. */
  const elapsedSeconds = useCallback(
    () => (isRecordingRef.current ? (Date.now() - startTimeRef.current) / 1000 : durationRef.current),
    []
  );

  const startVolumeMonitor = (stream: MediaStream, existingCtx?: AudioContext) => {
    const ctx = existingCtx ?? new AudioContext();
    if (!existingCtx) audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setVolume(Math.min(100, avg * 2));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const pickMimeType = useCallback(() => {
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported("audio/ogg")) return "audio/ogg";
    if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4"; // Safari
    return "audio/webm";
  }, []);

  /**
   * Start een nieuwe MediaRecorder op de bestaande recordStream voor segment `index`.
   * Elke CHECKPOINT_EVERY_CHUNKS seconden wordt het lopende segment lokaal
   * weggeschreven, zodat een crash hooguit dat stukje audio kost.
   */
  const startNewRecorder = useCallback(
    (stream: MediaStream, index: number, offsetSeconds: number): ActiveRecorder => {
      const recorder = new MediaRecorder(stream, {
        mimeType: pickMimeType(),
        audioBitsPerSecond: 32_000, // 32 kbps mono — genoeg voor spraak
      });
      const active: ActiveRecorder = { recorder, chunks: [], index, offsetSeconds };
      let sinceCheckpoint = 0;
      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        active.chunks.push(e.data);
        sinceCheckpoint++;
        // Niet tijdens het afsluiten: dan schrijft closeSegment het definitieve segment weg.
        if (recorder.state === "recording" && sinceCheckpoint >= CHECKPOINT_EVERY_CHUNKS) {
          sinceCheckpoint = 0;
          void saveSegment({
            meetingId,
            index,
            offsetSeconds,
            durationSeconds: Math.max(0, elapsedSeconds() - offsetSeconds),
            blob: new Blob(active.chunks, { type: recorder.mimeType || "audio/webm" }),
            savedAt: Date.now(),
          });
        }
      };
      recorder.start(CHUNK_INTERVAL_MS);
      return active;
    },
    [meetingId, pickMimeType, elapsedSeconds]
  );

  /** Stopt een MediaRecorder en wacht tot alle data is afgegeven (complete, losse WebM). */
  const finalizeRecorder = useCallback(async (active: ActiveRecorder): Promise<Blob | null> => {
    const rec = active.recorder;
    if (rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.addEventListener("stop", () => resolve(), { once: true });
        try {
          rec.stop();
        } catch {
          resolve();
        }
      });
    }
    if (active.chunks.length === 0) return null;
    return new Blob(active.chunks, { type: rec.mimeType || "audio/webm" });
  }, []);

  const loadMics = useCallback(async () => {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === "audioinput");
      setAvailableMics(mics);
      if (!selectedMicId && mics.length > 0) {
        setSelectedMicId(mics[0].deviceId);
      }
    } catch {
      /* geen toestemming — stil falen */
    }
  }, [selectedMicId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    loadMics();
    navigator.mediaDevices.addEventListener("devicechange", loadMics);
    return () => navigator.mediaDevices.removeEventListener("devicechange", loadMics);
  }, [loadMics]);

  /** Telefoon uit de huidige lijst (eerste match). */
  const detectedPhoneMic = availableMics.find((m) => isPhoneMic(m.label || ""));

  /**
   * Voorselecteer telefoon-microfoon zodra die beschikbaar is en gebruiker "Ja" koos.
   * Schrijft niet over een latere handmatige keuze heen.
   */
  useEffect(() => {
    if (usePhoneMic !== "yes") return;
    if (!detectedPhoneMic) return;
    if (selectedMicId === detectedPhoneMic.deviceId) return;
    if (autoSelectedPhoneRef.current) return;
    setSelectedMicId(detectedPhoneMic.deviceId);
    autoSelectedPhoneRef.current = true;
  }, [usePhoneMic, detectedPhoneMic, selectedMicId]);

  /** Reset de "auto-geselecteerde" vlag als de gebruiker handmatig een andere mic kiest. */
  useEffect(() => {
    if (!detectedPhoneMic) return;
    if (selectedMicId !== detectedPhoneMic.deviceId) {
      autoSelectedPhoneRef.current = false;
    }
  }, [selectedMicId, detectedPhoneMic]);

  /** Bij "Ja" actief blijven scannen tot iPhone gevonden — devicechange-event vuurt niet altijd voor Continuity. */
  useEffect(() => {
    if (usePhoneMic !== "yes" || detectedPhoneMic) return;
    const t = setInterval(() => loadMics(), 2000);
    return () => clearInterval(t);
  }, [usePhoneMic, detectedPhoneMic, loadMics]);

  /** Reset telefoon-keuze als de gebruiker overschakelt naar online/hybride. */
  useEffect(() => {
    if (captureMode !== "physical") {
      setUsePhoneMic("unset");
      autoSelectedPhoneRef.current = false;
    }
  }, [captureMode]);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  /** Voorkomt dat het scherm (en daarmee vaak de opname) in slaap valt bij lange meetings. */
  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLockRef.current) {
        const lock = await navigator.wakeLock.request("screen");
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
      }
    } catch {
      /* niet ondersteund of geweigerd — opname gaat gewoon door */
    }
  }, []);

  const stopAllStreams = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    displayStreamRef.current = null;
    micStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    releaseWakeLock();
  }, [releaseWakeLock]);

  const micAudioConstraints = useCallback((): MediaTrackConstraints => ({
    ...(selectedMicId ? { deviceId: { exact: selectedMicId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    // Chrome-hint: voorkomt dat macOS andere audio zachter zet (audio ducking)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    googDucking: false,
  }), [selectedMicId]);

  /** Upload één segment naar /transcribe-chunk. Gooit een fout bij niet-200. */
  const uploadSegment = useCallback(
    async (seg: QueuedSegment): Promise<void> => {
      const type = seg.blob.type || "audio/webm";
      const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
      const formData = new FormData();
      formData.append("audio", seg.blob, `chunk-${seg.index}.${ext}`);
      formData.append("index", String(seg.index));
      formData.append("offsetSeconds", String(seg.offsetSeconds));
      formData.append("durationSeconds", String(seg.durationSeconds));
      formData.append("mimeType", type);

      const res = await fetch(`/api/meetings/${meetingId}/transcribe-chunk`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          (errData as { error?: string }).error || `Deel ${seg.index + 1} faalde (${res.status})`,
        );
      }

      const data = (await res.json().catch(() => ({}))) as { sampleRequests?: SampleRequest[] };
      if (data.sampleRequests?.length) {
        // Vóór het volgende segment opslaan, zodat dat deze stemmen al herkent.
        await saveVoiceSamples(meetingId, seg.blob, data.sampleRequests);
      }
    },
    [meetingId],
  );

  /**
   * Werkt de upload-wachtrij af, één segment tegelijk, met retries. Lukt een segment
   * na alle pogingen niet, dan blijft het (lokaal bewaard) vooraan staan en wordt het
   * bij het volgende segment, bij 'online' of bij Stop opnieuw geprobeerd.
   */
  const processQueue = useCallback((): Promise<void> => {
    if (uploadRunRef.current) return uploadRunRef.current;
    uploadStalledRef.current = false;
    const run = (async () => {
      while (queueRef.current.length > 0) {
        const seg = queueRef.current[0];
        let lastErr: unknown = null;
        let ok = false;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
          try {
            await uploadSegment(seg);
            ok = true;
            break;
          } catch (err) {
            lastErr = err;
            if (attempt < RETRY_DELAYS_MS.length) {
              setUploadError(`Deel ${seg.index + 1} nog niet verwerkt — opnieuw proberen…`);
              await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
            }
          }
        }
        if (!ok) {
          uploadStalledRef.current = true;
          const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
          setUploadError(`Deel ${seg.index + 1} kon niet worden verwerkt (${msg}). De audio staat veilig in je browser.`);
          break;
        }
        queueRef.current.shift();
        void deleteSegment(meetingId, seg.index);
        setUploadedCount((c) => c + 1);
        setPendingCount(queueRef.current.length);
        setUploadError(null);
        if (!firstUploadNotifiedRef.current) {
          firstUploadNotifiedRef.current = true;
          // Laat de meetingpagina gaan pollen: het transcript groeit mee tijdens de opname.
          onTranscribed("", "", { provisional: true });
        }
      }
      // Synchroon na de laatste lengte-check vrijgeven, zodat een segment dat nét
      // wordt toegevoegd altijd een nieuwe run start.
      uploadRunRef.current = null;
    })();
    uploadRunRef.current = run;
    return run;
  }, [meetingId, uploadSegment, onTranscribed]);

  const enqueue = useCallback((segs: QueuedSegment[]) => {
    const known = new Set(queueRef.current.map((s) => s.index));
    for (const s of segs) if (!known.has(s.index)) queueRef.current.push(s);
    queueRef.current.sort((a, b) => a.index - b.index);
    setPendingCount(queueRef.current.length);
    void processQueue();
  }, [processQueue]);

  /** Sluit een recorder af, bewaart het segment lokaal en zet het in de upload-wachtrij. */
  const closeSegment = useCallback(async (active: ActiveRecorder, endSeconds: number) => {
    const blob = await finalizeRecorder(active);
    if (!blob || blob.size === 0) return;
    const seg: StoredSegment = {
      meetingId,
      index: active.index,
      offsetSeconds: active.offsetSeconds,
      durationSeconds: Math.max(0, endSeconds - active.offsetSeconds),
      blob,
      savedAt: Date.now(),
    };
    await saveSegment(seg);
    enqueue([seg]);
  }, [meetingId, finalizeRecorder, enqueue]);

  /** Lokaal achtergebleven segmenten (eerdere sessie) opzoeken bij laden. */
  useEffect(() => {
    let cancelled = false;
    void listSegments(meetingId).then((segs) => {
      if (cancelled || segs.length === 0) return;
      setRecoverable({
        count: segs.length,
        seconds: segs.reduce((sum, s) => sum + s.durationSeconds, 0),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  /** Netwerk terug → vastgelopen uploads meteen opnieuw proberen. */
  useEffect(() => {
    const onOnline = () => {
      if (queueRef.current.length > 0) void processQueue();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [processQueue]);

  /** Waarschuw bij sluiten van de tab zolang er opgenomen of geüpload wordt. */
  useEffect(() => {
    const busy = state === "recording" || state === "paused" || state === "processing";
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

  /** Wake lock vervalt als de tab even verborgen was — opnieuw aanvragen. */
  useEffect(() => {
    if (state !== "recording" && state !== "paused") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state, requestWakeLock]);

  const rotateRef = useRef<() => void>(() => {});

  const scheduleNextRotate = useCallback((delaySeconds = SEGMENT_DURATION_SECONDS) => {
    clearRotateTimer();
    rotateTimerRef.current = setTimeout(() => rotateRef.current(), Math.max(1, delaySeconds) * 1000);
  }, [clearRotateTimer]);

  /**
   * Roteert de MediaRecorder: start eerst een nieuwe recorder op dezelfde stream
   * (geen gat in de audio), sluit daarna het oude segment af en zet het in de wachtrij.
   */
  const rotateRecorder = useCallback(() => {
    if (!isRecordingRef.current) return;
    const stream = streamRef.current;
    const old = activeRef.current;
    if (!stream || !old) return;

    const now = elapsedSeconds();
    try {
      activeRef.current = startNewRecorder(stream, old.index + 1, now);
    } catch (err) {
      console.error("[recorder] nieuw segment starten mislukt:", err);
      setError("De opname is onderbroken (microfoon of gedeeld scherm weggevallen). Klik op Stop om de opname te verwerken.");
      return;
    }
    scheduleNextRotate();
    void closeSegment(old, now);
  }, [elapsedSeconds, startNewRecorder, scheduleNextRotate, closeSegment]);
  rotateRef.current = rotateRecorder;

  /** Alle uploads afronden en de meeting definitief maken. */
  const finishUploads = useCallback(async (totalDuration: number) => {
    setFinishFailed(false);
    setState("processing");
    if (queueRef.current.length > 0) {
      onTranscribed("", "", { provisional: true });
      firstUploadNotifiedRef.current = true;
    }
    // Herhalen: tijdens een lopende run kan er nog een segment bijgekomen zijn.
    while (queueRef.current.length > 0) {
      await processQueue();
      if (uploadStalledRef.current) {
        setFinishFailed(true);
        return;
      }
    }
    await completeMeeting(totalDuration);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processQueue, onTranscribed]);

  const completeMeeting = async (totalDuration: number) => {
    try {
      const res = await fetch(`/api/meetings/${meetingId}/transcribe-finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalDuration: Math.round(totalDuration) }),
      });
      if (!res.ok) throw new Error(`Afronden mislukt (${res.status})`);
      setRecoverable(null);
      setState("done");
      onTranscribed("", "", { provisional: false });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Afronden mislukt");
      setFinishFailed(true);
    }
  };

  const stopRef = useRef<() => void>(() => {});

  const start = useCallback(async (mode: AudioCaptureMode) => {
    setError(null);
    setUploadError(null);
    activeModeRef.current = mode;

    try {
      let recordStream: MediaStream;

      if (mode === "physical") {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(),
          video: false,
        });
        micStreamRef.current = micStream;
        recordStream = micStream;
      } else {
        // Één aanroep — geen retry, want een tweede getDisplayMedia buiten het
        // click-event gooit "must be called from a user gesture handler".
        const displayStream = await getDisplayMediaWithAudio();
        displayStreamRef.current = displayStream;

        if (displayStream.getAudioTracks().length === 0) {
          displayStream.getTracks().forEach((t) => t.stop());
          displayStreamRef.current = null;
          setError(NO_AUDIO_ERROR);
          return;
        }

        // Schermdeling gestopt → opname netjes afronden (niets weggooien).
        displayStream.getVideoTracks().forEach((t) => {
          t.onended = () => stopRef.current();
        });

        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: micAudioConstraints(),
          video: false,
        });
        micStreamRef.current = micStream;

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const dest = audioCtx.createMediaStreamDestination();
        audioCtx.createMediaStreamSource(displayStream).connect(dest);
        audioCtx.createMediaStreamSource(micStream).connect(dest);
        recordStream = dest.stream;
      }

      // Verder waar een eerdere (onderbroken) opname gebleven is: server + lokaal.
      let nextIndex = 0;
      let nextOffset = 0;
      try {
        const res = await fetch(`/api/meetings/${meetingId}/transcribe-chunk`);
        if (res.ok) {
          const pos = (await res.json()) as { nextIndex: number; nextOffsetSeconds: number };
          nextIndex = pos.nextIndex;
          nextOffset = pos.nextOffsetSeconds;
        }
      } catch {
        /* offline — lokale gegevens hieronder */
      }
      const leftover = await listSegments(meetingId);
      for (const s of leftover) {
        nextIndex = Math.max(nextIndex, s.index + 1);
        nextOffset = Math.max(nextOffset, Math.ceil(s.offsetSeconds + s.durationSeconds));
      }

      streamRef.current = recordStream;
      isRecordingRef.current = true;
      startTimeRef.current = Date.now() - nextOffset * 1000;
      durationRef.current = nextOffset;
      setDuration(nextOffset);
      activeRef.current = startNewRecorder(recordStream, nextIndex, nextOffset);
      setState("recording");
      setRecoverable(null);
      if (leftover.length > 0) enqueue(leftover);

      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
        durationRef.current = secs;
        setDuration(secs);
      }, 1000);

      scheduleNextRotate();
      void requestWakeLock();
      // Hergebruik de bestaande AudioContext bij online/hybride om te voorkomen dat
      // een tweede context macOS-ducking opnieuw triggert.
      startVolumeMonitor(recordStream, audioCtxRef.current ?? undefined);

      await fetch(`/api/meetings/${meetingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "recording", startedAt: new Date().toISOString() }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/user gesture|transient activation|user activation/i.test(msg)) {
        // Auto-start net na een paginawissel kan buiten het klik-venster vallen.
        setError("Klik op 'Start opname' om de schermdeling te starten.");
      } else if (msg.includes("Permission denied") || msg.includes("NotAllowedError")) {
        setError("Toestemming geweigerd — controleer microfoon- en schermrechten in je browser.");
      } else if (msg.includes("AbortError") || msg.includes("cancelled") || msg.includes("dismissed")) {
        setError("Schermdeling geannuleerd. Klik op Start om het opnieuw te proberen.");
      } else {
        setError(msg || "Opname starten mislukt");
      }
    }
  }, [meetingId, micAudioConstraints, scheduleNextRotate, startNewRecorder, enqueue, requestWakeLock]);

  const autoStartAttemptedRef = useRef(0);
  useEffect(() => {
    if (!presetCaptureMode || autoStartToken <= 0) return;
    if (autoStartAttemptedRef.current === autoStartToken) return;
    if (state !== "idle") return;
    autoStartAttemptedRef.current = autoStartToken;
    setCaptureMode(presetCaptureMode);
    void start(presetCaptureMode);
  }, [presetCaptureMode, autoStartToken, state, start]);

  const pause = useCallback(() => {
    const rec = activeRef.current?.recorder;
    if (rec?.state === "recording") {
      durationRef.current = elapsedSeconds();
      rec.pause();
      isRecordingRef.current = false;
      clearRotateTimer();
      setState("paused");
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    }
  }, [clearRotateTimer, elapsedSeconds]);

  const resume = useCallback(() => {
    const active = activeRef.current;
    if (active?.recorder.state === "paused") {
      active.recorder.resume();
      startTimeRef.current = Date.now() - durationRef.current * 1000;
      isRecordingRef.current = true;
      setState("recording");
      timerRef.current = setInterval(() => {
        const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
        durationRef.current = secs;
        setDuration(secs);
      }, 1000);
      // Alleen de resterende segmenttijd, zodat segmenten niet te groot worden.
      scheduleNextRotate(SEGMENT_DURATION_SECONDS - (durationRef.current - active.offsetSeconds));
      if (streamRef.current) startVolumeMonitor(streamRef.current, audioCtxRef.current ?? undefined);
    }
  }, [scheduleNextRotate]);

  const stop = useCallback(async () => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;

    const finalDuration = elapsedSeconds();
    durationRef.current = finalDuration;
    isRecordingRef.current = false;
    setState("processing");
    if (timerRef.current) clearInterval(timerRef.current);
    clearRotateTimer();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    await closeSegment(active, finalDuration);
    stopAllStreams();

    await fetch(`/api/meetings/${meetingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endedAt: new Date().toISOString(), duration: Math.round(finalDuration) }),
    }).catch(() => {});

    await finishUploads(finalDuration);
  }, [meetingId, elapsedSeconds, clearRotateTimer, closeSegment, stopAllStreams, finishUploads]);
  stopRef.current = () => void stop();

  /** Lokaal achtergebleven segmenten verwerken en de meeting afronden (meeting is al voorbij). */
  const recoverAndFinish = useCallback(async () => {
    const leftover = await listSegments(meetingId);
    const end = leftover.reduce((m, s) => Math.max(m, s.offsetSeconds + s.durationSeconds), 0);
    setState("processing");
    enqueue(leftover);
    await finishUploads(end);
  }, [meetingId, enqueue, finishUploads]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearRotateTimer();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      stopAllStreams();
    };
  }, [stopAllStreams, clearRotateTimer]);

  const totalSegments = uploadedCount + pendingCount;

  if (state === "processing") {
    if (finishFailed) {
      return (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 p-6 md:p-8">
          <p className="font-medium text-amber-800">Nog niet alle opnamedelen zijn verwerkt</p>
          <p className="text-sm text-amber-800 text-center max-w-md whitespace-pre-wrap">
            {uploadError}
            {"\n"}
            {uploadedCount} van {totalSegments} delen verwerkt. De overige audio blijft bewaard in deze browser.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 w-full max-w-sm">
            <Button onClick={() => void finishUploads(durationRef.current)} className="flex-1 gap-2">
              <RefreshCw className="h-4 w-4" />
              Opnieuw proberen
            </Button>
            <Button
              variant="outline"
              onClick={() => void completeMeeting(durationRef.current)}
              className="flex-1"
            >
              Afronden zonder deze delen
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-8">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <div className="text-center">
          <p className="font-medium text-indigo-700">Audio transcriberen…</p>
          <p className="text-sm text-indigo-500 mt-1">
            {totalSegments > 0
              ? `${uploadedCount} van ${totalSegments} delen verwerkt.`
              : "Whisper verwerkt de opname."}
          </p>
          {uploadError && <p className="text-xs text-amber-700 mt-2">{uploadError}</p>}
        </div>
        <Progress
          value={totalSegments > 0 ? Math.round((uploadedCount / totalSegments) * 100) : 0}
          className="w-full max-w-xs"
        />
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-green-100 bg-green-50 p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <Mic className="h-6 w-6 text-green-600" />
        </div>
        <p className="font-medium text-green-700">Transcriptie klaar</p>
        <p className="text-xs text-center text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 max-w-md">
          Het volledige transcript is opgeslagen — je kunt nu notulen genereren.
        </p>
        <p className="text-sm text-green-600">Duur: {formatDuration(duration)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-gray-200 bg-white p-6 md:p-8">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 whitespace-pre-wrap">{error}</div>
      )}

      {recoverable && state === "idle" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <p>
            Er {recoverable.count === 1 ? "staat 1 opnamedeel" : `staan ${recoverable.count} opnamedelen`} (~
            {Math.max(1, Math.round(recoverable.seconds / 60))} min) van een onderbroken opname nog in deze browser.
            Met &lsquo;Start opname&rsquo; worden ze mee verwerkt en loopt de opname verder.
          </p>
          <Button size="sm" variant="outline" onClick={() => void recoverAndFinish()}>
            Meeting is voorbij — verwerk en rond af
          </Button>
        </div>
      )}

      {statusHint && state === "idle" && (
        <p className="text-center text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2">
          {statusHint}
        </p>
      )}

      <div className="flex flex-col items-center gap-6">
        {/* Pulserende indicator */}
        <div className="relative flex h-24 w-24 items-center justify-center">
          {state === "recording" && (
            <>
              <div
                className="absolute inset-0 rounded-full bg-red-100 animate-ping"
                style={{ animationDuration: "1.5s", opacity: volume / 200 }}
              />
              <div
                className="absolute rounded-full bg-red-200"
                style={{
                  width: `${40 + volume * 0.4}px`,
                  height: `${40 + volume * 0.4}px`,
                  transition: "width 0.1s, height 0.1s",
                }}
              />
            </>
          )}
          <div
            className={cn(
              "relative flex h-16 w-16 items-center justify-center rounded-full transition-colors",
              state === "recording" ? "bg-red-500" : state === "paused" ? "bg-yellow-500" : "bg-gray-100"
            )}
          >
            {state === "idle" ? (
              <Mic className="h-7 w-7 text-gray-400" />
            ) : state === "recording" ? (
              <Mic className="h-7 w-7 text-white" />
            ) : (
              <MicOff className="h-7 w-7 text-white" />
            )}
          </div>
        </div>

        {state !== "idle" && (
          <div className="font-mono text-2xl font-bold text-gray-800">{formatDuration(duration)}</div>
        )}

        {(state === "recording" || state === "paused") && totalSegments > 0 && (
          <p className={cn("text-center text-xs max-w-md", uploadError ? "text-amber-700" : "text-gray-500")}>
            {uploadError ??
              `Transcriptie loopt mee: ${uploadedCount} ${uploadedCount === 1 ? "deel" : "delen"} van 5 min verwerkt${pendingCount > 0 ? `, ${pendingCount} in behandeling` : ""}.`}
          </p>
        )}

        {(state === "recording" || state === "paused") && statusHint && (
          <p className="text-center text-xs text-gray-600 max-w-md">{statusHint}</p>
        )}

        {/* Modus-keuze (alleen full + idle, zónder vooraf bepaalde modus) */}
        {state === "idle" && !isQuick && !presetCaptureMode && (
          <div className="w-full max-w-lg space-y-3">
            {/* Microfoon-selector */}
            {availableMics.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-600 shrink-0">Microfoon</label>
                <div className="relative flex-1">
                  <select
                    value={selectedMicId}
                    onChange={(e) => setSelectedMicId(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  >
                    {availableMics.map((mic) => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label || `Microfoon ${mic.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                </div>
                <button
                  type="button"
                  onClick={loadMics}
                  title="Ververs apparaten"
                  className="shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:border-indigo-300 hover:text-indigo-600"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {isSafari() && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Je gebruikt Safari. Online/hybride opname (systeemgeluid) wordt niet ondersteund in Safari — gebruik Chrome of Edge voor het opnemen van online meetings.
              </p>
            )}
            <p className="text-center text-sm font-medium text-gray-700">Hoe wil je opnemen?</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(
                [
                  {
                    mode: "physical" as const,
                    label: "Fysieke meeting",
                    icon: <Mic className="h-5 w-5 shrink-0" />,
                    desc: "Alleen microfoon",
                    detail: "Iedereen in dezelfde ruimte. Je neemt op via de microfoon.",
                  },
                  {
                    mode: "hybrid" as const,
                    label: "Hybride meeting",
                    icon: <Users className="h-5 w-5 shrink-0" />,
                    desc: "Microfoon + systeemaudio",
                    detail: isMacOS()
                      ? "Deel een browsertab (Teams/Meet in Chrome) en vink 'Tabblad-audio delen' aan."
                      : "Deelnemers op afstand én in de ruimte: microfoon plus laptop-geluid (Teams/Zoom).",
                  },
                  {
                    mode: "online" as const,
                    label: "Online meeting",
                    icon: <Monitor className="h-5 w-5 shrink-0" />,
                    desc: "Jij + geluid van de call",
                    detail: isMacOS()
                      ? "Kies 'Tab' in het deelvenster en vink 'Tabblad-audio delen' aan. Werkt voor Teams/Meet in de browser."
                      : "Volledig online: microfoon voor jezelf, systeemaudio voor de rest. Vereist schermdeling met 'Geluid delen'.",
                  },
                ] as const
              ).map(({ mode, label, icon, desc, detail }) => {
                const disabledInSafari = isSafari() && mode !== "physical";
                return (
                <button
                  key={mode}
                  type="button"
                  disabled={disabledInSafari}
                  onClick={() => !disabledInSafari && setCaptureMode(mode)}
                  title={disabledInSafari ? "Niet beschikbaar in Safari — gebruik Chrome of Edge" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border-2 px-3 py-3 text-left transition-colors sm:text-center",
                    disabledInSafari
                      ? "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300"
                      : captureMode === mode
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-indigo-200 hover:bg-indigo-50/50"
                  )}
                >
                  <span className="flex items-center gap-2 sm:flex-col sm:gap-1.5">
                    {icon}
                    <span className="text-xs font-semibold leading-tight">{label}</span>
                  </span>
                  <span className="text-[11px] leading-snug">{disabledInSafari ? "Niet in Safari" : desc}</span>
                  {captureMode === mode && !disabledInSafari && (
                    <span className="w-full rounded-lg bg-white/80 px-2 py-2 text-left text-[11px] leading-relaxed text-gray-600 sm:text-center">
                      {detail}
                    </span>
                  )}
                </button>
                );
              })}
            </div>
            {/* iPhone-koppeling — alleen bij fysieke meeting */}
            {captureMode === "physical" && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Smartphone className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-gray-800">
                      Telefoon als microfoon koppelen?
                    </p>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      Een iPhone (of Android) midden op tafel pakt vaak meer stemmen op dan de laptop-microfoon.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUsePhoneMic("yes")}
                    className={cn(
                      "rounded-lg border-2 px-3 py-2 text-xs font-medium transition-colors",
                      usePhoneMic === "yes"
                        ? "border-indigo-500 bg-white text-indigo-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-indigo-300"
                    )}
                  >
                    Ja, telefoon gebruiken
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUsePhoneMic("no");
                      autoSelectedPhoneRef.current = false;
                      const firstNonPhone = availableMics.find((m) => !isPhoneMic(m.label || ""));
                      if (firstNonPhone) setSelectedMicId(firstNonPhone.deviceId);
                    }}
                    className={cn(
                      "rounded-lg border-2 px-3 py-2 text-xs font-medium transition-colors",
                      usePhoneMic === "no"
                        ? "border-indigo-500 bg-white text-indigo-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-indigo-300"
                    )}
                  >
                    Nee, laptop-microfoon
                  </button>
                </div>

                {usePhoneMic === "yes" && (
                  <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2 text-[11px] leading-relaxed text-gray-700 space-y-1.5">
                    {detectedPhoneMic ? (
                      <p className="flex items-center gap-1.5 text-emerald-700 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        Telefoon gevonden: {detectedPhoneMic.label || "iPhone-microfoon"} — automatisch geselecteerd.
                      </p>
                    ) : (
                      <>
                        <p className="flex items-center gap-1.5 text-amber-700 font-medium">
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          Wacht op telefoon…
                        </p>
                        <ul className="list-disc pl-4 space-y-0.5 text-gray-600">
                          <li>
                            <strong>iPhone (Continuity):</strong> ontgrendel je iPhone in de buurt van je Mac (zelfde Apple-account, Wi-Fi + Bluetooth aan).
                          </li>
                          <li>
                            <strong>Via kabel:</strong> sluit je telefoon met USB aan en sta microfoon-toegang toe.
                          </li>
                          <li>
                            <strong>Bluetooth-headset/telefoon:</strong> koppel als audio-apparaat in macOS-instellingen.
                          </li>
                        </ul>
                      </>
                    )}
                  </div>
                )}

                {usePhoneMic === "unset" && (
                  <p className="text-[11px] text-amber-700">
                    Maak een keuze zodat je weet welke microfoon de opname maakt.
                  </p>
                )}
              </div>
            )}

            <Button
              onClick={() => captureMode && start(captureMode)}
              disabled={!captureMode}
              size="lg"
              className="w-full gap-2"
            >
              <Mic className="h-4 w-4" />
              Start opname
            </Button>
          </div>
        )}

        {/* Eén startknop — opnamemodus is vooraf bepaald (meeting-pagina) */}
        {state === "idle" && !isQuick && presetCaptureMode && (
          <Button
            onClick={() => start(presetCaptureMode)}
            size="lg"
            className="w-full max-w-sm gap-2"
          >
            <Mic className="h-4 w-4" />
            Start opname
          </Button>
        )}

        {/* Waarschuwing schermdeling open houden (alleen online/hybride) */}
        {(state === "recording" || state === "paused") && activeModeRef.current !== "physical" && (
          <p className="text-center text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 max-w-md">
            Laat het gedeelde scherm of venster open tot je op Stop drukt — anders stopt de opname mee.
          </p>
        )}

        {/* Bedieningsknoppen tijdens opname */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-3",
            simpleMode && "w-full max-w-sm flex-col sm:flex-row",
          )}
        >
          {state === "recording" && (
            <>
              <Button
                onClick={pause}
                variant="outline"
                size={simpleMode ? "lg" : "icon"}
                className={cn(simpleMode && "w-full sm:w-auto gap-2 flex-1")}
              >
                <Pause className="h-4 w-4" />
                {simpleMode && "Pauzeer"}
              </Button>
              <Button
                onClick={stop}
                variant="destructive"
                size={simpleMode ? "lg" : "default"}
                className={cn("gap-2", simpleMode && "w-full sm:w-auto flex-1")}
              >
                <Square className="h-4 w-4" />
                {simpleMode ? "Stop" : "Stop & transcriptie"}
              </Button>
            </>
          )}
          {state === "paused" && (
            <>
              <Button
                onClick={resume}
                variant="outline"
                size={simpleMode ? "lg" : "default"}
                className={cn("gap-2", simpleMode && "w-full sm:w-auto flex-1")}
              >
                <Play className="h-4 w-4" />
                Hervat
              </Button>
              <Button
                onClick={stop}
                variant="destructive"
                size={simpleMode ? "lg" : "default"}
                className={cn("gap-2", simpleMode && "w-full sm:w-auto flex-1")}
              >
                <Square className="h-4 w-4" />
                {simpleMode ? "Stop" : "Stop & transcriptie"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

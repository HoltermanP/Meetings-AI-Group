/**
 * Knipt in de browser een stuk uit een opgenomen segment en levert het als
 * 16 kHz mono WAV-data-URL — het formaat voor een stemprofiel. Server-side kan
 * dat niet zonder ffmpeg; de browser kan WebM/Opus zelf decoderen.
 */

const SAMPLE_RATE = 16_000;

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close().catch(() => {});
  }
}

export async function clipToWavDataUrl(
  buffer: AudioBuffer,
  start: number,
  end: number,
): Promise<{ dataUrl: string; seconds: number }> {
  const from = Math.max(0, start);
  const seconds = Math.min(end, buffer.duration) - from;
  if (seconds <= 0) throw new Error("Leeg fragment");

  const offline = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0, from, seconds);
  const rendered = await offline.startRendering();

  const dataUrl = await blobToDataUrl(encodeWav(rendered.getChannelData(0), SAMPLE_RATE));
  return { dataUrl, seconds };
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

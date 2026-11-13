// Speech to text for the headset (SPEC.md Phase 4: voice input). Quest Browser has no SpeechRecognition,
// so the page records the microphone, converts the clip to 16 kHz mono 16-bit WAV, and posts it here;
// Meta's Muse Voice Transcribe (POST /v1/asr/transcribe, a multipart "request" + "audio") returns the text.
const META_BASE = (process.env.META_API_BASE || 'https://api.meta.ai/v1').replace(/\/$/, '');
const MODEL = process.env.VOICE_MODEL || 'muse-voice-transcribe-1.0';

export type Transcription = { ok: true; text: string; ms: number; audioMs?: number } | { ok: false; error: string };

export async function transcribe(wav: Buffer): Promise<Transcription> {
  const key = process.env.META_API_KEY;
  if (!key) return { ok: false, error: 'Voice input is not set up on this server (META_API_KEY).' };
  if (wav.length < 1000 || wav.subarray(0, 4).toString('latin1') !== 'RIFF') return { ok: false, error: 'Send a WAV recording.' };
  const sampleRate = wav.readUInt32LE(24); // WAV header: the fmt chunk's sample rate
  if (sampleRate !== 16000 && sampleRate !== 24000) return { ok: false, error: 'The recording must be 16 or 24 kHz.' };
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify({ model: MODEL, audioEncoding: 'WAV', sampleRate })], { type: 'application/json' }));
  form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'voice.wav');
  const started = performance.now();
  try {
    const res = await fetch(`${META_BASE}/asr/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { transcript?: string; audioDurationMs?: number; error?: { message?: string } };
    if (!res.ok || typeof body.transcript !== 'string') return { ok: false, error: body.error?.message ?? `Transcription failed (HTTP ${res.status}).` };
    return { ok: true, text: body.transcript.trim(), ms: Math.round(performance.now() - started), audioMs: body.audioDurationMs };
  } catch (err) {
    return { ok: false, error: `Transcription failed: ${(err as Error).message}` };
  }
}

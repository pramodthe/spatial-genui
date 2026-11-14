// Speech to text for the headset (SPEC.md Phase 4: voice input). Quest Browser has no SpeechRecognition,
// so the page records the microphone, converts the clip to 16 kHz mono 16-bit WAV, and posts it here;
// Meta's Muse Voice Transcribe (POST /v1/asr/transcribe, a multipart "request" + "audio") returns the text.
const META_BASE = (process.env.META_API_BASE || 'https://api.meta.ai/v1').replace(/\/$/, '');
const MODEL = process.env.VOICE_MODEL || 'muse-voice-transcribe-1.0';

/**
 * A short-lived Deepgram token for the voice tutor (the browser's Voice Agent connection, xr voice-agent.ts):
 * it is only needed to open the WebSocket, so it lives 60 s, and the Deepgram key stays on this server.
 */
export async function voiceAgentToken(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return { ok: false, error: 'The voice tutor is not set up on this server (DEEPGRAM_API_KEY).' };
  try {
    const res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST', headers: { authorization: `Token ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl_seconds: 60 }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; err_msg?: string };
    if (!res.ok || !body.access_token) return { ok: false, error: body.err_msg ?? `Deepgram refused the token (HTTP ${res.status}).` };
    return { ok: true, token: body.access_token };
  } catch (err) {
    return { ok: false, error: `Deepgram could not be reached: ${(err as Error).message}` };
  }
}

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

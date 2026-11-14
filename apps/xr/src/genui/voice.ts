/**
 * Voice requests in the headset (SPEC.md Phase 4). Quest Browser has no SpeechRecognition, but it can record
 * the microphone: the clip is decoded, resampled to 16 kHz mono 16-bit WAV (what the transcription model
 * takes), and posted to the agent server (/api/transcribe), which keeps the API key.
 */

// A spoken request is a sentence or two; stop on our own after this long.
const MAX_LISTEN_MS = 15_000;
const SAMPLE_RATE = 16_000;

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let autoStop = 0;

export function voiceAvailable(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
}

export type MicrophoneState = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Whether the page may use the microphone. Quest Browser cannot show its permission prompt inside an
 * immersive session, so the start page asks for it before XR (askForMicrophone) and the picker checks here.
 */
export async function microphoneState(): Promise<MicrophoneState> {
  try {
    const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return status ? (status.state as MicrophoneState) : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Show the browser's microphone prompt (outside XR) and release the microphone at once. */
export async function askForMicrophone(): Promise<MicrophoneState> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of probe.getTracks()) track.stop();
    return 'granted';
  } catch {
    return (await microphoneState()) === 'granted' ? 'granted' : 'denied';
  }
}

export function isListening(): boolean {
  return recorder !== null;
}

// A permission prompt that cannot be shown (inside XR) leaves getUserMedia waiting forever: give up after this.
const MICROPHONE_WAIT_MS = 6000;

/** Start recording; `onTimeout` runs if the learner doesn't stop within MAX_LISTEN_MS. */
export async function startListening(onTimeout: () => void): Promise<void> {
  const asked = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  let waited = 0;
  const gaveUp = new Promise<never>((_, reject) => {
    waited = window.setTimeout(() => reject(new Error('The microphone did not start.')), MICROPHONE_WAIT_MS);
  });
  try {
    stream = await Promise.race([asked, gaveUp]);
  } catch (err) {
    // If the microphone starts after we gave up, turn it straight off again.
    void asked.then((late) => late.getTracks().forEach((track) => track.stop()), () => {});
    throw err;
  } finally {
    clearTimeout(waited);
  }
  chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();
  autoStop = window.setTimeout(onTimeout, MAX_LISTEN_MS);
}

/** Stop recording and return what was said. */
export async function stopAndTranscribe(): Promise<string> {
  clearTimeout(autoStop);
  const active = recorder;
  recorder = null;
  if (!active) throw new Error('Not listening.');
  const stopped = new Promise<void>((resolve) => active.addEventListener('stop', () => resolve(), { once: true }));
  active.stop();
  await stopped;
  releaseMicrophone();
  const wav = await toWav(new Blob(chunks, { type: active.mimeType }));
  const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
  if (!body.ok || typeof body.text !== 'string') throw new Error(body.error ?? `Transcription failed (HTTP ${res.status}).`);
  return body.text;
}

export function cancelListening() {
  clearTimeout(autoStop);
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  recorder = null;
  releaseMicrophone();
}

function releaseMicrophone() {
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
}

/** The recording as 16 kHz mono 16-bit PCM WAV. */
async function toWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await recording.arrayBuffer());
  void context.close();
  // A one-channel offline render at 16 kHz downmixes and resamples in one step.
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

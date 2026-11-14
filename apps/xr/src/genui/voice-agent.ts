/**
 * The voice tutor: a live spoken conversation through Deepgram's Voice Agent API (speech to text, a language
 * model and a voice in one WebSocket). The agent can act in the app through client-side functions: plan a
 * course, list the courses, open a lesson, and say what the open lesson is about. The page gets a short-lived
 * token from our server (/api/voice-agent/token), so the Deepgram key never reaches the browser.
 *
 * Audio: the microphone is resampled to 16 kHz 16-bit PCM in an AudioWorklet and streamed; the agent's 24 kHz
 * PCM replies are queued for playback, and cut off when the learner starts talking over them.
 */

const AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';
const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

export type TutorActions = {
  /** Plan a course; returns what to tell the learner. */
  createCourse(subject: string): Promise<Record<string, unknown>>;
  listCourses(): Promise<Record<string, unknown>>;
  openLesson(course: string, lesson: number): Promise<Record<string, unknown>>;
  currentLesson(): Record<string, unknown>;
};

export type TutorEvents = {
  /** A line of the conversation, as it is said. */
  onText(role: 'user' | 'assistant', text: string): void;
  onState(state: 'connecting' | 'listening' | 'thinking' | 'speaking' | 'stopped', detail?: string): void;
};

const FUNCTIONS = [
  {
    name: 'create_course',
    description: 'Plan a new hands-on course about a subject the learner asks for. Its lessons are written in the background over a few minutes; a course about one physical object first gets its own 3D model, which takes about 20 minutes.',
    parameters: { type: 'object', properties: { subject: { type: 'string', description: 'What the course is about, in a few words, e.g. "how a jet engine works"' } }, required: ['subject'] },
  },
  {
    name: 'list_courses',
    description: "List the learner's saved courses with each lesson's title and whether it is ready.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'open_lesson',
    description: 'Open a lesson of a saved course on the learner\'s desk. A lesson that is not written yet is started and takes a few minutes.',
    parameters: {
      type: 'object',
      properties: {
        course: { type: 'string', description: 'Course title or subject, as the learner said it' },
        lesson: { type: 'number', description: 'Lesson number, starting at 1' },
      },
      required: ['course', 'lesson'],
    },
  },
  {
    name: 'current_lesson',
    description: 'What the lesson open on the desk is about, to answer questions about it.',
    parameters: { type: 'object', properties: {} },
  },
];

const PROMPT = `You are the voice tutor in a mixed-reality learning app. The learner wears a headset; lessons are interactive 3D models on their desk that they pick up, turn and take apart with their hands.
- Speak naturally and briefly: one to three short sentences. No lists, no markdown, no emoji.
- To make a course, call create_course. To open a lesson, call open_lesson. To check what exists, call list_courses. To talk about what is on the desk, call current_lesson first.
- After you start something that takes time, say how long and that you will be here.
- Answer questions about the subject itself directly and accurately, like a good teacher, and suggest something to try with their hands in the lesson.`;

// The microphone tap: resample to 16 kHz and send 16-bit PCM in ~40 ms chunks.
const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.step = sampleRate / ${INPUT_RATE}; this.at = 0; this.out = new Int16Array(${INPUT_RATE / 25}); this.n = 0; }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (; this.at < input.length; this.at += this.step) {
      const i = Math.floor(this.at), f = this.at - i;
      const v = i + 1 < input.length ? input[i] * (1 - f) + input[i + 1] * f : input[i];
      this.out[this.n++] = Math.max(-1, Math.min(1, v)) * 0x7fff;
      if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(${INPUT_RATE / 25}); this.n = 0; }
    }
    this.at -= input.length;
    return true;
  }
}
registerProcessor('tutor-tap', Tap);`;

export class VoiceTutor {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private playing: AudioBufferSourceNode[] = [];
  private playAt = 0;
  private keepAlive = 0;

  constructor(private readonly actions: TutorActions, private readonly events: TutorEvents) {}

  get active() {
    return this.socket !== null;
  }

  async start(context: string) {
    if (this.socket) return;
    this.events.onState('connecting');
    const res = await fetch('/api/voice-agent/token', { method: 'POST' });
    const grant = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !grant.token) throw new Error(grant.error ?? `The voice tutor is not available (HTTP ${res.status}).`);

    this.audio = new AudioContext();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const socket = new WebSocket(AGENT_URL, ['bearer', grant.token]);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return this.play(event.data as ArrayBuffer);
      const message = JSON.parse(event.data) as { type: string; role?: 'user' | 'assistant'; content?: string; description?: string; message?: string; functions?: { id: string; name: string; arguments: string; client_side: boolean }[] };
      switch (message.type) {
        case 'Welcome':
          socket.send(JSON.stringify(this.settings(context)));
          break;
        case 'SettingsApplied':
          void this.listen();
          break;
        case 'ConversationText':
          if (message.role && message.content) this.events.onText(message.role, message.content);
          break;
        case 'UserStartedSpeaking':
          this.interrupt();
          this.events.onState('listening');
          break;
        case 'AgentThinking':
          this.events.onState('thinking');
          break;
        case 'AgentStartedSpeaking':
          this.events.onState('speaking');
          break;
        case 'AgentAudioDone':
          this.events.onState('listening');
          break;
        case 'FunctionCallRequest':
          for (const call of message.functions ?? []) if (call.client_side) void this.call(call);
          break;
        case 'Error':
          this.events.onState('stopped', message.description ?? message.message ?? 'The voice tutor stopped.');
          this.stop();
          break;
      }
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.stop();
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) {
        this.events.onState('stopped', 'Lost the connection to the voice tutor.');
        this.stop();
      }
    });
  }

  stop() {
    const socket = this.socket;
    this.socket = null;
    clearInterval(this.keepAlive);
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.interrupt();
    void this.audio?.close();
    this.audio = null;
    this.events.onState('stopped');
  }

  private settings(context: string) {
    return {
      type: 'Settings',
      audio: { input: { encoding: 'linear16', sample_rate: INPUT_RATE }, output: { encoding: 'linear16', sample_rate: OUTPUT_RATE, container: 'none' } },
      agent: {
        listen: { provider: { type: 'deepgram', model: 'nova-3' } },
        think: { provider: { type: 'open_ai', model: 'gpt-5-mini', reasoning_mode: 'minimal' }, prompt: `${PROMPT}\n\n${context}`, functions: FUNCTIONS },
        speak: { provider: { type: 'deepgram', model: 'aura-2-asteria-en' } },
        greeting: 'Hi! What would you like to learn?',
      },
    };
  }

  private async listen() {
    const audio = this.audio;
    const socket = this.socket;
    if (!audio || !socket || !this.stream) return;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try {
      await audio.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const tap = new AudioWorkletNode(audio, 'tutor-tap');
    tap.port.onmessage = (event) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(event.data as ArrayBuffer);
    };
    audio.createMediaStreamSource(this.stream).connect(tap);
    // The tap must be pulled by the graph to run; it outputs silence.
    tap.connect(audio.destination);
    this.keepAlive = window.setInterval(() => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'KeepAlive' })), 8000);
    this.events.onState('listening');
  }

  /** Queue a chunk of the agent's voice (16-bit PCM, 24 kHz) right after the one before it. */
  private play(data: ArrayBuffer) {
    const audio = this.audio;
    if (!audio || data.byteLength < 2) return;
    const samples = new Int16Array(data, 0, Math.floor(data.byteLength / 2));
    const buffer = audio.createBuffer(1, samples.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    this.playAt = Math.max(this.playAt, audio.currentTime + 0.05);
    source.start(this.playAt);
    this.playAt += buffer.duration;
    this.playing.push(source);
    source.onended = () => (this.playing = this.playing.filter((s) => s !== source));
  }

  /** The learner talked over the agent: stop its voice now. */
  private interrupt() {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // already ended
      }
    }
    this.playing = [];
    this.playAt = 0;
  }

  private async call(call: { id: string; name: string; arguments: string }) {
    let result: Record<string, unknown>;
    try {
      const args = JSON.parse(call.arguments || '{}') as { subject?: string; course?: string; lesson?: number };
      if (call.name === 'create_course') result = await this.actions.createCourse(String(args.subject ?? ''));
      else if (call.name === 'list_courses') result = await this.actions.listCourses();
      else if (call.name === 'open_lesson') result = await this.actions.openLesson(String(args.course ?? ''), Number(args.lesson ?? 1));
      else if (call.name === 'current_lesson') result = this.actions.currentLesson();
      else result = { error: `No function called ${call.name}.` };
    } catch (err) {
      result = { error: (err as Error).message };
    }
    this.socket?.send(JSON.stringify({ type: 'FunctionCallResponse', id: call.id, name: call.name, content: JSON.stringify(result) }));
  }
}

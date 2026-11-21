import { OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { MASCOT_NAME } from './brand';
import { MUSE_HELLO_CLIP, createMuse3D } from './muse3d';
import { playAppClip } from './sound';

/**
 * The start page's hello: Muse rises big in the middle of the screen, lands with a squash, waves and says hi, then
 * turns, hops across the page shrinking as it goes, and dives into its face on the logo, which bounces. About four
 * seconds; a tap or a key skips it. Drawn on a canvas of its own over the page, in screen pixels (an orthographic
 * camera, one unit = one pixel), and removed when it ends. The caller skips it with reduced motion.
 */

const TIMES = { rise: 0.55, land: 0.8, wave: 2.35, turn: 2.65, run: 3.75, dive: 4.05, end: 4.35 };
// Where Muse's face is in logo.png, as fractions of the picture: its centre across, its foot down, its height.
const FACE = { x: 0.114, foot: 0.76, height: 0.55 };
const MUSE_HEIGHT = 0.97; // the model's height in its own units (muse3d.ts)
const HOPS = 3;

const STYLE = `
.muse-intro { position: fixed; inset: 0; z-index: 10050; cursor: pointer; }
.muse-intro canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.muse-intro-veil { position: absolute; inset: 0; background: rgba(214, 238, 255, 0.6); transition: opacity 0.5s; }
.muse-intro-say { position: absolute; padding: 12px 22px; border: 4px solid var(--ink, #12063b); border-radius: 26px;
  background: var(--paper, #fff); color: var(--ink, #12063b); box-shadow: 0 6px 0 var(--ink, #12063b);
  font-family: 'Lilita One', system-ui, sans-serif; font-size: clamp(26px, 3.4vw, 44px); line-height: 1.05;
  white-space: nowrap; opacity: 0; transform: scale(0.6); transform-origin: 0 100%;
  transition: opacity 0.18s, transform 0.25s cubic-bezier(0.3, 1.6, 0.5, 1); pointer-events: none; }
.muse-intro-say.is-on { opacity: 1; transform: scale(1); }
.muse-intro-skip { position: absolute; right: 18px; bottom: 16px; font: 600 15px system-ui, sans-serif;
  color: rgba(18, 6, 59, 0.6); pointer-events: none; }
@keyframes muse-logo-boing { 0% { transform: scale(1); } 30% { transform: scale(1.12, 0.9); } 55% { transform: scale(0.95, 1.06); } 80% { transform: scale(1.02, 0.98); } 100% { transform: scale(1); } }
.muse-logo-boing { animation: muse-logo-boing 0.55s ease-out; transform-origin: 11% 76%; }
`;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => x * x * (3 - 2 * x);
const backOut = (x: number) => { const s = 1.6, u = x - 1; return 1 + (s + 1) * u * u * u + s * u * u; };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Progress of time `t` through [a, b], 0..1. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

let styled = false;

/** Play the hello over the page; `onDone` runs once when it ends or is skipped. */
export function playMuseIntro(logo: HTMLElement, onDone: () => void): void {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    styled = true;
  }
  const root = document.createElement('div');
  root.className = 'muse-intro';
  root.setAttribute('role', 'presentation');
  const veil = document.createElement('div');
  veil.className = 'muse-intro-veil';
  const canvas = document.createElement('canvas');
  const say = document.createElement('div');
  say.className = 'muse-intro-say';
  say.textContent = `Hi! I'm ${MASCOT_NAME}!`;
  const skip = document.createElement('div');
  skip.className = 'muse-intro-skip';
  skip.textContent = 'Tap to skip';
  root.append(veil, canvas, say, skip);
  document.body.appendChild(root);
  // Said aloud as it lands, where the page may play sound (after a tap: the logo; not on a fresh load).
  playAppClip(MUSE_HELLO_CLIP, 0.5);

  const W = window.innerWidth, H = window.innerHeight;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    root.remove();
    onDone();
    return;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(W, H, false);
  // Screen pixels, with the origin in the middle and y up.
  const camera = new OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 6000);
  camera.position.z = 3000;
  const scene = new Scene();
  const muse = createMuse3D();
  scene.add(muse.object);

  // Big in the middle, and its face on the logo at the end (both measured now: the page does not move meanwhile).
  const big = Math.min(H * 0.55, W * 0.55) / MUSE_HEIGHT;
  const centre = { x: 0, y: -big * MUSE_HEIGHT * 0.5 };
  const box = logo.getBoundingClientRect();
  const small = (box.height * FACE.height) / MUSE_HEIGHT;
  const home = { x: box.left + box.width * FACE.x - W / 2, y: H / 2 - (box.top + box.height * FACE.foot) };
  const look = new Vector3();

  let start = 0;
  let last = 0;
  let waved = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('keydown', finish);
    root.remove();
    renderer.dispose();
    renderer.forceContextLoss();
    logo.classList.remove('muse-logo-boing');
    void logo.offsetWidth; // restart the bounce
    logo.classList.add('muse-logo-boing');
    window.setTimeout(() => logo.classList.remove('muse-logo-boing'), 700);
    onDone();
  };
  root.addEventListener('pointerdown', finish);
  window.addEventListener('keydown', finish);

  const frame = (now: number) => {
    if (finished) return;
    if (!start) start = last = now;
    const t = (now - start) / 1000;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const o = muse.object;
    let x = centre.x, y = centre.y, size = big, sx = 1, sy = 1, turn = 0, lean = 0;
    let watching = true; // looking at the player; otherwise at the logo

    if (t < TIMES.rise) {
      // Up from below the screen, stretched as it flies.
      const p = seg(t, 0, TIMES.rise);
      y = lerp(-H / 2 - big * 1.2, centre.y, backOut(p));
      sy = 1.12 - 0.12 * p; sx = 1 / Math.sqrt(sy);
    } else if (t < TIMES.land) {
      // Lands: a squash that springs back.
      const p = seg(t, TIMES.rise, TIMES.land);
      sy = 1 - 0.16 * Math.sin(p * Math.PI) * (1 - p * 0.4); sx = 1 / Math.sqrt(sy);
    } else if (t < TIMES.wave) {
      if (waved === 0) { muse.wave(); waved = 1; }
      if (waved === 1 && t > TIMES.land + 0.75) { muse.wave(); waved = 2; }
    } else if (t < TIMES.turn) {
      // Turns to the logo and crouches to jump.
      const p = ease(seg(t, TIMES.wave, TIMES.turn));
      turn = -0.75 * p;
      sy = 1 - 0.14 * p; sx = 1 / Math.sqrt(sy);
      watching = false;
    } else if (t < TIMES.run) {
      // Hops across the page toward the logo, smaller with every hop.
      const p = seg(t, TIMES.turn, TIMES.run);
      const travel = ease(p);
      x = lerp(centre.x, home.x, travel);
      y = lerp(centre.y, home.y, travel);
      size = lerp(big, small * 1.35, travel);
      const hop = (p * HOPS) % 1;
      y += Math.sin(hop * Math.PI) * size * MUSE_HEIGHT * 0.55;
      // Stretched in the air, squashed on each landing.
      const air = Math.sin(hop * Math.PI);
      sy = 0.86 + 0.24 * air; sx = 1 / Math.sqrt(sy);
      turn = -0.75;
      lean = 0.18;
      watching = false;
    } else if (t < TIMES.dive) {
      // One last hop, into its face on the logo.
      const p = seg(t, TIMES.run, TIMES.dive);
      x = home.x;
      y = home.y + Math.sin(p * Math.PI) * small * MUSE_HEIGHT * 0.5;
      size = lerp(small * 1.35, small, p);
      turn = lerp(-0.75, 0, p);
      sy = 0.9 + 0.2 * Math.sin(p * Math.PI); sx = 1 / Math.sqrt(sy);
      watching = false;
    } else {
      finish();
      return;
    }

    o.position.set(x, y, 0);
    o.scale.set(size * sx, size * sy, size * sx);
    o.rotation.set(0, turn, lean);
    if (watching) look.set(x, y + size * 0.6, 3000);
    else look.set(home.x, home.y + small * 0.5, size * 2);
    muse.update(dt, 'idle', look);

    // The greeting beside its head while it waves; the veil lifts as it leaves.
    const talking = t > TIMES.land - 0.05 && t < TIMES.wave + 0.05;
    say.classList.toggle('is-on', talking);
    if (talking) {
      say.style.left = `${W / 2 + x + size * 0.42}px`;
      say.style.top = `${H / 2 - (y + size * MUSE_HEIGHT * 1.05)}px`;
    }
    veil.style.opacity = String(1 - seg(t, TIMES.turn, TIMES.run));
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

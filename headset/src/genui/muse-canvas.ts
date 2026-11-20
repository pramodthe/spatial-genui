import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { MASCOT_NAME } from './brand';
import { createMuse3D, type MuseMood } from './muse3d';

/**
 * Muse in 3D for the 2D start page: a small transparent canvas of its own. The eyes follow the pointer anywhere on
 * the page, or a thing it is attending to (the question box while the player types, with a nod at each word). Each
 * tap does something else (a wave, a happy hop, a spin), and it takes a mood: thinking while a game is being made, a
 * cheer when one is asked for or ready. It draws only while it is on screen; with reduced motion it stays still
 * apart from its eyes.
 */
export type MuseCanvas = {
  element: HTMLButtonElement;
  setMood(mood: MuseMood): void;
  /** A moment of joy over whatever mood it is in: a few hops with an open mouth. */
  cheer(): void;
  wave(): void;
  /** Watch this element instead of the pointer (null: the pointer again). */
  attend(target: HTMLElement | null): void;
  /** A small nod, as at a word heard. */
  nod(): void;
};

const SPIN_S = 0.75;
const NOD_S = 0.32;
const CHEER_S = 1.7;
const BASE_TURN = 0.28; // turned a little toward the question beside it

export function createMuseCanvas(): MuseCanvas {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'muse-3d';
  element.setAttribute('aria-label', `Say hi to ${MASCOT_NAME}`);
  const canvas = document.createElement('canvas');
  element.appendChild(canvas);

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new Scene();
  const camera = new PerspectiveCamera(24, 1, 0.1, 20);
  camera.position.set(0, 0.6, 3.3);
  camera.lookAt(0, 0.56, 0);
  const muse = createMuse3D();
  muse.object.rotation.y = BASE_TURN;
  scene.add(muse.object);

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mood: MuseMood = 'idle';
  let cheerFor = 0;
  let spinFor = 0;
  let nodFor = 0;
  let taps = 0;
  let attending: HTMLElement | null = null;
  const look = new Vector3(0, 0.56, 3.3);
  const ray = new Vector3();
  // A point on the page as a point 1.5 units in front of Muse, in the direction it is seen from the camera.
  const lookAtScreen = (clientX: number, clientY: number) => {
    const box = canvas.getBoundingClientRect();
    if (box.width === 0) return;
    const x = ((clientX - box.left) / box.width) * 2 - 1;
    const y = -((clientY - box.top) / box.height) * 2 + 1;
    ray.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
    look.copy(camera.position).addScaledVector(ray, (camera.position.z - 1.5) / -ray.z);
  };
  window.addEventListener('pointermove', (event) => { if (!attending) lookAtScreen(event.clientX, event.clientY); }, { passive: true });
  // Each tap does the next thing.
  element.addEventListener('click', () => {
    if (still) return;
    const reaction = taps++ % 3;
    if (reaction === 0) muse.wave();
    else if (reaction === 1) cheerFor = CHEER_S;
    else spinFor = SPIN_S;
  });

  const size = () => {
    const w = element.clientWidth, h = element.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(size).observe(element);

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Only while it is on screen (the page is hidden in the headset's room view).
    if (element.isConnected && element.offsetParent !== null && !document.hidden) {
      if (attending) {
        const box = attending.getBoundingClientRect();
        lookAtScreen(box.left + Math.min(box.width / 2, 160), box.top + box.height / 2);
      }
      cheerFor = Math.max(0, cheerFor - dt);
      spinFor = Math.max(0, spinFor - dt);
      nodFor = Math.max(0, nodFor - dt);
      const spin = spinFor > 0 ? 1 - spinFor / SPIN_S : 0;
      muse.object.rotation.y = BASE_TURN + (spin * spin * (3 - 2 * spin)) * Math.PI * 2;
      muse.object.rotation.x = nodFor > 0 ? Math.sin((1 - nodFor / NOD_S) * Math.PI) * 0.16 : 0;
      muse.update(dt, still ? 'idle' : cheerFor > 0 ? 'cheer' : mood, look);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    element,
    setMood(next) {
      mood = next;
      // A cheer is a moment: a few hops, then back to the mood it is in.
      if (next === 'cheer') { mood = 'idle'; cheerFor = CHEER_S; }
    },
    cheer() {
      if (!still) cheerFor = CHEER_S;
    },
    wave() {
      if (!still) muse.wave();
    },
    attend(target) {
      attending = target;
    },
    nod() {
      if (!still && nodFor === 0) nodFor = NOD_S;
    },
  };
}

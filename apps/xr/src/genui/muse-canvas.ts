import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { MASCOT_NAME } from './brand';
import { createMuse3D, type MuseMood } from './muse3d';

/**
 * Muse in 3D for the 2D start page: a small transparent canvas of its own. The eyes follow the pointer anywhere on
 * the page, a tap makes it wave, and it takes a mood: thinking while a game is being made, a cheer when one is
 * ready. It draws only while it is on screen; with reduced motion it stays still apart from its eyes.
 */
export function createMuseCanvas(): { element: HTMLButtonElement; setMood(mood: MuseMood): void } {
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
  // Turned a little toward the question beside it.
  muse.object.rotation.y = 0.28;
  scene.add(muse.object);

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mood: MuseMood = 'idle';
  let cheerTimer = 0;
  const look = new Vector3(0, 0.56, 3.3);
  const ray = new Vector3();
  window.addEventListener('pointermove', (event) => {
    const box = canvas.getBoundingClientRect();
    if (box.width === 0) return;
    // The pointer as a point 1.5 units in front of Muse, in the direction it is seen from the camera.
    const x = ((event.clientX - box.left) / box.width) * 2 - 1;
    const y = -((event.clientY - box.top) / box.height) * 2 + 1;
    ray.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
    look.copy(camera.position).addScaledVector(ray, (camera.position.z - 1.5) / -ray.z);
  }, { passive: true });
  element.addEventListener('click', () => { if (!still) muse.wave(); });

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
      muse.update(dt, still ? 'idle' : mood, look);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    element,
    setMood(next) {
      window.clearTimeout(cheerTimer);
      mood = next;
      // A cheer is a moment: a few hops, then back to watching.
      if (next === 'cheer') cheerTimer = window.setTimeout(() => { mood = 'idle'; }, 1700);
    },
  };
}

import {
  Box3,
  Color,
  FloatType,
  PerspectiveCamera,
  Sphere,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type World,
} from '@iwsdk/core';

/**
 * A picture of the mounted lesson from a virtual camera, independent of where the viewer is and of the
 * headset's field of view. Used to review generated lessons (tests, benchmark) and to show the agent
 * its own work. Works inside an XR session: it renders one extra off-screen frame.
 */

export type CaptureOptions = {
  width?: number;
  height?: number;
  /** Camera direction around the lesson, in degrees: 0 = straight in front (where the learner sits), 90 = from its right. */
  azimuth?: number;
  /** Camera height angle in degrees: 0 = level with the lesson, 90 = straight above. */
  elevation?: number;
  /** 'model' frames the 3D content (panels may be cut off); 'all' frames panels too. */
  subject?: 'model' | 'all';
  /** Background color (the room is not drawn). */
  background?: string;
  /** Above 1 moves the camera closer (the edges of the lesson may be cut off). */
  zoom?: number;
  /** JPEG quality 0..1. */
  quality?: number;
};

const FOV_DEG = 32;

/**
 * Grow `box` by a mesh as it is now. An instanced mesh keeps the bounds of the first time it was measured,
 * and lessons move instances every frame (flow beads, sparks), so its bounds are taken afresh; one whose
 * instances have not been placed yet (all at the origin, full size) is left out.
 */
export function expandByMesh(box: Box3, object: Object3D) {
  const instanced = object as Object3D & { isInstancedMesh?: boolean; count?: number; instanceMatrix?: { array: ArrayLike<number> }; computeBoundingBox?: () => void };
  if (instanced.isInstancedMesh && instanced.instanceMatrix) {
    const m = instanced.instanceMatrix.array;
    let placed = false;
    // An unplaced instance still has the identity matrix (1 on the diagonal: every fifth entry of its 16).
    for (let i = 0; i < (instanced.count ?? 0) * 16 && !placed; i++) placed = m[i] !== ((i % 16) % 5 === 0 ? 1 : 0);
    if (!placed) return;
    instanced.computeBoundingBox?.();
  }
  box.expandByObject(object, false);
}

export function captureLesson(world: World, root: Object3D, panelHolders: Set<Object3D>, options: CaptureOptions = {}): string | null {
  const width = Math.round(options.width ?? 1280);
  const height = Math.round(options.height ?? 960);
  const renderer = world.renderer;
  const scene = world.scene;
  root.updateWorldMatrix(true, true);

  // What to frame: the lesson's 3D content, or everything including its panels.
  const box = new Box3();
  const visit = (object: Object3D) => {
    if (!object.visible) return;
    if (options.subject !== 'all' && panelHolders.has(object)) return;
    const kind = object as { isMesh?: boolean; isPoints?: boolean; isSprite?: boolean; name?: string };
    // Shadows, glows and particle clouds are dressing: they shouldn't push the camera back.
    if (kind.isMesh && object.name !== 'contact shadow') expandByMesh(box, object);
    for (const child of object.children) visit(child);
  };
  visit(root);
  if (box.isEmpty()) box.setFromObject(root);
  if (box.isEmpty()) return null;
  const sphere = box.getBoundingSphere(new Sphere());

  // The lesson's front faces +Z of its anchor (root's parent); the camera circles it in that frame.
  const frame = root.parent ?? root;
  const azimuth = ((options.azimuth ?? 28) * Math.PI) / 180;
  const elevation = ((options.elevation ?? 22) * Math.PI) / 180;
  const direction = new Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation))
    .transformDirection(frame.matrixWorld);
  const camera = new PerspectiveCamera(FOV_DEG, width / height, 0.005, 50);
  const halfFov = (Math.min(FOV_DEG, FOV_DEG * (width / height)) * Math.PI) / 360;
  camera.position.copy(sphere.center).addScaledVector(direction, ((sphere.radius / Math.sin(halfFov)) * 1.04) / (options.zoom ?? 1));
  camera.up.set(0, 1, 0);
  camera.lookAt(sphere.center);
  camera.updateMatrixWorld(true);

  // Draw the lesson only: hide everything else that would show (the room stand-ins, other panels).
  const lesson = new Set<Object3D>();
  root.traverse((o) => lesson.add(o));
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    const kind = o as { isMesh?: boolean; isPoints?: boolean; isSprite?: boolean; isLine?: boolean };
    if ((kind.isMesh || kind.isPoints || kind.isSprite || kind.isLine) && o.visible && !lesson.has(o)) {
      o.visible = false;
      hidden.push(o);
    }
  });

  const float = renderer.extensions.has('EXT_color_buffer_float');
  const target = new WebGLRenderTarget(width, height, { samples: 4, type: float ? FloatType : UnsignedByteType });
  const previousTarget = renderer.getRenderTarget();
  const previousXr = renderer.xr.enabled;
  const previousClear = renderer.getClearColor(new Color());
  const previousAlpha = renderer.getClearAlpha();
  const previousBackground = scene.background;
  let pixels: Float32Array | Uint8Array;
  try {
    renderer.xr.enabled = false; // our camera, not the headset's
    scene.background = null;
    renderer.setClearColor(0x000000, 0); // in an AR session three clears to transparent anyway; the background is added below
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    pixels = float ? new Float32Array(width * height * 4) : new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = previousXr;
    renderer.setClearColor(previousClear, previousAlpha);
    scene.background = previousBackground;
    for (const o of hidden) o.visible = true;
    target.dispose();
  }

  // The off-screen frame is linear light: apply the scene's exposure, the ACES filmic curve (the same fit
  // three.js uses on screen) and sRGB, then lay it over the background.
  const exposure = (renderer.toneMappingExposure ?? 1) / 0.6;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(width, height);
  const scale = (float ? 1 : 1 / 255) * exposure;
  const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
  const srgb = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  };
  const back = new Color(options.background ?? '#8b9099'); // components in linear light
  const backRgb = [srgb(back.r), srgb(back.g), srgb(back.b)];
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * width * 4; // WebGL rows run bottom to top
    const to = y * width * 4;
    for (let x = 0; x < width * 4; x += 4) {
      const r = pixels[from + x] * scale;
      const g = pixels[from + x + 1] * scale;
      const b = pixels[from + x + 2] * scale;
      const alpha = Math.min(1, Math.max(0, pixels[from + x + 3] * (float ? 1 : 1 / 255)));
      // RRT and ODT fit, between the ACES input and output matrices.
      const r1 = fit(0.59719 * r + 0.35458 * g + 0.04823 * b);
      const g1 = fit(0.076 * r + 0.90834 * g + 0.01566 * b);
      const b1 = fit(0.0284 * r + 0.13383 * g + 0.83777 * b);
      image.data[to + x] = srgb(1.60475 * r1 - 0.53108 * g1 - 0.07367 * b1) + backRgb[0] * (1 - alpha);
      image.data[to + x + 1] = srgb(-0.10208 * r1 + 1.10813 * g1 - 0.00605 * b1) + backRgb[1] * (1 - alpha);
      image.data[to + x + 2] = srgb(-0.00327 * r1 - 0.07276 * g1 + 1.07602 * b1) + backRgb[2] * (1 - alpha);
      image.data[to + x + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/jpeg', options.quality ?? 0.9);
}

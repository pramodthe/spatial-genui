// Runs in headless Chromium (bundled by render.ts): turns a P1 Three.js module into a GLB, and renders
// any GLB from four fixed angles with the same lights, so every pipeline is judged on equal terms.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const VIEW_PX = 512;
// Azimuth 0 looks at the model's front (+Z, the glTF convention); elevations in degrees.
const VIEWS = [
  { label: 'front', az: 0, el: 10 },
  { label: 'side', az: 90, el: 10 },
  { label: 'back', az: 180, el: 10 },
  { label: 'above', az: 40, el: 40 },
];
// Names exporters and primitive helpers make up on their own; a part only counts as named if it isn't one.
const AUTO_NAME = /^(mesh|object|node|group|scene|root|gltf|cube|sphere|uvsphere|icosphere|cylinder|cone|torus|plane|circle|primitive|geometry|untitled|mat|material)?[\s._-]*\d*([._]\d+)*$/i;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(VIEW_PX, VIEW_PX);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc8cdd4);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(1, 2, 1.5);
scene.add(key);
const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 100);

function toBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** P1: run an (already validated) module and export its root as GLB. */
async function exportModule(code: string): Promise<{ glb?: string; error?: string }> {
  try {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const mod = await import(/* @vite-ignore */ url);
    URL.revokeObjectURL(url);
    const api = { THREE, traits: (o: unknown) => o, ui: () => ({ object3D: new THREE.Group(), on() {}, set() {} }), isGrabbed: () => false };
    const { root } = mod.default(api);
    root.updateMatrixWorld(true);
    const glb = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
    return { glb: toBase64(glb) };
  } catch (err) {
    return { error: `Export failed: ${(err as Error).message}` };
  }
}

type Stats = {
  triangles: number;
  drawCalls: number;
  meshes: number;
  materials: number;
  /** Bounding-box size in metres. */
  size: [number, number, number];
  /** Every node name in the file, in tree order. */
  nodeNames: string[];
  /** Distinct names that aren't made-up defaults, i.e. parts an app can label, highlight or grab. */
  namedParts: string[];
};

function measure(root: THREE.Object3D): Stats {
  let triangles = 0;
  let drawCalls = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();
  const nodeNames: string[] = [];
  root.traverse((o: any) => {
    if (o !== root) nodeNames.push(o.name ?? '');
    if (!o.isMesh) return;
    meshes++;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m: THREE.Material) => materials.add(m));
    const geometry = o.geometry as THREE.BufferGeometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    triangles += Math.floor(count / 3) * (o.isInstancedMesh ? o.count : 1);
    drawCalls += Math.max(1, geometry.groups.length);
  });
  // A single wrapper node around the whole model (CadQuery's assembly, an empty P1 root) isn't a part.
  const wrapper = root.children.length === 1 && root.children[0].children.length > 0 ? root.children[0].name : null;
  if (wrapper !== null) nodeNames.splice(nodeNames.indexOf(wrapper), 1);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  // Loaders add _1, _2... when one named part has several meshes; that's still one part.
  const names = new Set(nodeNames.filter((n) => n && !AUTO_NAME.test(n.trim())));
  const namedParts = [...names].filter((n) => !(/^(.*)_\d+$/.test(n) && names.has(n.replace(/_\d+$/, ''))));
  return {
    triangles, drawCalls, meshes, materials: materials.size,
    size: [size.x, size.y, size.z].map((v) => Math.round(v * 1000) / 1000) as Stats['size'],
    nodeNames, namedParts,
  };
}

/** Render a GLB from four angles into a labelled 2x2 grid (JPEG data URL) and measure it. */
async function renderGlb(b64: string): Promise<{ grid?: string; hero?: string; stats?: Stats; error?: string }> {
  let model: THREE.Object3D | undefined;
  try {
    const gltf = await new GLTFLoader().parseAsync(fromBase64(b64), '');
    model = gltf.scene;
    scene.add(model);
    model.updateMatrixWorld(true);
    const stats = measure(model);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return { error: 'The model is empty (no visible geometry).', stats };
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();

    const grid = document.createElement('canvas');
    grid.width = grid.height = VIEW_PX * 2;
    const ctx = grid.getContext('2d')!;
    let hero = '';
    VIEWS.forEach((v, i) => {
      const az = THREE.MathUtils.degToRad(v.az);
      const el = THREE.MathUtils.degToRad(v.el);
      camera.position.set(
        center.x + distance * Math.cos(el) * Math.sin(az),
        center.y + distance * Math.sin(el),
        center.z + distance * Math.cos(el) * Math.cos(az),
      );
      camera.lookAt(center);
      renderer.render(scene, camera);
      const x = (i % 2) * VIEW_PX;
      const y = Math.floor(i / 2) * VIEW_PX;
      ctx.drawImage(renderer.domElement, x, y);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + 8, y + 8, 76, 26);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.fillText(v.label, x + 16, y + 27);
      if (v.label === 'above') hero = renderer.domElement.toDataURL('image/jpeg', 0.85);
    });
    ctx.strokeStyle = '#8a9099';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(VIEW_PX, 0); ctx.lineTo(VIEW_PX, VIEW_PX * 2);
    ctx.moveTo(0, VIEW_PX); ctx.lineTo(VIEW_PX * 2, VIEW_PX);
    ctx.stroke();
    return { grid: grid.toDataURL('image/jpeg', 0.85), hero, stats };
  } catch (err) {
    return { error: `Could not load the GLB: ${(err as Error).message}` };
  } finally {
    if (model) {
      scene.remove(model);
      model.traverse((o: any) => {
        o.geometry?.dispose();
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
      });
    }
  }
}

/**
 * Part segmentation (M5): render a GLB from the given angles at `px` square, framed like renderGlb.
 * mode 'color': lit, as made (PNG data URLs, for SAM 3.1). mode 'id': unlit vertex colours read back
 * exactly from an offscreen buffer (no tone mapping, colour conversion or antialiasing), for a model
 * whose vertex colours encode face numbers; black is background.
 */
async function renderViews(b64: string, views: { az: number; el: number }[], px: number, mode: 'color' | 'id'): Promise<{ images?: string[]; error?: string }> {
  let model: THREE.Object3D | undefined;
  const saved = { toneMapping: renderer.toneMapping, colorSpace: renderer.outputColorSpace, background: scene.background, environment: scene.environment };
  const target = new THREE.WebGLRenderTarget(px, px, { samples: 0, colorSpace: THREE.NoColorSpace });
  try {
    const gltf = await new GLTFLoader().parseAsync(fromBase64(b64), '');
    model = gltf.scene;
    if (mode === 'id') {
      model.traverse((o: any) => {
        if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      });
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      scene.background = new THREE.Color(0, 0, 0);
      scene.environment = null;
    }
    scene.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return { error: 'The model is empty (no visible geometry).' };
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    const pixels = new Uint8Array(px * px * 4);
    const images: string[] = [];
    for (const v of views) {
      const az = THREE.MathUtils.degToRad(v.az);
      const el = THREE.MathUtils.degToRad(v.el);
      camera.position.set(center.x + distance * Math.cos(el) * Math.sin(az), center.y + distance * Math.sin(el), center.z + distance * Math.cos(el) * Math.cos(az));
      camera.lookAt(center);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, px, px, pixels);
      renderer.setRenderTarget(null);
      // WebGL rows run bottom-up; images run top-down.
      const image = ctx.createImageData(px, px);
      for (let row = 0; row < px; row++) image.data.set(pixels.subarray((px - 1 - row) * px * 4, (px - row) * px * 4), row * px * 4);
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      ctx.putImageData(image, 0, 0);
      images.push(canvas.toDataURL('image/png'));
    }
    return { images };
  } catch (err) {
    return { error: `Could not render the GLB: ${(err as Error).message}` };
  } finally {
    target.dispose();
    renderer.toneMapping = saved.toneMapping;
    renderer.outputColorSpace = saved.colorSpace;
    scene.background = saved.background;
    scene.environment = saved.environment;
    if (model) {
      scene.remove(model);
      model.traverse((o: any) => {
        o.geometry?.dispose();
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
      });
    }
  }
}

Object.assign(window, { exportModule, renderGlb, renderViews });

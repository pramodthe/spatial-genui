import {
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { COLORS } from './brand';

/**
 * Muse in 3D: the mascot's own design (mascot.ts) as a small soft vinyl toy, for the headset dashboard and the start
 * page. A white gumdrop body with big glossy eyes, a smile and stubby arms. Its shading is a matcap (a lit sphere
 * drawn once on a canvas: a key light from the upper left, a cool shade, a glossy highlight and a rim of light), so
 * Muse looks round and the same under any scene light, with no outline; a soft shadow sits under it. One unit tall,
 * standing on its origin, facing +Z.
 *
 * It watches a point (the player's head, or the pointer), blinks, breathes, waves when asked, bobs and looks up
 * while a game is being made, and hops with an open mouth when one is ready.
 */

export type MuseMood = 'idle' | 'thinking' | 'cheer';

/**
 * Muse's spoken hello, "Hi! I'm Muse! What do you wonder about?": a clip made once with the voice tutor's voice
 * (Deepgram Aura, aura-2-asteria-en), played by both hellos (muse-intro.ts and the room view's dashboard).
 */
export const MUSE_HELLO_CLIP = `${import.meta.env.BASE_URL}audio/muse-hello.mp3`;

export type Muse3D = {
  object: Group;
  /** Advance by `dt` seconds; `look` is a world point the eyes follow (none: straight ahead). */
  update(dt: number, mood: MuseMood, look?: Vector3): void;
  wave(): void;
};

/**
 * A matcap: how a sphere of this surface looks, lit from the upper left. `base` is the lit colour, `shade` the cool
 * colour it turns away from the light, `gloss` how strong the highlight is. Drawn once per surface, shared.
 */
function matcap(base: string, shade: string, gloss: number, rim: string): Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const c = size / 2;
  // The body of the light: bright toward the upper left, into the shade at the lower right.
  const body = g.createRadialGradient(c * 0.72, c * 0.62, size * 0.02, c, c, c);
  body.addColorStop(0, base);
  body.addColorStop(0.55, base);
  body.addColorStop(1, shade);
  g.fillStyle = body;
  g.fillRect(0, 0, size, size);
  // A rim of reflected light along the lower right edge, so the silhouette reads round.
  const edge = g.createRadialGradient(c * 1.18, c * 1.22, c * 0.6, c, c, c);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(0.85, 'rgba(0,0,0,0)');
  edge.addColorStop(1, rim);
  g.fillStyle = edge;
  g.fillRect(0, 0, size, size);
  // The glossy highlight: a soft spot up and to the left.
  const spot = g.createRadialGradient(c * 0.66, c * 0.52, 0, c * 0.66, c * 0.52, size * 0.2);
  spot.addColorStop(0, `rgba(255,255,255,${gloss})`);
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spot;
  g.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

let surfaces: { vinyl: Texture; gloss: Texture; white: Texture } | null = null;
/** The three surfaces Muse is made of (drawn the first time a Muse is made). */
function toy() {
  surfaces ??= {
    vinyl: matcap('#ffffff', '#b9cde3', 0.85, 'rgba(225,240,255,0.9)'),
    gloss: matcap('#3a2f63', COLORS.ink, 0.95, 'rgba(120,110,170,0.6)'),
    white: matcap('#ffffff', '#d7e2ee', 0.9, 'rgba(235,245,255,0.8)'),
  };
  return surfaces;
}

const lit = (surface: Texture) => new MeshMatcapMaterial({ matcap: surface, toneMapped: false });

/** A part of the vinyl body. */
function part(geometry: BufferGeometry): Mesh {
  return new Mesh(geometry, lit(toy().vinyl));
}

/** A soft round shadow on the ground under Muse. */
function groundShadow(): Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const fade = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  fade.addColorStop(0, 'rgba(18,6,59,0.32)');
  fade.addColorStop(0.6, 'rgba(18,6,59,0.14)');
  fade.addColorStop(1, 'rgba(18,6,59,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, size, size);
  const shadow = new Mesh(new PlaneGeometry(1.15, 0.8), new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  shadow.renderOrder = -1;
  return shadow;
}

const flat = (colour: string, opacity = 1) =>
  new MeshBasicMaterial({ color: colour, toneMapped: false, side: DoubleSide, transparent: opacity < 1, opacity });

export function createMuse3D(): Muse3D {
  const object = new Group();
  object.name = 'Muse';
  // Everything that hops and bobs; the root stays where it was put.
  const body = new Group();
  object.add(body);

  // The body: a gumdrop, a little deeper than half its width.
  const profile: Vector2[] = [new Vector2(0, 0)];
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); profile.push(new Vector2(0.4 + Math.sin(a) * 0.08, 0.08 - Math.cos(a) * 0.08)); }
  for (let i = 1; i <= 4; i++) profile.push(new Vector2(0.48 - i * 0.003, 0.08 + i * 0.105));
  for (let i = 1; i <= 14; i++) { const a = (i / 14) * (Math.PI / 2); profile.push(new Vector2(Math.max(0.0001, 0.468 * Math.cos(a)), 0.5 + 0.47 * Math.sin(a))); }
  // The lathe's own normals are smooth across the seam where it closes; turned, the seam is at the back.
  const shell = new LatheGeometry(profile, 56);
  shell.rotateY(Math.PI);
  const trunk = part(shell);
  trunk.scale.set(1, 1, 0.82);
  body.add(trunk);
  // The shadow stays on the ground while the body hops.
  object.add(groundShadow());

  // Eyes: two domes seated on the body and turned with its curve, an ink one with a smaller white one in front,
  // so an ink ring always frames the white (an outline drawn round one dome fell behind the curve of the white
  // body), and pupils that look about.
  const eyes = new Group();
  eyes.position.set(0, 0.58, 0);
  body.add(eyes);
  const pupils: Group[] = [];
  for (const x of [-0.16, 0.16]) {
    const eye = new Group();
    // On the surface: the body is 0.463 round at this height and 0.82 as deep as it is wide.
    eye.position.set(x, 0, 0.82 * Math.sqrt(0.463 ** 2 - x ** 2) + 0.012);
    eye.rotation.y = Math.sign(x) * 0.32;
    const dome = new SphereGeometry(1, 32, 20);
    const ring = new Mesh(dome, lit(toy().gloss));
    ring.scale.set(0.126, 0.151, 0.034);
    eye.add(ring);
    const sclera = new SphereGeometry(1, 32, 20);
    const white = new Mesh(sclera, lit(toy().white));
    white.scale.set(0.111, 0.136, 0.042);
    eye.add(white);
    const pupil = new Group();
    pupil.position.z = 0.038;
    const dot = new Mesh(new SphereGeometry(0.055, 20, 14), lit(toy().gloss));
    dot.scale.z = 0.4;
    pupil.add(dot);
    const glint = new Mesh(new SphereGeometry(0.018, 12, 8), flat(COLORS.paper));
    glint.position.set(0.02, 0.025, 0.02);
    pupil.add(glint);
    eye.add(pupil);
    pupils.push(pupil);
    eyes.add(eye);
  }

  // The mouth: a smile, or open and happy.
  const smile = new Mesh(new TorusGeometry(0.065, 0.014, 8, 24, Math.PI), flat(COLORS.ink));
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.385, 0.388);
  body.add(smile);
  const open = new Mesh(new CircleGeometry(0.07, 24, Math.PI, Math.PI), flat(COLORS.ink));
  open.position.set(0, 0.39, 0.395);
  open.visible = false;
  body.add(open);

  // Arms: stubby capsules from the sides; the one on the player's left waves.
  const arm = (side: -1 | 1) => {
    const shoulder = new Group();
    shoulder.position.set(side * 0.43, 0.36, 0.05);
    const limb = part(new CapsuleGeometry(0.055, 0.1, 6, 16));
    limb.position.set(side * 0.06, -0.06, 0);
    limb.rotation.z = side * 0.75;
    shoulder.add(limb);
    body.add(shoulder);
    return shoulder;
  };
  const waving = arm(-1);
  arm(1);

  // The animation's state.
  let time = 0;
  let blinkAt = 2.5;
  let waveFor = 0;
  let hopFor = 0;
  let lastMood: MuseMood = 'idle';
  const local = new Vector3();
  const ahead = new Vector3();

  return {
    object,
    wave() {
      waveFor = 1.3;
    },
    update(dt, mood, look) {
      time += dt;
      if (mood === 'cheer' && lastMood !== 'cheer') hopFor = 1.5;
      lastMood = mood;
      waveFor = Math.max(0, waveFor - dt);
      hopFor = Math.max(0, hopFor - dt);

      // Breathing, bobbing while it thinks, hops when happy.
      const thinking = mood === 'thinking';
      const hop = hopFor > 0 ? Math.abs(Math.sin((1.5 - hopFor) * Math.PI * 2)) * 0.16 : 0;
      body.position.y = (thinking ? Math.sin(time * 2 * Math.PI) * 0.035 + 0.035 : 0) + hop;
      const breathe = 1 + Math.sin(time * Math.PI) * 0.012;
      body.scale.set(1 / Math.sqrt(breathe), breathe, 1 / Math.sqrt(breathe));
      // A slow sway while it thinks.
      body.rotation.z = thinking ? Math.sin(time * Math.PI) * 0.05 : 0;
      waving.rotation.z = waveFor > 0 ? -1.1 - Math.sin((1.3 - waveFor) * Math.PI * 6) * 0.45 : 0;

      // The eyes follow the point; while thinking they look up, one way then the other.
      if (thinking) ahead.set(Math.sin(time * 1.6) > 0 ? 0.7 : -0.7, 0.8, 1);
      else if (look) {
        local.copy(look);
        eyes.worldToLocal(local);
        ahead.set(local.x, local.y, Math.max(0.2, local.z)).normalize();
      } else ahead.set(0, 0, 1);
      for (const pupil of pupils) {
        pupil.position.x += (Math.max(-1, Math.min(1, ahead.x * 1.6)) * 0.045 - pupil.position.x) * Math.min(1, dt * 12);
        pupil.position.y += (Math.max(-1, Math.min(1, ahead.y * 1.6)) * 0.05 - pupil.position.y) * Math.min(1, dt * 12);
      }
      // A blink every few seconds.
      if (time > blinkAt + 0.14) blinkAt = time + 2.5 + Math.random() * 2.5;
      eyes.scale.y = time > blinkAt ? 0.12 : 1;

      const happy = hopFor > 0 || waveFor > 0;
      open.visible = happy;
      smile.visible = !happy;
    },
  };
}

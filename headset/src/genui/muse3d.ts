import {
  BackSide,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { COLORS } from './brand';

/**
 * Muse in 3D: the mascot's own design (mascot.ts) as a small toy, for the headset dashboard and the start page.
 * A white gumdrop body with big eyes, a smile and stubby arms, outlined in ink with a white rim, like the
 * stickers. Colours are flat with one baked shade (lit from the upper left), so Muse looks the same under any scene
 * light. One unit tall, standing on its origin, facing +Z.
 *
 * It watches a point (the player's head, or the pointer), blinks, breathes, waves when asked, bobs and looks up
 * while a game is being made, and hops with an open mouth when one is ready.
 */

export type MuseMood = 'idle' | 'thinking' | 'cheer';

export type Muse3D = {
  object: Group;
  /** Advance by `dt` seconds; `look` is a world point the eyes follow (none: straight ahead). */
  update(dt: number, mood: MuseMood, look?: Vector3): void;
  wave(): void;
};

const LIGHT = new Vector3(-0.5, 0.8, 0.6).normalize();
const OUTLINE = 0.03;
const RIM = 0.035;

/** A colour that turns to its shade (a colour, or how much darker) where the surface faces away from the light. */
function shaded(geometry: BufferGeometry, colour: string, shade: number | string = 0.78): MeshBasicMaterial {
  const base = new Color(colour);
  const dark = typeof shade === 'string' ? new Color(shade) : base.clone().multiplyScalar(shade);
  const normals = geometry.getAttribute('normal');
  const colours = new Float32Array(normals.count * 3);
  const n = new Vector3();
  const mixed = new Color();
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i);
    // A soft edge between the two tones: a hard one shows the mesh's triangles.
    const c = mixed.copy(base).lerp(dark, Math.min(1, Math.max(0, (0.05 - n.dot(LIGHT)) / 0.45)));
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new (normals.constructor as typeof import('three').BufferAttribute)(colours, 3));
  return new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
}

/** An outline: the same shape pushed out along its normals, drawn from the inside. */
function outline(geometry: BufferGeometry, width = OUTLINE, colour: string = COLORS.ink): Mesh {
  const hull = geometry.clone();
  hull.deleteAttribute('color');
  const position = hull.getAttribute('position');
  const normals = hull.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    position.setXYZ(i, position.getX(i) + normals.getX(i) * width, position.getY(i) + normals.getY(i) * width, position.getZ(i) + normals.getZ(i) * width);
  }
  return new Mesh(hull, new MeshBasicMaterial({ color: colour, side: BackSide, toneMapped: false }));
}

/**
 * A part in its colour with the ink outline; `rim` adds the white sticker edge outside the ink. The rims are drawn
 * before the rest and write no depth, so the body's and the arms' rims join into one edge around the whole of Muse.
 */
function part(geometry: BufferGeometry, colour: string, { shade, rim = false }: { shade?: number | string; rim?: boolean } = {}): Group {
  const group = new Group();
  group.add(new Mesh(geometry, shaded(geometry, colour, shade)));
  group.add(outline(geometry));
  if (rim) {
    const edge = outline(geometry, OUTLINE + RIM, COLORS.paper);
    (edge.material as MeshBasicMaterial).depthWrite = false;
    edge.renderOrder = -1;
    group.add(edge);
  }
  return group;
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
  const shell = new LatheGeometry(profile, 56);
  shell.computeVertexNormals();
  const trunk = part(shell, COLORS.muse, { shade: COLORS.museShade, rim: true });
  trunk.scale.set(1, 1, 0.82);
  body.add(trunk);

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
    const ring = new Mesh(dome, flat(COLORS.ink));
    ring.scale.set(0.126, 0.151, 0.034);
    eye.add(ring);
    const sclera = new SphereGeometry(1, 32, 20);
    const white = new Mesh(sclera, shaded(sclera, COLORS.paper, 0.92));
    white.scale.set(0.111, 0.136, 0.042);
    eye.add(white);
    const pupil = new Group();
    pupil.position.z = 0.038;
    const dot = new Mesh(new SphereGeometry(0.055, 20, 14), flat(COLORS.ink));
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
    const limb = part(new CapsuleGeometry(0.055, 0.1, 6, 16), COLORS.muse, { shade: COLORS.museShade, rim: true });
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

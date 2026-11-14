import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, type Object3D } from '@iwsdk/core';

/**
 * Hover glow: what a pinch will take lights up while a hand ray or a hand is over it, so a learner aiming at a
 * small part sees whether they are on it (Meta's Interaction SDK does the same for every interactable).
 *
 * The glow is a faint additive copy of the object's meshes, drawn over them while hovered. The copies live in a
 * group of their own outside the lesson and follow their meshes each frame: inside the lesson, even invisible
 * and left out of raycasts, extra meshes changed which part a hand's pointer took. They share the meshes'
 * geometry and leave their materials alone, so a lesson's own colours and the teaching rig's highlight are
 * untouched.
 */

// Big models get no glow rather than hundreds of extra meshes.
const MAX_GLOW_MESHES = 300;

export type Glow = { set(on: boolean): void; readonly on: boolean; dispose(): void };

let layer: Group | null = null;
const lit = new Set<{ pairs: [Mesh, Mesh][] }>();

/** Give `object` a glow, off until set(true). The copies are made the first time it lights up. */
export function createGlow(object: Object3D, scene: Object3D): Glow {
  const meshes: Mesh[] = [];
  object.traverse((o) => {
    const mesh = o as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if (mesh.isMesh && !mesh.isInstancedMesh && !mesh.isSkinnedMesh) meshes.push(mesh);
  });
  let on = false;
  const state = { pairs: [] as [Mesh, Mesh][] };
  if (meshes.length === 0 || meshes.length > MAX_GLOW_MESHES) return { set() {}, on: false, dispose() {} };
  let material: MeshBasicMaterial | null = null;
  return {
    get on() {
      return on;
    },
    set(next) {
      if (next === on) return;
      on = next;
      if (on && !material) {
        if (!layer) {
          layer = new Group();
          layer.name = 'Hover glow';
          scene.add(layer);
        }
        material = new MeshBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0.22,
          blending: AdditiveBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        for (const mesh of meshes) {
          const copy = new Mesh(mesh.geometry, material);
          copy.name = 'hover glow';
          copy.matrixAutoUpdate = false;
          copy.raycast = () => {};
          layer.add(copy);
          state.pairs.push([mesh, copy]);
        }
      }
      if (on) lit.add(state);
      else lit.delete(state);
      for (const [mesh, copy] of state.pairs) copy.visible = on && drawn(mesh);
      if (on) follow(state);
    },
    dispose() {
      lit.delete(state);
      for (const [, copy] of state.pairs) copy.removeFromParent();
      state.pairs.length = 0;
      material?.dispose();
    },
  };
}

/** Keep lit glows on their meshes (they move: grabbed, exploded, animated). Call once per frame. */
export function tickGlows() {
  for (const state of lit) follow(state);
}

function follow(state: { pairs: [Mesh, Mesh][] }) {
  for (const [mesh, copy] of state.pairs) {
    copy.visible = drawn(mesh);
    copy.matrix.copy(mesh.matrixWorld);
    copy.matrixWorldNeedsUpdate = true;
  }
}

function drawn(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Light up the hovered one of `glows` (keyed by target) while pointers are over `listener` or its children.
 * `resolve` maps the mesh a pointer is over to the target it belongs to (null: none).
 */
export function glowOnHover(listener: Object3D, resolve: (hit: Object3D) => Object3D | null, glows: Map<Object3D, Glow>) {
  const over = new Map<number, Object3D>(); // pointer -> target it is over
  const refresh = () => {
    const hovered = new Set(over.values());
    for (const [target, glow] of glows) glow.set(hovered.has(target));
  };
  const at = (event: { pointerId: number; object?: Object3D }) => {
    const target = event.object ? resolve(event.object) : null;
    if (target) over.set(event.pointerId, target);
    else over.delete(event.pointerId);
    refresh();
  };
  listener.addEventListener('pointerover', at);
  listener.addEventListener('pointermove', at);
  listener.addEventListener('pointerleave', (event: { pointerId: number }) => {
    over.delete(event.pointerId);
    refresh();
  });
}

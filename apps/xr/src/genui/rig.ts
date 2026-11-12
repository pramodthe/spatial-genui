import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Line,
  LineBasicMaterial,
  Matrix4,
  Plane,
  Quaternion,
  Vector3,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from '@iwsdk/core';

/**
 * Teaching rig for a library model: the tools lessons need (labels, explode, cut-away, X-ray,
 * highlight, reset), done by host code so the agent states intent instead of computing geometry.
 * Mirrored by the server's dry-run stand-in (apps/server/src/dryrun.ts), which applies the same
 * label panel checks.
 *
 * Labels follow SceneCraft's idea: the lesson names the parts, code places them. Labels sit in two
 * columns beside the model (left or right by which side the part is on), stacked without overlap,
 * each with a leader line to a point on the part's outside that follows the part as it moves.
 */

type UiHandle = { object3D: Object3D; set(id: string, props: { text?: string }): void };
type UiFn = (markup: string, options: { width?: number; position?: [number, number, number]; rotationY?: number }) => UiHandle;

export type RigPart = { id: string; name: string; object3D: Object3D; labelAnchor: Vector3; explodeDir: Vector3 };
export type LabelHandle = { object3D: Object3D; set(text: string): void; setVisible(visible: boolean): void };

const LABEL_WIDTH_M = 0.16; // panel width; 28px text in a 320px-wide panel reads at 1.4 cm
const LABEL_HEIGHT_M = 0.034; // one line of text plus padding
const LABEL_GAP_M = 0.008;
const SIDE_MARGIN_M = 0.03;
const EXPLODE_REACH = 0.35; // at explode(1) parts move this fraction of the model's largest size
const XRAY_OPACITY = 0.14;

const labelMarkup = (text: string) => `
  <style>
    .l { width: 320px; padding-left: 14px; padding-right: 14px; padding-top: 7px; padding-bottom: 7px;
         border-radius: 12px; background-color: #15181d; }
    .t { color: #ffffff; font-size: 28px; font-weight: 600; }
  </style>
  <div class="l"><span class="t" id="text">${text.replace(/[<>&]/g, ' ')}</span></div>`;

type Label = { part: RigPart; ui: UiHandle; line: Line; anchorLocal: Vector3; anchor: Vector3; y: number; side: number };

export class TeachingRig {
  private readonly home = new Map<Object3D, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>();
  private readonly materials = new Map<Mesh, { working: MeshStandardMaterial; opacity: number; transparent: boolean; depthWrite: boolean; emissive: number; emissiveIntensity: number }>();
  private readonly labels: Label[] = [];
  private readonly centerLocal = new Vector3();
  private readonly maxSize: number;
  private readonly plane = new Plane();
  private cut = false;
  // Scratch objects, so tick() and per-frame explode() allocate nothing.
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly q1 = new Quaternion();
  private readonly m1 = new Matrix4();
  private readonly box = new Box3();
  private readonly corners = Array.from({ length: 8 }, () => new Vector3());
  private readonly column: Label[] = [];

  constructor(
    private readonly model: Object3D,
    private readonly parts: RigPart[],
    private readonly ui: UiFn,
    private readonly isGrabbed: (object: Object3D) => boolean,
  ) {
    model.updateMatrixWorld(true);
    const bounds = new Box3();
    for (const part of parts) {
      const o = part.object3D;
      this.home.set(o, { position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() });
      bounds.expandByObject(o);
      // Each instance gets its own materials: the cached model's are shared between instances.
      o.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh || this.materials.has(mesh)) return;
        const working = (mesh.material as Material).clone() as MeshStandardMaterial;
        mesh.material = working;
        this.materials.set(mesh, {
          working, opacity: working.opacity, transparent: working.transparent, depthWrite: working.depthWrite,
          emissive: working.emissive?.getHex() ?? 0, emissiveIntensity: working.emissiveIntensity ?? 1,
        });
      });
    }
    // The model is at its own origin when loaded, so world bounds are model-local bounds.
    bounds.getCenter(this.centerLocal);
    const size = bounds.getSize(new Vector3());
    this.maxSize = Math.max(size.x, size.y, size.z, 0.01);
  }

  private find(id: string): RigPart {
    const part = this.parts.find((p) => p.id === id);
    if (!part) throw new Error(`This model has no part '${id}'. Parts: ${this.parts.map((p) => p.id).join(', ')}.`);
    return part;
  }

  /** Put a part at a model-local position, whatever it is parented to now (grabbed parts move to root). */
  private placePart(part: RigPart, modelLocal: Vector3) {
    const o = part.object3D;
    if (o.parent === this.model) {
      o.position.copy(modelLocal);
      return;
    }
    if (!o.parent) return;
    this.v3.copy(modelLocal);
    this.model.localToWorld(this.v3);
    o.position.copy(o.parent.worldToLocal(this.v3));
  }

  /** Label a part (default text: its anatomical name). Add the model to root first. */
  label(id: string, text?: string): LabelHandle {
    const parent = this.model.parent;
    if (!parent) throw new Error('Add the model to root (root.add(model.object3D)) before labelling it.');
    const part = this.find(id);
    const existing = this.labels.find((l) => l.part === part);
    if (existing) {
      if (text) existing.ui.set('text', { text });
      return this.labelHandle(existing);
    }
    const ui = this.ui(labelMarkup(text ?? part.name.charAt(0).toUpperCase() + part.name.slice(1)), { width: LABEL_WIDTH_M, position: [0, 0, 0] });
    parent.add(ui.object3D);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const line = new Line(geometry, new LineBasicMaterial({ color: 0xe6edf5 }));
    line.frustumCulled = false;
    // Decoration only: three.js counts a ray within 1 unit (a metre here) as hitting a line, so leader
    // lines would swallow hand rays meant for buttons, even while hidden.
    line.raycast = () => {};
    parent.add(line);
    // The anchor rides on the part, so the leader line follows it when the part moves.
    this.model.updateMatrixWorld(true);
    const anchorLocal = part.object3D.worldToLocal(this.model.localToWorld(part.labelAnchor.clone()));
    const label: Label = { part, ui, line, anchorLocal, anchor: new Vector3(), y: 0, side: 1 };
    this.labels.push(label);
    this.layoutLabels();
    return this.labelHandle(label);
  }

  /** Label several parts at once; returns their handles in the same order. */
  labelParts(ids: string[]): LabelHandle[] {
    return ids.map((id) => this.label(id));
  }

  private labelHandle(label: Label): LabelHandle {
    return {
      object3D: label.ui.object3D,
      set: (text: string) => label.ui.set('text', { text }),
      setVisible: (visible: boolean) => {
        // Hidden is not enough: a hidden panel can still be hit by a hand ray, and lessons that make
        // a label for every part and show a few at a time would bury their buttons. Collapse it too.
        label.ui.object3D.visible = visible;
        label.ui.object3D.scale.setScalar(visible ? 1 : 1e-4);
        label.line.visible = visible;
      },
    };
  }

  /** Two columns beside the model, stacked top to bottom in the order of the parts' heights. */
  private layoutLabels() {
    const parent = this.model.parent;
    if (!parent || this.labels.length === 0) return;
    parent.updateMatrixWorld(true);
    // Model bounds in the parent's frame (the parent may sit anywhere in the world after mounting).
    this.box.makeEmpty();
    for (const part of this.parts) this.box.expandByObject(part.object3D);
    const { min, max } = this.box;
    const c = this.corners;
    c[0].set(min.x, min.y, min.z); c[1].set(max.x, min.y, min.z); c[2].set(min.x, max.y, min.z); c[3].set(max.x, max.y, min.z);
    c[4].set(min.x, min.y, max.z); c[5].set(max.x, min.y, max.z); c[6].set(min.x, max.y, max.z); c[7].set(max.x, max.y, max.z);
    this.box.makeEmpty();
    for (const corner of c) this.box.expandByPoint(parent.worldToLocal(corner));
    const centerX = (this.box.min.x + this.box.max.x) / 2;
    const frontZ = this.box.max.z;

    for (const label of this.labels) {
      label.anchor.copy(label.anchorLocal);
      parent.worldToLocal(label.part.object3D.localToWorld(label.anchor));
      label.side = label.anchor.x < centerX ? -1 : 1;
    }
    const step = LABEL_HEIGHT_M + LABEL_GAP_M;
    for (const side of [-1, 1]) {
      // Reused array: explode() runs this every frame while animating.
      const column = this.column;
      column.length = 0;
      for (const label of this.labels) if (label.side === side) column.push(label);
      column.sort((a, b) => b.anchor.y - a.anchor.y);
      // Top to bottom: each label at its part's height, pushed down only as far as needed to clear the one above.
      let shift = 0;
      for (let i = 0; i < column.length; i++) {
        column[i].y = i === 0 ? column[i].anchor.y : Math.min(column[i].anchor.y, column[i - 1].y - step);
        shift += column[i].anchor.y - column[i].y;
      }
      // Re-centre the column on the parts' heights so it doesn't drift below the model, but never
      // above the model's top: lessons put their panels above the model.
      shift = column.length ? shift / column.length : 0;
      if (column.length) shift = Math.min(shift, this.box.max.y - LABEL_HEIGHT_M / 2 - column[0].y);
      const x = side < 0 ? this.box.min.x - SIDE_MARGIN_M - LABEL_WIDTH_M / 2 : this.box.max.x + SIDE_MARGIN_M + LABEL_WIDTH_M / 2;
      // One depth for the whole column: stacked by height at different depths, labels collide on
      // screen when seen from above (a seated user looks down at the desk).
      const z = (this.box.min.z + frontZ) / 2 + 0.02;
      for (const label of column) label.ui.object3D.position.set(x, label.y + shift, z);
    }
    this.updateLines();
  }

  /** Leader lines from each label's inner edge to its anchor on the part. */
  private updateLines() {
    const parent = this.model.parent;
    if (!parent) return;
    for (const label of this.labels) {
      const holder = label.ui.object3D;
      const positions = label.line.geometry.getAttribute('position') as BufferAttribute;
      // Lines live in the label holder's parent frame (root), like the holders themselves.
      const frame = holder.parent ?? parent;
      this.v1.copy(holder.position);
      this.v1.x -= label.side * (LABEL_WIDTH_M / 2);
      this.v2.copy(label.anchorLocal);
      label.part.object3D.localToWorld(this.v2);
      frame.worldToLocal(this.v2);
      positions.setXYZ(0, this.v1.x, this.v1.y, this.v1.z);
      positions.setXYZ(1, this.v2.x, this.v2.y, this.v2.z);
      positions.needsUpdate = true;
      if (label.line.parent !== frame) frame.add(label.line);
    }
  }

  /** 0 = assembled, 1 = fully apart. Call it every frame from update() to animate. */
  explode(amount: number) {
    const t = Math.min(1, Math.max(0, Number(amount) || 0));
    for (const part of this.parts) {
      if (this.isGrabbed(part.object3D)) continue;
      const home = this.home.get(part.object3D)!;
      this.v1.copy(part.explodeDir).multiplyScalar(t * EXPLODE_REACH * this.maxSize).add(home.position);
      this.placePart(part, this.v1);
    }
    this.layoutLabels();
  }

  /** Slice away the half of the model facing the user to show the inside; cutaway(false) closes it. */
  cutaway(on = true) {
    this.cut = Boolean(on);
    for (const { working } of this.materials.values()) {
      working.clippingPlanes = this.cut ? [this.plane] : null;
      working.side = this.cut ? DoubleSide : FrontSide; // see the inner walls through the cut
      working.needsUpdate = true;
    }
    this.tick();
  }

  /** Everything see-through except the parts listed; xray(false) makes it solid again. */
  xray(on = true, keep: string[] = []) {
    const keepSet = new Set(keep.map((id) => this.find(id).object3D));
    for (const part of this.parts) {
      const see = Boolean(on) && !keepSet.has(part.object3D);
      part.object3D.traverse((child) => {
        const entry = this.materials.get(child as Mesh);
        if (!entry) return;
        entry.working.transparent = see || entry.transparent;
        entry.working.opacity = see ? XRAY_OPACITY : entry.opacity;
        entry.working.depthWrite = see ? false : entry.depthWrite;
        entry.working.needsUpdate = true;
      });
    }
  }

  /** Make one part glow; highlight(null) clears it. */
  highlight(id: string | null) {
    const target = id ? this.find(id).object3D : null;
    for (const part of this.parts) {
      const on = part.object3D === target;
      part.object3D.traverse((child) => {
        const entry = this.materials.get(child as Mesh);
        if (!entry?.working.emissive) return;
        if (on) entry.working.emissive.copy(entry.working.color).multiplyScalar(0.55);
        else entry.working.emissive.setHex(entry.emissive);
        entry.working.emissiveIntensity = on ? 1 : entry.emissiveIntensity;
      });
    }
  }

  /** Back to the assembled, solid model, with pulled-out parts returned to their places. */
  reset() {
    this.cutaway(false);
    this.xray(false);
    this.highlight(null);
    for (const part of this.parts) {
      if (this.isGrabbed(part.object3D)) continue;
      const home = this.home.get(part.object3D)!;
      this.placePart(part, home.position);
      const o = part.object3D;
      if (o.parent === this.model) {
        o.quaternion.copy(home.quaternion);
      } else if (o.parent) {
        this.model.getWorldQuaternion(this.q1).multiply(home.quaternion);
        o.quaternion.copy(o.parent.getWorldQuaternion(new Quaternion()).invert().multiply(this.q1));
      }
      o.scale.copy(home.scale);
    }
    this.layoutLabels();
  }

  /** The model's parts (not its labels), so the host can keep panels from covering it. */
  partObjects(): Object3D[] {
    return this.parts.map((p) => p.object3D);
  }

  /** The label panels, so the host can keep the lesson's own panels off them. */
  labelHolders(): Object3D[] {
    return this.labels.map((l) => l.ui.object3D);
  }

  /** Per frame: the cut follows the model as it turns, leader lines follow parts moved by hand. */
  tick() {
    if (this.cut) {
      this.model.updateMatrixWorld();
      this.v1.set(0, 0, -1).transformDirection(this.m1.copy(this.model.matrixWorld));
      this.v2.copy(this.centerLocal);
      this.model.localToWorld(this.v2);
      this.plane.setFromNormalAndCoplanarPoint(this.v1, this.v2);
    }
    if (this.labels.length) this.updateLines();
  }
}

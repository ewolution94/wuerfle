// The dice table: five cobalt glass dice in a tray on the night block, drawn with three.js and
// thrown with cannon-es (the look the user chose on 2026-10-19: B's glass and colours, A's block;
// development/plans/wuerfle/dice.html is the sketch this grew from).
//
// Every throw is played through before it's shown. When the dice leave a hand (a flick, a shake, the
// button, or another player's throw replayed from where their dice left their hand), the physics runs
// to the end at once, a few milliseconds of work, and its frames are recorded; then the recording
// plays. That way the page knows which face of each die will land on top before anyone sees it, and
// it can relabel the faces (swap two pairs of opposite faces) so the die lands on the number the
// server rolled. Each die keeps its own labels, so opposite faces still add up to seven.
//
// The table never decides a number. It tells the page where the dice left the hand (`onthrow`, the
// "fling" the server passes on to the other pages) and takes the numbers when they come (`resolve`
// for this page's throw, `replay` for anyone else's).

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export interface DieFling {
  /** Position, turn (a quaternion), velocity and spin as the die left the hand. */
  p: number[];
  q: number[];
  v: number[];
  w: number[];
}
export interface Fling {
  dice: DieFling[];
}
export interface Throw {
  n: number;
  seat: number;
  roll: number;
  dice: number[];
  held: boolean[];
  fling: Fling | null;
}

export interface DiceTableOptions {
  canvas: HTMLCanvasElement;
  /** A person's throw has left the hand: send it (the numbers come back through `resolve`). */
  onthrow: (fling: Fling | null) => void;
  /** A tap on a die. */
  onkeep: (i: number) => void;
  /** A tap on the table while nothing may be done there. */
  onrefuse?: () => void;
  /** Two things touched, this hard (for the sound). */
  onclack?: (strength: number) => void;
  /** The dice have come to rest after a throw. */
  onrest?: () => void;
}

/** BoxGeometry's faces, in its material order: +x, −x, +y, −y, +z, −z. Opposite faces are k and k ^ 1. */
const NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;
/** A fresh die's labels: 1 on top, opposite faces adding up to seven. */
const LABELS = [3, 4, 1, 6, 2, 5];
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.26], [0.72, 0.26], [0.28, 0.5], [0.72, 0.5], [0.28, 0.74], [0.72, 0.74]],
};

const STEP = 1 / 120;
/**
 * A throw is over once every die has been nearly still for a tenth of a second, and never later than
 * 3.2 s; then any die still leaning or lying on another is laid flat, on a free spot, in 0.15 s.
 * Measured on 400 throws (2026-10-19): settled at 1.6 s on the median, 2.2 s at the 90th percentile.
 */
const MAX_STEPS = Math.round(3.2 * 120);
const CALM_STEPS = 12;
const STILL = 1;
const LAY_STEPS = 18;
const HAND_Y = 2.4;
/** Where in the hand each of n dice sits (x, y, z around the finger). */
const CLUMP: Record<number, [number, number, number][]> = {
  1: [[0, 0, 0]],
  2: [[-0.62, 0, 0], [0.62, 0.1, 0]],
  3: [[-0.66, 0, -0.38], [0.66, 0.12, -0.38], [0, 0.25, 0.6]],
  4: [[-0.64, 0, -0.64], [0.64, 0.12, -0.64], [-0.64, 0.2, 0.64], [0.64, 0.05, 0.64]],
  5: [[-0.66, 0, -0.66], [0.66, 0.12, -0.66], [-0.66, 0.2, 0.66], [0.66, 0.05, 0.66], [0, 1.02, 0]],
};

/** 'row': a free die lined up on the rail's row while the table is folded (`fold`), without a ring. */
type Where = 'floor' | 'hand' | 'rail' | 'row' | 'tween' | 'flight';

interface Recording {
  idx: number[];
  /** Per step, per thrown die: x y z qx qy qz qw. */
  frames: Float32Array;
  steps: number;
  clacks: [number, number][];
  /** The face index that ends on top, per thrown die. */
  up: number[];
}

interface Flight {
  rec: Recording;
  t0: number;
  clack: number;
  /** This page's own throw, still waiting for the server's numbers. */
  waiting: boolean;
}

interface Tween {
  i: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  q0: THREE.Quaternion;
  q1: THREE.Quaternion;
  t0: number;
  dur: number;
  arc: number;
  done?: () => void;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** mulberry32: the same default throw on every page for the same throw number. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DiceTable {
  /** What the table may do now: throw the free dice, and keep (tap) them. */
  allow = { throw: false, keep: false };

  #o: DiceTableOptions;
  #renderer: THREE.WebGLRenderer | null = null;
  #scene = new THREE.Scene();
  #camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  #world = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
  #walls: Record<'left' | 'right' | 'back' | 'front', CANNON.Body>;
  #meshes: THREE.Mesh[] = [];
  #bodies: CANNON.Body[] = [];
  #rings: THREE.Mesh[] = [];
  #rail: THREE.Mesh;
  #materials: THREE.Material[] = [];
  /** Per die: the number on each of its six faces. */
  #labels: number[][] = [];
  #where: Where[] = ['floor', 'floor', 'floor', 'floor', 'floor'];
  #values = [1, 1, 1, 1, 1];
  /** Where a die lay before it went to the rail, so it comes back to the same spot. */
  #rest: (THREE.Vector3 | null)[] = [null, null, null, null, null];
  #headed: (THREE.Vector3 | null)[] = [null, null, null, null, null];
  #tray = { xh: 3.5, zFar: -3, zNear: 3, rail: -2.4, play: -1.6 };
  #tweens: Tween[] = [];
  #folded = false;
  #flight: Flight | null = null;
  #recording: [number, number][] | null = null;
  #step = 0;
  #hand = { active: false, x: 0, y: 0, idx: [] as number[], samples: [] as [number, number, number][] };
  #down: { x: number; y: number; i: number | null; timer: number } | null = null;
  #shake = { live: false, last: 0, idx: [] as number[] };
  #running = false;
  #last = 0;
  #idleSince = 0;
  #rc = new THREE.Raycaster();
  #ro: ResizeObserver;
  /** WebGL isn't there: the page shows the numbers another way. */
  readonly failed: boolean;

  constructor(options: DiceTableOptions) {
    this.#o = options;
    const canvas = options.canvas;
    try {
      this.#renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      this.#renderer = null;
    }
    this.failed = !this.#renderer;

    const r = this.#renderer;
    if (r) {
      r.setPixelRatio(Math.min(devicePixelRatio, 2));
      r.shadowMap.enabled = true;
      // three r186 dropped PCFSoftShadowMap (it fell back to this with a warning).
      r.shadowMap.type = THREE.PCFShadowMap;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.15;
      r.outputColorSpace = THREE.SRGBColorSpace;
      this.#scene.environment = studio(r);
    }
    this.#scene.background = new THREE.Color(0x0b1029);

    const hemi = new THREE.HemisphereLight(0x9aaaff, 0x0a0f2a, 0.5);
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3.5, 12, 5.5);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const lamp = new THREE.PointLight(0x9fb4ff, 34, 30, 1.6);
    lamp.position.set(0, 6, 1.5);
    this.#scene.add(hemi, sun, lamp);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 1, envMapIntensity: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.#scene.add(floor);
    this.#rail = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 0.12), new THREE.MeshStandardMaterial({ color: 0x8fa5ff, roughness: 0.4 }));
    this.#rail.castShadow = true;
    this.#scene.add(this.#rail);
    const ringMaterial = new THREE.MeshBasicMaterial({ map: ringTexture('#f0c75e'), transparent: true, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.#scene.add(ring);
      this.#rings.push(ring);
    }

    // The physics: a floor, four walls round the play area (the rail is the far one), five dice.
    const world = this.#world;
    world.allowSleep = true;
    const mDice = new CANNON.Material('dice');
    const mFloor = new CANNON.Material('floor');
    const mWall = new CANNON.Material('wall');
    world.addContactMaterial(new CANNON.ContactMaterial(mFloor, mDice, { friction: 0.32, restitution: 0.32 }));
    world.addContactMaterial(new CANNON.ContactMaterial(mWall, mDice, { friction: 0.08, restitution: 0.55 }));
    world.addContactMaterial(new CANNON.ContactMaterial(mDice, mDice, { friction: 0.2, restitution: 0.42 }));
    const plane = (m: CANNON.Material) => {
      const b = new CANNON.Body({ mass: 0, material: m });
      b.addShape(new CANNON.Plane());
      world.addBody(b);
      return b;
    };
    plane(mFloor).quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.#walls = { left: plane(mWall), right: plane(mWall), back: plane(mWall), front: plane(mWall) };
    this.#walls.left.quaternion.setFromEuler(0, Math.PI / 2, 0);
    this.#walls.right.quaternion.setFromEuler(0, -Math.PI / 2, 0);
    this.#walls.front.quaternion.setFromEuler(0, Math.PI, 0);

    this.#materials = [0, 1, 2, 3, 4, 5, 6].map((v) => (v ? glass(v) : new THREE.MeshBasicMaterial()));
    const geometry = roundedBox();
    for (let i = 0; i < 5; i++) {
      this.#labels.push([...LABELS]);
      const mesh = new THREE.Mesh(geometry, LABELS.map((v) => this.#materials[v]));
      mesh.castShadow = true;
      mesh.userData.i = i;
      this.#scene.add(mesh);
      this.#meshes.push(mesh);
      const body = new CANNON.Body({ mass: 1, material: mDice, linearDamping: 0.25, angularDamping: 0.3, allowSleep: true, sleepSpeedLimit: 0.18, sleepTimeLimit: 0.35 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
      body.addEventListener('collide', (e: { contact: CANNON.ContactEquation }) => {
        const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (this.#recording) this.#recording.push([this.#step, v]);
        else if (this.#shake.live) this.#o.onclack?.(v);
      });
      this.#bodies.push(body);
    }

    canvas.addEventListener('pointerdown', this.#pointerdown);
    canvas.addEventListener('pointermove', this.#pointermove);
    canvas.addEventListener('pointerup', this.#pointerup);
    canvas.addEventListener('pointercancel', this.#pointerup);
    this.#ro = new ResizeObserver(() => this.fit());
    this.#ro.observe(canvas);
    this.fit();
    // The dice in a loose row until the first view says otherwise.
    for (let i = 0; i < 5; i++) this.#toFloor(i, new THREE.Vector3((i - 2) * 1.35, 0.5, 0.6 + (i % 2) * 0.5), this.#upright(i, 1, (i - 2) * 0.2));
    this.#draw();
  }

  // ---- what the page tells the table -----------------------------------------------------------

  /** Flying or settling: the table takes no taps and needs no new state. */
  get busy() {
    return Boolean(this.#flight) || this.#hand.active || this.#shake.live || this.#tweens.length > 0;
  }

  /** Dice in the air or in a hand: no new throw yet. A die sliding to or from the rail isn't (it's finished at once). */
  get #throwing() {
    return Boolean(this.#flight) || this.#hand.active || this.#shake.live;
  }

  /** Every slide to or from the rail jumps to its end (a quick tap mustn't wait for it). */
  #finishTweens() {
    for (const t of this.#tweens.splice(0)) {
      const m = this.#meshes[t.i];
      m.position.copy(t.p1);
      m.quaternion.copy(t.q1);
      t.done?.();
    }
  }

  /**
   * The dice as they are, without a throw: kept ones on the rail, the others on the table showing
   * their numbers (where they already lie, if they show them). For a page opened mid-game.
   */
  show(dice: number[], held: boolean[]) {
    this.#finishFlight();
    for (let i = 0; i < 5; i++) {
      const v = dice[i] || this.#values[i];
      this.#values[i] = v;
      if (held[i]) {
        this.#toRail(i, false, v);
        continue;
      }
      if (this.#folded) {
        this.#toRow(i, false, v);
        continue;
      }
      const showing = this.#where[i] === 'floor' && this.#topValue(i) === v;
      if (showing) continue;
      const p = this.#where[i] === 'floor' ? this.#meshes[i].position.clone() : this.#freeSpot(i);
      p.y = 0.5;
      this.#toFloor(i, p, this.#upright(i, v, rand(-0.4, 0.4)));
    }
    this.#draw();
  }

  /** Kept dice to the rail, let go ones back onto the table, animated. Folded, they stay in the row. */
  setHeld(held: boolean[]) {
    for (let i = 0; i < 5; i++) {
      if (held[i] && (this.#where[i] === 'floor' || this.#where[i] === 'row')) this.#toRail(i, true);
      else if (!held[i] && this.#where[i] === 'rail') {
        if (this.#folded) this.#toRow(i, true);
        else this.#fromRail(i);
      }
    }
  }

  /**
   * The table folded down to a strip so the block has the room: every die lines up on the rail's row
   * (the kept ones with their ring), which the strip shows; unfolded, the free ones go back to where
   * they lay. A die in the air lines up when it lands. Nothing is thrown from the row: the page
   * unfolds first.
   */
  fold(on: boolean) {
    if (on === this.#folded) return;
    this.#folded = on;
    this.#finishTweens();
    for (let i = 0; i < 5; i++) {
      if (on && this.#where[i] === 'floor') this.#toRow(i, true);
      else if (!on && this.#where[i] === 'row') this.#fromRail(i);
    }
  }

  /** How much of the canvas, from its top, the folded strip needs to show the rail's row whole. */
  stripHeight() {
    const h = this.#o.canvas.clientHeight || 1;
    // The lowest point of a die on the rail on screen: its near bottom edge, with its ring round it.
    this.#camera.updateMatrixWorld();
    const p = new THREE.Vector3(0, 0, this.#tray.rail + 0.8).project(this.#camera);
    return Math.ceil(((1 - p.y) / 2) * h) + 10;
  }

  /** The dice the next throw takes: those not on the rail. */
  free() {
    return [0, 1, 2, 3, 4].filter((i) => this.#where[i] === 'floor');
  }

  /** The button (or the keyboard): the free dice, thrown in from the near edge. */
  throwFromEdge() {
    if (!this.allow.throw || this.#throwing) return false;
    this.#finishTweens();
    const idx = this.free();
    if (!idx.length) return false;
    const lay = CLUMP[idx.length];
    const starts = idx.map((i, k) => ({
      p: [lay[k][0] * 1.1, 1.6 + lay[k][1], this.#tray.zNear - 1.3 + lay[k][2]],
      q: quatArray(this.#meshes[i].quaternion),
      v: [rand(-2.5, 2.5), 2.5, -rand(10, 14)],
      w: [rand(-22, 22), rand(-22, 22), rand(-22, 22)],
    }));
    this.#launch(idx, starts, true);
    return true;
  }

  /** The numbers for this page's own throw: the dice land on them. */
  resolve(t: Throw) {
    const f = this.#flight;
    if (!f || !f.waiting) {
      // Already landed (a slow answer): turn them over to the right numbers where they lie.
      this.#settleOn(t.dice, t.held);
      return;
    }
    f.waiting = false;
    this.#relabel(f.rec, t.dice);
  }

  /** The server refused this page's throw: the dice go back to how the server has them. */
  cancel(dice: number[], held: boolean[]) {
    this.#flight = null;
    this.show(dice, held);
  }

  /** Someone else's throw (a person on their phone, a bot, a stand-in): played the same way here. */
  replay(t: Throw) {
    this.#finishFlight();
    this.#finishTweens();
    for (let i = 0; i < 5; i++) if (t.held[i]) this.#toRail(i, false, t.dice[i]);
    const idx = [0, 1, 2, 3, 4].filter((i) => !t.held[i]);
    if (!idx.length) return;
    if (reduced() || this.failed) return this.#settleOn(t.dice, t.held);
    for (const i of idx) if (this.#where[i] === 'rail') this.#fromRail(i, false);
    // Their screen may be wider than this one: their dice start inside this tray.
    const tray = this.#tray;
    const inside = (d: DieFling): DieFling => ({
      ...d,
      p: [THREE.MathUtils.clamp(d.p[0], -tray.xh + 0.7, tray.xh - 0.7), Math.max(0.6, d.p[1]), THREE.MathUtils.clamp(d.p[2], tray.play + 0.7, tray.zNear - 0.7)],
    });
    const starts = t.fling?.dice.length === idx.length ? t.fling.dice.map(inside) : this.#defaultFling(idx, t.n, t.seat);
    const rec = this.#simulate(idx, starts);
    this.#relabel(rec, t.dice);
    this.#play(rec, false);
  }

  /**
   * The phone's motion (acceleration without gravity, the device's own axes), from the page's
   * devicemotion listener. A hard move throws the free dice around the tray; when the shaking stops,
   * they're thrown from where they are.
   */
  motion(ax: number, ay: number, az: number) {
    const strength = Math.hypot(ax, ay, az);
    const now = performance.now();
    if (this.#shake.live) {
      if (strength > 9) {
        this.#shake.last = now;
        this.#jolt(ax, ay, az);
      }
      return;
    }
    if (strength < 14 || !this.allow.throw || this.#throwing || reduced()) return;
    this.#finishTweens();
    const idx = this.free();
    if (!idx.length) return;
    this.#shake = { live: true, last: now, idx };
    for (const i of idx) {
      this.#where[i] = 'flight';
      this.#bodies[i].wakeUp();
    }
    this.#jolt(ax, ay, az);
    this.#wake();
  }

  /** The canvas's size changed (or the page laid out): the camera and the walls follow. */
  fit() {
    const r = this.#renderer;
    const canvas = this.#o.canvas;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    r?.setSize(w, h, false);
    const cam = this.#camera;
    cam.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    // Wide enough for eight dice across and deep enough for the rail and the play area.
    const d = Math.max(8 / (2 * tan * cam.aspect), 7.2 / (2 * tan));
    const tilt = THREE.MathUtils.degToRad(20);
    cam.position.set(0, d * Math.cos(tilt), d * Math.sin(tilt));
    cam.lookAt(0, 0, 0.15);
    cam.updateProjectionMatrix();
    const nearLeft = this.#hitFloor(-1, -1);
    const far = this.#hitFloor(0, 1);
    const near = this.#hitFloor(0, -1);
    const t = this.#tray;
    t.xh = Math.min(Math.abs(nearLeft.x) - 0.3, 7);
    t.zFar = far.z;
    t.zNear = near.z - 0.25;
    // Far enough from the top edge that a die on the rail shows whole (its top leans toward the edge).
    t.rail = t.zFar + 1.8;
    t.play = t.zFar + 2.6;
    this.#walls.left.position.set(-t.xh, 0, 0);
    this.#walls.right.position.set(t.xh, 0, 0);
    this.#walls.back.position.set(0, 0, t.play);
    this.#walls.front.position.set(0, 0, t.zNear);
    this.#rail.scale.x = t.xh * 2 - 0.4;
    this.#rail.position.set(0, 0.08, t.play - 0.06);
    for (let i = 0; i < 5; i++) {
      this.#rings[i].position.set(this.#slotX(i), 0.012, t.rail);
      if (this.#where[i] === 'rail' || this.#where[i] === 'row') this.#meshes[i].position.set(this.#slotX(i), 0.5, t.rail);
      // A die the new walls leave outside comes back in.
      if (this.#where[i] === 'floor') {
        const p = this.#meshes[i].position;
        const x = THREE.MathUtils.clamp(p.x, -t.xh + 0.6, t.xh - 0.6);
        const z = THREE.MathUtils.clamp(p.z, t.play + 0.6, t.zNear - 0.6);
        if (x !== p.x || z !== p.z) this.#toFloor(i, new THREE.Vector3(x, 0.5, z), this.#meshes[i].quaternion.clone());
      }
    }
    this.#draw();
  }

  destroy() {
    const canvas = this.#o.canvas;
    canvas.removeEventListener('pointerdown', this.#pointerdown);
    canvas.removeEventListener('pointermove', this.#pointermove);
    canvas.removeEventListener('pointerup', this.#pointerup);
    canvas.removeEventListener('pointercancel', this.#pointerup);
    this.#ro.disconnect();
    this.#running = false;
    this.#renderer?.dispose();
  }

  // ---- the throw ----------------------------------------------------------------------------

  /** Dice leave the hand: played through at once, then shown; this page's own goes to the server. */
  #launch(idx: number[], starts: DieFling[], own: boolean) {
    if (reduced() || this.failed) {
      this.#o.onthrow(null);
      this.#flight = null;
      return;
    }
    const rec = this.#simulate(idx, starts);
    this.#play(rec, own);
    if (own) this.#o.onthrow({ dice: starts.map(roundFling) });
  }

  #play(rec: Recording, own: boolean) {
    for (const i of rec.idx) this.#where[i] = 'flight';
    this.#flight = { rec, t0: performance.now(), clack: 0, waiting: own };
    this.#wake();
  }

  /** Runs the physics from these starts to rest (or MAX_STEPS) and records every step. */
  #simulate(idx: number[], starts: DieFling[]): Recording {
    const world = this.#world;
    for (let i = 0; i < 5; i++) if (!idx.includes(i) && world.bodies.includes(this.#bodies[i])) world.removeBody(this.#bodies[i]);
    idx.forEach((i, k) => {
      const b = this.#bodies[i];
      const s = starts[k];
      b.position.set(s.p[0], s.p[1], s.p[2]);
      b.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      b.quaternion.normalize();
      b.velocity.set(s.v[0], s.v[1], s.v[2]);
      b.angularVelocity.set(s.w[0], s.w[1], s.w[2]);
      if (!world.bodies.includes(b)) world.addBody(b);
      b.wakeUp();
    });
    const frames = new Float32Array((MAX_STEPS + LAY_STEPS) * idx.length * 7);
    const clacks: [number, number][] = [];
    this.#recording = clacks;
    let steps = 0;
    const record = (poses: { p: THREE.Vector3; q: THREE.Quaternion }[] | null = null) => {
      idx.forEach((i, k) => {
        const b = this.#bodies[i];
        const pose = poses?.[k];
        const at = (steps * idx.length + k) * 7;
        if (pose) frames.set([pose.p.x, pose.p.y, pose.p.z, pose.q.x, pose.q.y, pose.q.z, pose.q.w], at);
        else frames.set([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w], at);
      });
      steps++;
    };
    let calm = 0;
    while (steps < MAX_STEPS) {
      this.#step = steps;
      world.step(STEP);
      record();
      const moving = idx.some((i) => {
        const b = this.#bodies[i];
        return b.velocity.length() + b.angularVelocity.length() * 0.5 > STILL || (b.position.y > 0.62 && b.velocity.length() > 0.2);
      });
      calm = moving ? 0 : calm + 1;
      if (calm >= CALM_STEPS) break;
    }
    this.#recording = null;

    // Laid flat: each die on its nearest face, one that leans or lies on another moved to a free spot.
    const from = idx.map((i) => {
      const b = this.#bodies[i];
      return { p: new THREE.Vector3(b.position.x, b.position.y, b.position.z), q: new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w) };
    });
    const to = from.map((f) => ({ p: f.p.clone().setY(0.5), q: flatten(f.q, topFace(f.q)[0]) }));
    const t = this.#tray;
    const clear = (p: THREE.Vector3, k: number) => to.every((o, j) => j === k || Math.hypot(o.p.x - p.x, o.p.z - p.z) > 1.12);
    to.forEach((target, k) => {
      if (from[k].p.y <= 0.6 && clear(target.p, k)) return;
      for (let r = 0.6; r < 4; r += 0.3) {
        for (let a = 0; a < 12; a++) {
          const p = new THREE.Vector3(target.p.x + Math.cos(a * 0.52) * r, 0.5, target.p.z + Math.sin(a * 0.52) * r);
          if (p.x < -t.xh + 0.6 || p.x > t.xh - 0.6 || p.z < t.play + 0.6 || p.z > t.zNear - 0.6 || !clear(p, k)) continue;
          target.p.copy(p);
          return;
        }
      }
    });
    const off = to.some((target, k) => target.p.distanceTo(from[k].p) > 0.01 || target.q.angleTo(from[k].q) > 0.01);
    if (off) {
      for (let n = 1; n <= LAY_STEPS; n++) {
        const u = n / LAY_STEPS;
        const e = 1 - Math.pow(1 - u, 3);
        record(
          to.map((target, k) => {
            const p = from[k].p.clone().lerp(target.p, e);
            if (from[k].p.y > 0.6) p.y += Math.sin(u * Math.PI) * 0.3;
            return { p, q: from[k].q.clone().slerp(target.q, e) };
          }),
        );
      }
    }
    idx.forEach((i, k) => {
      const b = this.#bodies[i];
      b.position.set(to[k].p.x, 0.5, to[k].p.z);
      b.quaternion.set(to[k].q.x, to[k].q.y, to[k].q.z, to[k].q.w);
      b.velocity.setZero();
      b.angularVelocity.setZero();
      b.sleep();
    });
    return { idx, frames, steps, clacks, up: idx.map((i) => topFace(this.#bodies[i].quaternion)[0]) };
  }

  /**
   * Turns the faces of each thrown die so the one that lands on top shows `dice[i]`: the top face and
   * the face that had that number swap, and so do their opposites (so opposites still add up to 7).
   */
  #relabel(rec: Recording, dice: number[]) {
    rec.idx.forEach((i, k) => {
      const want = dice[i];
      if (!want) return;
      const labels = this.#labels[i];
      const top = rec.up[k];
      if (labels[top] === want) return;
      const j = labels.indexOf(want);
      [labels[top], labels[j]] = [labels[j], labels[top]];
      if (j !== (top ^ 1)) [labels[top ^ 1], labels[j ^ 1]] = [labels[j ^ 1], labels[top ^ 1]];
      this.#meshes[i].material = labels.map((v) => this.#materials[v]);
    });
  }

  /** Where nobody's hand is (a bot, a stand-in, an old page): in from the side, the same on every page. */
  #defaultFling(idx: number[], n: number, seat: number): DieFling[] {
    const r = seeded(n * 7919 + seat);
    const side = seat % 2 ? 1 : -1;
    const lay = CLUMP[idx.length];
    const t = this.#tray;
    return idx.map((_, k) => ({
      p: [side * (t.xh - 1.2) + lay[k][2], 1.6 + lay[k][1], (t.play + t.zNear) / 2 + lay[k][0]],
      q: [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5],
      v: [-side * (12 + r() * 5), 2 + r() * 2, (r() - 0.5) * 6],
      w: [(r() - 0.5) * 44, (r() - 0.5) * 44, (r() - 0.5) * 44],
    }));
  }

  /** No flight: the dice turn over to the numbers where they lie (reduced motion, a slow answer). */
  #settleOn(dice: number[], held: boolean[]) {
    this.#flight = null;
    for (let i = 0; i < 5; i++) {
      if (held[i] || !dice[i]) continue;
      this.#values[i] = dice[i];
      if (this.#folded) {
        this.#toRow(i, false, dice[i]);
        continue;
      }
      const p = this.#where[i] === 'floor' || this.#where[i] === 'flight' ? this.#meshes[i].position.clone() : this.#freeSpot(i);
      p.y = 0.5;
      this.#toFloor(i, p, this.#upright(i, dice[i], rand(-0.5, 0.5)));
    }
    this.#draw();
    this.#o.onrest?.();
  }

  /** Ends a flight still playing (a new throw came): the dice jump to where it ends. */
  #finishFlight() {
    const f = this.#flight;
    if (!f) return;
    this.#frameAt(f.rec, f.rec.steps - 1);
    this.#landed(f.rec);
  }

  #landed(rec: Recording) {
    this.#flight = null;
    for (const i of rec.idx) {
      this.#where[i] = 'floor';
      this.#values[i] = this.#topValue(i);
      if (this.#folded) this.#toRow(i, true);
    }
    this.#o.onrest?.();
  }

  #frameAt(rec: Recording, s: number) {
    rec.idx.forEach((i, k) => {
      const o = (s * rec.idx.length + k) * 7;
      const f = rec.frames;
      this.#meshes[i].position.set(f[o], f[o + 1], f[o + 2]);
      this.#meshes[i].quaternion.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
    });
  }

  // ---- the hand, the shake ------------------------------------------------------------------

  #startHand(x: number, y: number) {
    const h = this.#hand;
    h.active = true;
    h.idx = this.free();
    h.x = x;
    h.y = y;
    h.samples = [];
    for (const i of h.idx) {
      this.#where[i] = 'hand';
      if (this.#world.bodies.includes(this.#bodies[i])) this.#world.removeBody(this.#bodies[i]);
    }
    this.#wake();
  }

  #updateHand(dt: number, now: number) {
    const h = this.#hand;
    const p = this.#onPlane(h.x, h.y, HAND_Y);
    h.samples.push([now, p.x, p.z]);
    while (h.samples.length > 2 && now - h.samples[0][0] > 90) h.samples.shift();
    const [t0, x0, z0] = h.samples[0];
    const speed = now > t0 ? Math.hypot(p.x - x0, p.z - z0) / ((now - t0) / 1000) : 0;
    const lay = CLUMP[h.idx.length] ?? [];
    h.idx.forEach((i, k) => {
      const m = this.#meshes[i];
      const [ox, oy, oz] = lay[k];
      const jitter = Math.min(0.3, speed * 0.015);
      const target = new THREE.Vector3(p.x + ox + rand(-0.5, 0.5) * jitter, p.y + oy, p.z + oz + rand(-0.5, 0.5) * jitter);
      m.position.lerp(target, 1 - Math.exp(-dt * 16));
      const spin = (1.2 + Math.min(speed, 30) * 0.5) * dt;
      m.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-1, 1) * spin, rand(-1, 1) * spin, rand(-1, 1) * spin)));
      if (speed > 8 && Math.random() < dt * 6) this.#o.onclack?.(3 + Math.random() * 4);
    });
  }

  #release() {
    const h = this.#hand;
    if (!h.active) return;
    h.active = false;
    const a = h.samples[0];
    const b = h.samples[h.samples.length - 1];
    let vx = 0;
    let vz = 0;
    if (a && b && b[0] > a[0]) {
      vx = (b[1] - a[1]) / ((b[0] - a[0]) / 1000);
      vz = (b[2] - a[2]) / ((b[0] - a[0]) / 1000);
    }
    let speed = Math.hypot(vx, vz);
    const p = this.#meshes[h.idx[0]]?.position ?? new THREE.Vector3();
    const t = this.#tray;
    // A slow release just tosses them in, toward the middle.
    if (speed < 4) {
      const dx = -p.x;
      const dz = (t.play + t.zNear) / 2 - p.z;
      const d = Math.hypot(dx, dz) || 1;
      vx = (dx / d) * 7;
      vz = (dz / d) * 7 - 2;
      speed = 7;
    }
    if (speed > 22) {
      vx *= 22 / speed;
      vz *= 22 / speed;
      speed = 22;
    }
    const w = 10 + speed * 0.8;
    const starts = h.idx.map((i) => {
      const m = this.#meshes[i];
      return {
        p: [m.position.x, m.position.y, m.position.z],
        q: quatArray(m.quaternion),
        v: [vx * rand(0.85, 1.1), rand(1, 4), vz * rand(0.85, 1.1)],
        w: [rand(-w, w), rand(-w, w), rand(-w, w)],
      };
    });
    this.#launch(h.idx, starts, true);
  }

  /** The phone moved hard: the dice in the tray lag behind it (device axes to the table's). */
  #jolt(ax: number, ay: number, az: number) {
    for (const i of this.#shake.idx) {
      const b = this.#bodies[i];
      b.wakeUp();
      b.velocity.x += -ax * 0.55 + rand(-1.5, 1.5);
      b.velocity.z += ay * 0.55 + rand(-1.5, 1.5);
      b.velocity.y += Math.min(6, Math.abs(az) * 0.3 + rand(1.5, 3));
      b.angularVelocity.x += rand(-18, 18);
      b.angularVelocity.z += rand(-18, 18);
    }
  }

  /** The shaking stopped: the dice are thrown from where they are now. */
  #endShake() {
    const idx = this.#shake.idx;
    this.#shake = { live: false, last: 0, idx: [] };
    const starts = idx.map((i) => {
      const b = this.#bodies[i];
      return {
        p: [b.position.x, Math.max(0.5, b.position.y), b.position.z],
        q: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
        v: [b.velocity.x, b.velocity.y, b.velocity.z],
        w: [b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z],
      };
    });
    this.#launch(idx, starts, true);
  }

  // ---- the rail and the floor ---------------------------------------------------------------

  /** To the rail, number up: `value` when the server says which, else the one on top now. */
  #toRail(i: number, animate: boolean, value?: number) {
    const m = this.#meshes[i];
    if (this.#where[i] === 'rail' || this.#where[i] === 'row') {
      if (value && value !== this.#values[i]) {
        this.#values[i] = value;
        m.quaternion.copy(this.#upright(i, value));
      }
      // Kept while folded: it's in its slot already, and gets its ring.
      this.#where[i] = 'rail';
      this.#rings[i].visible = true;
      this.#draw();
      return;
    }
    if (this.#where[i] === 'floor') this.#rest[i] = m.position.clone().setY(0.5);
    const body = this.#bodies[i];
    if (this.#world.bodies.includes(body)) this.#world.removeBody(body);
    const v = value || (this.#where[i] === 'floor' ? this.#topValue(i) : this.#values[i]);
    this.#values[i] = v;
    const p = new THREE.Vector3(this.#slotX(i), 0.5, this.#tray.rail);
    const q = this.#upright(i, v);
    if (!animate || reduced()) {
      m.position.copy(p);
      m.quaternion.copy(q);
      this.#where[i] = 'rail';
      this.#rings[i].visible = true;
      this.#draw();
      return;
    }
    this.#where[i] = 'tween';
    this.#headed[i] = null;
    this.#tween(i, p, q, 300, 0.9, () => {
      this.#where[i] = 'rail';
      this.#rings[i].visible = true;
    });
  }

  /** Into its slot on the rail's row, number up, without a ring: a free die while folded. */
  #toRow(i: number, animate: boolean, value?: number) {
    const m = this.#meshes[i];
    this.#rings[i].visible = false;
    if (this.#where[i] === 'rail' || this.#where[i] === 'row') {
      if (value && value !== this.#values[i]) {
        this.#values[i] = value;
        m.quaternion.copy(this.#upright(i, value));
      }
      this.#where[i] = 'row';
      this.#draw();
      return;
    }
    if (this.#where[i] === 'floor') this.#rest[i] = m.position.clone().setY(0.5);
    const body = this.#bodies[i];
    if (this.#world.bodies.includes(body)) this.#world.removeBody(body);
    const v = value || (this.#where[i] === 'floor' ? this.#topValue(i) : this.#values[i]);
    this.#values[i] = v;
    const p = new THREE.Vector3(this.#slotX(i), 0.5, this.#tray.rail);
    const q = this.#upright(i, v);
    if (!animate || reduced()) {
      m.position.copy(p);
      m.quaternion.copy(q);
      this.#where[i] = 'row';
      this.#draw();
      return;
    }
    this.#where[i] = 'tween';
    this.#headed[i] = null;
    this.#tween(i, p, q, 340, 0.5, () => (this.#where[i] = 'row'));
  }

  #fromRail(i: number, animate = true) {
    this.#rings[i].visible = false;
    const p = this.#freeSpot(i);
    const q = this.#upright(i, this.#values[i], rand(-0.25, 0.25));
    if (!animate || reduced()) {
      this.#toFloor(i, p, q);
      this.#draw();
      return;
    }
    this.#where[i] = 'tween';
    this.#headed[i] = p;
    this.#tween(i, p, q, 300, 0.9, () => {
      this.#headed[i] = null;
      this.#toFloor(i, p, q);
    });
  }

  #toFloor(i: number, pos: THREE.Vector3, q: THREE.Quaternion) {
    const b = this.#bodies[i];
    b.position.set(pos.x, pos.y, pos.z);
    b.quaternion.set(q.x, q.y, q.z, q.w);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    if (!this.#world.bodies.includes(b)) this.#world.addBody(b);
    b.sleep();
    this.#where[i] = 'floor';
    this.#rings[i].visible = false;
    this.#meshes[i].position.copy(pos);
    this.#meshes[i].quaternion.copy(q);
  }

  /** A free spot on the table, its old one first. */
  #freeSpot(i: number) {
    const t = this.#tray;
    const taken = this.#meshes
      .map((m, j) => (j === i || this.#where[j] === 'rail' || this.#where[j] === 'row' ? null : this.#where[j] === 'tween' && this.#headed[j] ? this.#headed[j] : m.position))
      .filter((p): p is THREE.Vector3 => Boolean(p));
    for (let tries = 0; tries < 80; tries++) {
      const old = tries === 0 ? this.#rest[i] : null;
      const p = old ? old.clone() : new THREE.Vector3(rand(-t.xh + 0.8, t.xh - 0.8), 0.5, rand(t.play + 0.8, t.zNear - 0.8));
      if (p.x < -t.xh + 0.6 || p.x > t.xh - 0.6 || p.z < t.play + 0.6 || p.z > t.zNear - 0.6) continue;
      if (taken.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 1.35)) return p;
    }
    return new THREE.Vector3(this.#slotX(i), 0.5, (t.play + t.zNear) / 2);
  }

  #slotX(i: number) {
    return (i - 2) * 1.32;
  }

  /** The turn that puts number `v` of die i on top, its front `yaw` round from straight on. */
  #upright(i: number, v: number, yaw = 0) {
    const face = this.#labels[i].indexOf(v);
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(FACE_UP[face]);
  }

  #topValue(i: number) {
    return this.#labels[i][topFace(this.#meshes[i].quaternion)[0]];
  }

  #tween(i: number, p1: THREE.Vector3, q1: THREE.Quaternion, dur: number, arc: number, done?: () => void) {
    const m = this.#meshes[i];
    this.#tweens.push({ i, p0: m.position.clone(), p1, q0: m.quaternion.clone(), q1, t0: performance.now(), dur, arc, done });
    this.#wake();
  }

  // ---- pointer ------------------------------------------------------------------------------

  #pointerdown = (e: PointerEvent) => {
    if (this.#throwing) return;
    this.#finishTweens();
    const canvas = this.#o.canvas;
    canvas.setPointerCapture(e.pointerId);
    const i = this.#hitDie(e.clientX, e.clientY);
    const canThrow = this.allow.throw && this.free().length > 0;
    const timer = canThrow ? window.setTimeout(() => {
      if (this.#down && !this.#hand.active && (this.#down.i === null || this.#where[this.#down.i] !== 'rail')) this.#startHand(this.#down.x, this.#down.y);
    }, 170) : 0;
    this.#down = { x: e.clientX, y: e.clientY, i, timer };
  };

  #pointermove = (e: PointerEvent) => {
    const d = this.#down;
    if (!d) return;
    this.#hand.x = e.clientX;
    this.#hand.y = e.clientY;
    const onRail = d.i !== null && this.#where[d.i] === 'rail';
    if (!this.#hand.active && !onRail && this.allow.throw && this.free().length && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) {
      clearTimeout(d.timer);
      this.#startHand(e.clientX, e.clientY);
    }
  };

  #pointerup = () => {
    const d = this.#down;
    if (!d) return;
    clearTimeout(d.timer);
    this.#down = null;
    if (this.#hand.active) return this.#release();
    const w = d.i !== null ? this.#where[d.i] : null;
    if (d.i !== null && this.allow.keep && (w === 'floor' || w === 'rail' || w === 'row')) this.#o.onkeep(d.i);
    else if (!this.allow.throw && !this.allow.keep) this.#o.onrefuse?.();
  };

  #ndc(x: number, y: number) {
    const r = this.#o.canvas.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  #hitDie(x: number, y: number) {
    this.#rc.setFromCamera(this.#ndc(x, y), this.#camera);
    const hit = this.#rc.intersectObjects(this.#meshes, false)[0];
    return hit ? (hit.object.userData.i as number) : null;
  }

  #onPlane(x: number, y: number, h: number) {
    this.#rc.setFromCamera(this.#ndc(x, y), this.#camera);
    const p = new THREE.Vector3();
    this.#rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), p);
    const t = this.#tray;
    p.x = THREE.MathUtils.clamp(p.x, -t.xh + 1, t.xh - 1);
    p.z = THREE.MathUtils.clamp(p.z, t.play + 1, t.zNear - 1);
    return p;
  }

  #hitFloor(nx: number, ny: number) {
    this.#rc.setFromCamera(new THREE.Vector2(nx, ny), this.#camera);
    const p = new THREE.Vector3();
    this.#rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
    return p;
  }

  // ---- the loop -----------------------------------------------------------------------------

  #draw() {
    if (this.#renderer && !this.#running) this.#renderer.render(this.#scene, this.#camera);
  }

  #wake() {
    if (this.#running || !this.#renderer) return;
    this.#running = true;
    this.#last = performance.now();
    this.#idleSince = this.#last;
    requestAnimationFrame(this.#frame);
  }

  #frame = (now: number) => {
    if (!this.#running) return;
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    if (this.#hand.active) this.#updateHand(dt, now);
    if (this.#shake.live) {
      this.#world.step(STEP, dt, 8);
      for (const i of this.#shake.idx) {
        this.#meshes[i].position.copy(this.#bodies[i].position as unknown as THREE.Vector3);
        this.#meshes[i].quaternion.copy(this.#bodies[i].quaternion as unknown as THREE.Quaternion);
      }
      if (now - this.#shake.last > 350) this.#endShake();
    }
    const f = this.#flight;
    if (f) {
      const s = Math.min(f.rec.steps - 1, Math.floor(((now - f.t0) / 1000) / STEP));
      this.#frameAt(f.rec, s);
      while (f.clack < f.rec.clacks.length && f.rec.clacks[f.clack][0] <= s) this.#o.onclack?.(f.rec.clacks[f.clack++][1]);
      // Landed, unless the server's numbers haven't come yet: then they turn over once they do.
      if (s >= f.rec.steps - 1 && !f.waiting) this.#landed(f.rec);
    }
    for (let k = this.#tweens.length - 1; k >= 0; k--) {
      const t = this.#tweens[k];
      const u = Math.min(1, (now - t.t0) / t.dur);
      const e = 1 - Math.pow(1 - u, 3);
      const m = this.#meshes[t.i];
      m.position.lerpVectors(t.p0, t.p1, e);
      m.position.y += Math.sin(u * Math.PI) * t.arc;
      m.quaternion.slerpQuaternions(t.q0, t.q1, e);
      if (u >= 1) {
        this.#tweens.splice(k, 1);
        t.done?.();
      }
    }
    this.#renderer!.render(this.#scene, this.#camera);
    if (this.busy) this.#idleSince = now;
    if (now - this.#idleSince < 300) requestAnimationFrame(this.#frame);
    else this.#running = false;
  };
}

// ---- drawing ------------------------------------------------------------------------------------

/** The turn that brings each face (BoxGeometry's order) to the top. */
const FACE_UP = (() => {
  const e = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  const H = Math.PI / 2;
  return [e(0, 0, H), e(0, 0, -H), e(0, 0, 0), e(Math.PI, 0, 0), e(-H, 0, 0), e(H, 0, 0)];
})();

/** The face on top for a turn, and how flat it lies (1: flat). */
function topFace(q: { x: number; y: number; z: number; w: number }): [number, number] {
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  let best = -2;
  let face = 2;
  NORMALS.forEach((n, k) => {
    const y = new THREE.Vector3(...n).applyQuaternion(quat).y;
    if (y > best) {
      best = y;
      face = k;
    }
  });
  return [face, best];
}

/** A turn tilted flat onto `face`, keeping where the die faces. */
function flatten(q: THREE.Quaternion, face: number) {
  const up = new THREE.Vector3(...NORMALS[face]).applyQuaternion(q);
  const fix = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
  return fix.multiply(q);
}

const quatArray = (q: THREE.Quaternion) => [q.x, q.y, q.z, q.w];
const roundFling = (d: DieFling): DieFling => {
  const r = (a: number[]) => a.map((x) => Math.round(x * 1000) / 1000);
  return { p: r(d.p), q: r(d.q), v: r(d.v), w: r(d.w) };
};

/** A unit cube with rounded edges, its normals smooth round the edges and flat on the faces. */
function roundedBox(r = 0.13, seg = 12) {
  const g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const h = 0.5 - r;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(THREE.MathUtils.clamp(v.x, -h, h), THREE.MathUtils.clamp(v.y, -h, h), THREE.MathUtils.clamp(v.z, -h, h));
    n.subVectors(v, c);
    if (n.lengthSq() < 1e-10) n.fromBufferAttribute(nor, i);
    else n.normalize();
    v.copy(c).addScaledVector(n, r);
    pos.setXYZ(i, v.x, v.y, v.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** One face: cobalt glass with white pips, and a mask that keeps the pips solid (not see-through). */
function glass(v: number) {
  const s = 256;
  const [c1, x] = canvas2d(s);
  const [c2, m] = canvas2d(s);
  x.fillStyle = '#8ea3ff';
  x.fillRect(0, 0, s, s);
  m.fillStyle = '#ffffff';
  m.fillRect(0, 0, s, s);
  for (const [px, py] of PIPS[v]) {
    const cx = px * s;
    const cy = py * s;
    const r = s * 0.088;
    const g = x.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.8, '#eef1ff');
    g.addColorStop(1, '#a9b8ee');
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
    m.fillStyle = '#000000';
    m.beginPath();
    m.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
    m.fill();
  }
  const map = new THREE.CanvasTexture(c1);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const transmissionMap = new THREE.CanvasTexture(c2);
  return new THREE.MeshPhysicalMaterial({
    map,
    transmissionMap,
    transmission: 1,
    thickness: 0.7,
    ior: 1.5,
    roughness: 0.02,
    attenuationColor: new THREE.Color('#2443c4'),
    attenuationDistance: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    specularIntensity: 1,
    envMapIntensity: 1.5,
  });
}

/** The night block: deep navy, lighter under the lamp, the squared grid in light cobalt. */
function floorTexture() {
  const s = 1024;
  const [c, x] = canvas2d(s);
  const g = x.createRadialGradient(s / 2, s * 0.45, s * 0.05, s / 2, s / 2, s * 0.62);
  g.addColorStop(0, '#1d2a66');
  g.addColorStop(0.6, '#0f173f');
  g.addColorStop(1, '#070a1c');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  const img = x.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = (Math.random() - 0.5) * 18;
    img.data[i] += k * 0.7;
    img.data[i + 1] += k * 0.8;
    img.data[i + 2] += k;
  }
  x.putImageData(img, 0, 0);
  x.strokeStyle = 'rgba(143,165,255,.13)';
  x.lineWidth = 1.4;
  for (let i = 0; i <= s; i += 23.04) {
    x.beginPath();
    x.moveTo(i, 0);
    x.lineTo(i, s);
    x.stroke();
    x.beginPath();
    x.moveTo(0, i);
    x.lineTo(s, i);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.5, 1.5);
  return t;
}

/** The ring drawn round a kept die, as with a pen. */
function ringTexture(color: string) {
  const s = 256;
  const [c, x] = canvas2d(s);
  x.strokeStyle = color;
  x.lineWidth = 9;
  x.lineCap = 'round';
  x.beginPath();
  for (let k = 0; k <= 64; k++) {
    const a = -1.2 + (k / 64) * (Math.PI * 2 + 0.55);
    const r = 104 + Math.sin(a * 3) * 4 + k * 0.12;
    const px = 128 + Math.cos(a) * r;
    const py = 128 + Math.sin(a) * r * 0.96;
    if (k) x.lineTo(px, py);
    else x.moveTo(px, py);
  }
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A small studio for the glass to mirror: a dark dome with four soft boxes. */
function studio(renderer: THREE.WebGLRenderer) {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x34407a, side: THREE.BackSide })));
  const box = (w: number, h: number, x: number, y: number, z: number, color: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    room.add(m);
  };
  box(14, 6, 0, 14, 4, 0xffffff);
  box(18, 7, 0, 11, -10, 0xffffff);
  box(6, 10, -14, 6, -2, 0xb8c6ff);
  box(6, 8, 13, 5, 6, 0xfff1cf);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(room, 0.03).texture;
  pm.dispose();
  return env;
}

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  anchorIndices, ballFlight, centreOfMass, COURT, deeperKnee, estimateRacket, shareAt, strokeSpace, toCourt,
  type AnchorJoint, type BallFlight, type Handedness, type PoseFrame, type Status, type Stroke, type StrokeSpace, type Vec3, type WeightTransfer,
} from '../core';

/**
 * The 3D studio: the player as a jointed, shaded mannequin driven by the pose's world landmarks,
 * standing on a dark wireframe court with glowing lines, ball and highlight rings.
 */

const NEON = new THREE.Color(1.5, 1.95, 0.5); // #d4f04c pushed past 1 so it blooms
const RED = new THREE.Color(2.2, 0.32, 0.28);
const LINE = new THREE.Color(1.02, 1.05, 1.12);
const BALL = new THREE.Color(2.2, 2.5, 0.6);

export interface Ring {
  anchor: AnchorJoint;
  status: Status;
}

export interface SceneInput {
  frames: PoseFrame[];
  i: number;
  fps: number;
  hand: Handedness;
  stroke?: Stroke;
  weight?: WeightTransfer | null;
  rings?: Ring[];
  /** Show the ball and its flight. */
  ball?: boolean;
  /** Extra camera swing around the player, radians (for a slow orbit in reels). */
  orbit?: number;
}

type Seg = { mesh: THREE.Mesh; a: number; b: number };

const v3 = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);
const UP = new THREE.Vector3(0, 1, 0);

export class StudioScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 9 / 16, 0.1, 200);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private body = new THREE.Group();
  private segs: Seg[] = [];
  private joints: { mesh: THREE.Mesh; i: number }[] = [];
  private chest: THREE.Mesh;
  private belly: THREE.Mesh;
  private pelvis: THREE.Mesh;
  private neck: THREE.Mesh;
  private head: THREE.Mesh;
  private hands: THREE.Mesh[];
  private feet: THREE.Mesh[];
  private racket = new THREE.Group();
  private ball: THREE.Mesh;
  private ballLight: THREE.PointLight;
  private trail: THREE.Mesh | null = null;
  private path: THREE.Mesh | null = null;
  private ringMeshes: THREE.Mesh[] = [];
  private glow: THREE.Mesh;
  private footGlow: THREE.Mesh[];
  private spaces = new WeakMap<Stroke, { key: string; space: StrokeSpace; flight: BallFlight | null }>();
  private lastSpace: StrokeSpace | null = null;

  constructor(width: number, height: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color('#05070b');
    this.scene.fog = new THREE.Fog('#05070b', 16, 42);

    this.buildCourt();
    this.buildLights();

    // Mannequin: tapered limbs with ball joints, shaped torso and head.
    const skin = new THREE.MeshStandardMaterial({ color: '#dcdcd7', roughness: 0.36, metalness: 0.04 });
    const jointMat = new THREE.MeshStandardMaterial({ color: '#c3c3be', roughness: 0.42, metalness: 0.04 });
    const limb = (a: number, b: number, rTop: number, rBottom: number) => {
      const g = new THREE.CylinderGeometry(rBottom, rTop, 1, 20, 1);
      g.translate(0, 0.5, 0);
      const mesh = new THREE.Mesh(g, skin);
      mesh.castShadow = true;
      this.body.add(mesh);
      this.segs.push({ mesh, a, b });
    };
    limb(11, 13, 0.047, 0.039); limb(12, 14, 0.047, 0.039);
    limb(13, 15, 0.037, 0.03); limb(14, 16, 0.037, 0.03);
    limb(23, 25, 0.078, 0.056); limb(24, 26, 0.078, 0.056);
    limb(25, 27, 0.054, 0.037); limb(26, 28, 0.054, 0.037);
    const joint = (i: number, r: number) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), jointMat);
      mesh.castShadow = true;
      this.body.add(mesh);
      this.joints.push({ mesh, i });
    };
    joint(11, 0.058); joint(12, 0.058); joint(13, 0.043); joint(14, 0.043); joint(15, 0.033); joint(16, 0.033);
    joint(23, 0.068); joint(24, 0.068); joint(25, 0.058); joint(26, 0.058); joint(27, 0.04); joint(28, 0.04);
    const blob = (mat = skin) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
      m.castShadow = true;
      this.body.add(m);
      return m;
    };
    this.chest = blob();
    this.belly = blob(jointMat);
    this.pelvis = blob();
    this.head = blob();
    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.048, 1, 16).translate(0, 0.5, 0), jointMat);
    this.body.add(this.neck);
    this.hands = [blob(), blob()];
    this.feet = [blob(), blob()];
    this.scene.add(this.body);

    // Racket: dark shaft, neon frame, faint strings.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 1, 10).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#30343a', roughness: 0.5 }));
    shaft.name = 'shaft';
    const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 10, 48), new THREE.MeshBasicMaterial({ color: NEON, toneMapped: false }));
    frame.name = 'frame';
    const strings = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.75, 0.25), transparent: true, opacity: 0.22, side: THREE.DoubleSide, toneMapped: false }));
    strings.name = 'strings';
    this.racket.add(shaft, frame, strings);
    this.scene.add(this.racket);

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), new THREE.MeshBasicMaterial({ color: BALL, toneMapped: false }));
    this.ballLight = new THREE.PointLight(new THREE.Color('#e9ff6a'), 4, 3, 2);
    this.scene.add(this.ball, this.ballLight);

    // Red floor glow under the player, and a glow under each foot for the weight split.
    this.glow = this.floorGlow('255,60,50', 1.7, 0.4);
    this.footGlow = [this.floorGlow('212,240,76', 0.7, 1), this.floorGlow('212,240,76', 0.7, 1)];

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.3, 1.08);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setSize(width, height);
  }

  get canvas() {
    return this.renderer.domElement;
  }

  setSize(width: number, height: number) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width, height);
    this.camera.aspect = width / height;
    // Portrait frames need a wider vertical view to keep the court in.
    this.camera.fov = width < height ? 50 : 38;
    this.camera.updateProjectionMatrix();
  }

  private floorGlow(rgb: string, size: number, alpha: number) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.005;
    this.scene.add(m);
    return m;
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight('#c8d6ff', '#0b0d12', 0.55));
    const key = new THREE.DirectionalLight('#ffffff', 1.7);
    key.position.set(-4, 9, 18);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -4; sc.right = 4; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 40;
    key.target.position.set(1, 0, 12);
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight('#9fb8ff', 1.4);
    rim.position.set(3, 4, 0);
    this.scene.add(rim);
    const under = new THREE.PointLight('#ff3b30', 1.6, 2.5, 2);
    under.position.set(1, 0.3, 12.6);
    under.name = 'under';
    this.scene.add(under);
  }

  private buildCourt() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#0a0d13', roughness: 0.85, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(80, 80, '#1d2735', '#151c27');
    grid.position.y = 0.002;
    this.scene.add(grid);

    const lineMat = new THREE.MeshBasicMaterial({ color: LINE, toneMapped: false });
    const line = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.05, len), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(x1 - x0, z1 - z0);
      m.position.set((x0 + x1) / 2, 0.006, (z0 + z1) / 2);
      this.scene.add(m);
    };
    const L = COURT.length / 2, D = COURT.doubles / 2, S = COURT.singles / 2, V = COURT.service;
    line(-D, -L, -D, L); line(D, -L, D, L); line(-S, -L, -S, L); line(S, -L, S, L);
    line(-D, -L, D, -L); line(-D, L, D, L);
    line(-S, -V, S, -V); line(-S, V, S, V); line(0, -V, 0, V);
    line(0, L, 0, L - 0.15); line(0, -L, 0, -L + 0.15);

    // Net: posts, a glowing top band, and a faint mesh.
    const post = new THREE.MeshBasicMaterial({ color: LINE, toneMapped: false });
    for (const x of [-(D + 0.9), D + 0.9]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, COURT.netPost, 8), post);
      p.position.set(x, COURT.netPost / 2, 0);
      this.scene.add(p);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(COURT.doubles + 1.8, 0.05, 0.02), post);
    band.position.set(0, COURT.net, 0);
    this.scene.add(band);
    const pts: THREE.Vector3[] = [];
    const w = D + 0.9;
    for (let x = -w; x <= w + 1e-6; x += 0.25) pts.push(new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, COURT.net, 0));
    for (let y = 0; y <= COURT.net + 1e-6; y += 0.15) pts.push(new THREE.Vector3(-w, y, 0), new THREE.Vector3(w, y, 0));
    const mesh = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#8b97ab', transparent: true, opacity: 0.22 }));
    this.scene.add(mesh);
  }

  private spaceFor(input: SceneInput): { space: StrokeSpace; flight: BallFlight | null } {
    const st = input.stroke;
    if (!st) return { space: this.lastSpace ?? strokeSpace(input.frames, { startFrame: input.i, endFrame: input.i, contactFrame: input.i }, input.hand), flight: null };
    const key = `${st.startFrame}:${st.endFrame}:${st.contactFrame}:${st.type}`;
    let hit = this.spaces.get(st);
    if (!hit || hit.key !== key) {
      const space = strokeSpace(input.frames, st, input.hand);
      hit = { key, space, flight: ballFlight(input.frames, st, space, input.hand, st.type === 'serve') };
      this.spaces.set(st, hit);
    }
    this.lastSpace = hit.space;
    return hit;
  }

  /** Last frame's court transform, for placing labels. */
  private current: { w: Vec3[]; space: StrokeSpace } | null = null;

  /** Screen position (canvas pixels) of a pose world point in the last rendered frame. */
  project(p: Vec3): { x: number; y: number } | null {
    if (!this.current) return null;
    const v = v3(toCourt(p, this.current.space)).project(this.camera);
    if (v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * this.canvas.width, y: ((1 - v.y) / 2) * this.canvas.height };
  }

  /** Screen position of a callout anchor in the last rendered frame. */
  projectAnchor(anchor: AnchorJoint, hand: Handedness) {
    if (!this.current) return null;
    const w = this.current.w;
    const idx = anchorIndices(anchor, hand, deeperKnee(w));
    const p = idx.reduce((s, i) => ({ x: s.x + w[i].x / idx.length, y: s.y + w[i].y / idx.length, z: s.z + w[i].z / idx.length }), { x: 0, y: 0, z: 0 });
    return this.project(p);
  }

  render(input: SceneInput) {
    const w = input.frames[input.i]?.world;
    const { space, flight } = this.spaceFor(input);
    this.body.visible = !!w;
    this.racket.visible = !!w;
    this.current = w ? { w, space } : null;
    const P = (i: number) => v3(toCourt(w![i], space));
    if (w) this.pose(w, P, space, input.hand);

    // Camera behind and above the player, looking past them to the net.
    const o = space.origin;
    const yaw = input.orbit ?? 0;
    const back = 5.2, height = 2.6;
    this.camera.position.set(o.x + Math.sin(yaw) * back + 0.5, height, o.z + Math.cos(yaw) * back);
    this.camera.lookAt(o.x * 0.6, 0.15, o.z - 6.5);

    this.racketPath(input, space);
    this.ballAndTrail(input, flight);
    this.drawRings(input, P);
    this.weightGlow(input, P);
    (this.scene.getObjectByName('under') as THREE.PointLight).position.set(o.x, 0.3, o.z + 0.4);
    this.composer.render();
  }

  private pose(w: Vec3[], P: (i: number) => THREE.Vector3, space: StrokeSpace, hand: Handedness) {
    for (const s of this.segs) place(s.mesh, P(s.a), P(s.b));
    for (const j of this.joints) j.mesh.position.copy(P(j.i));
    const ls = P(11), rs = P(12), lh = P(23), rh = P(24);
    const sm = ls.clone().add(rs).multiplyScalar(0.5);
    const hm = lh.clone().add(rh).multiplyScalar(0.5);
    const up = sm.clone().sub(hm);
    const torso = up.length();
    const shoulderW = ls.distanceTo(rs);
    const hipW = lh.distanceTo(rh);
    orient(this.chest, sm.clone().lerp(hm, 0.3), rs.clone().sub(ls), up, new THREE.Vector3(Math.max(0.13, shoulderW * 0.47), torso * 0.34, 0.115));
    orient(this.belly, sm.clone().lerp(hm, 0.68), rh.clone().sub(lh).lerp(rs.clone().sub(ls), 0.5), up, new THREE.Vector3(Math.max(0.09, hipW * 0.5), torso * 0.22, 0.09));
    orient(this.pelvis, hm.clone().addScaledVector(up, 0.08 / Math.max(torso, 0.1)), rh.clone().sub(lh), up, new THREE.Vector3(Math.max(0.11, hipW * 0.62), 0.105, 0.11));
    const ears = P(7).add(P(8)).multiplyScalar(0.5);
    const headC = ears.clone().addScaledVector(up.clone().normalize(), 0.03);
    place(this.neck, sm.clone().addScaledVector(up.clone().normalize(), -0.02), headC.clone().lerp(sm, 0.35));
    orient(this.head, headC, P(8).sub(P(7)), headC.clone().sub(sm), new THREE.Vector3(0.088, 0.118, 0.1));
    // Hands from wrist toward the knuckles; feet from heel to toe.
    [[15, 19, 17], [16, 20, 18]].forEach(([wr, ix, pk], k) => {
      const a = P(wr);
      const tip = P(ix).add(P(pk)).multiplyScalar(0.5);
      const d = tip.clone().sub(a);
      if (d.length() < 0.02) d.set(0, -0.06, 0);
      d.setLength(0.085);
      orient(this.hands[k], a.clone().addScaledVector(d, 0.6), P(ix).sub(P(pk)), d, new THREE.Vector3(0.045, 0.07, 0.025));
    });
    [[29, 31], [30, 32]].forEach(([heel, toe], k) => {
      const a = P(heel), b = P(toe);
      const d = b.clone().sub(a);
      if (d.length() < 0.05) d.set(0, 0, -0.2);
      // x = up × toe direction, so the ellipsoid's long z axis points along the foot.
      const side = new THREE.Vector3().crossVectors(UP, d);
      orient(this.feet[k], a.clone().lerp(b, 0.55).setY(Math.max(0.045, (a.y + b.y) / 2)), side, UP, new THREE.Vector3(0.05, 0.045, Math.max(0.12, d.length() * 0.62)));
    });

    // Racket.
    const r = estimateRacket(w, hand);
    this.racket.visible = !!r;
    if (!r) return;
    const grip = v3(toCourt(r.grip, space));
    const head = v3(toCourt(r.head, space));
    const tip = v3(toCourt(r.tip, space));
    const dir = tip.clone().sub(grip).normalize();
    const shaft = this.racket.getObjectByName('shaft') as THREE.Mesh;
    place(shaft, grip, grip.clone().lerp(tip, 0.5));
    const face = r.face ? v3(toCourt({ x: r.grip.x + r.face.x, y: r.grip.y + r.face.y, z: r.grip.z + r.face.z }, space)).sub(grip).normalize() : new THREE.Vector3().crossVectors(dir, UP).normalize();
    const across = new THREE.Vector3().crossVectors(face, dir).normalize();
    const basis = new THREE.Matrix4().makeBasis(across, dir, face);
    for (const name of ['frame', 'strings']) {
      const m = this.racket.getObjectByName(name) as THREE.Mesh;
      m.position.copy(head);
      m.quaternion.setFromRotationMatrix(basis);
      m.scale.set(0.125, 0.165, name === 'frame' ? 0.15 : 1);
    }
  }

  private racketPath(input: SceneInput, space: StrokeSpace) {
    if (this.path) { this.scene.remove(this.path); this.path.geometry.dispose(); this.path = null; }
    const st = input.stroke;
    if (!st) return;
    const pts: THREE.Vector3[] = [];
    for (let i = st.startFrame; i <= Math.min(input.i, st.endFrame); i++) {
      const r = estimateRacket(input.frames[i]?.world ?? null, input.hand);
      if (r) pts.push(v3(toCourt(r.head, space)));
    }
    if (pts.length < 3) return;
    this.path = tube(pts, 0.018, NEON);
    this.scene.add(this.path);
  }

  private ballAndTrail(input: SceneInput, flight: BallFlight | null) {
    if (this.trail) { this.scene.remove(this.trail); this.trail.geometry.dispose(); this.trail = null; }
    const st = input.stroke;
    const t = st ? (input.i - st.contactFrame) / input.fps : 0;
    const now = input.ball !== false && flight ? flight.at(t) : null;
    this.ball.visible = !!now;
    this.ballLight.visible = !!now;
    if (!now || !flight) return;
    this.ball.position.copy(v3(now));
    this.ballLight.position.copy(this.ball.position);
    const pts: THREE.Vector3[] = [];
    for (let k = Math.max(-flight.before, t - 0.45); k <= t + 1e-6; k += 1 / 60) {
      const p = flight.at(k);
      if (p) pts.push(v3(p));
    }
    if (pts.length < 3) return;
    this.trail = tube(pts, 0.022, RED);
    this.scene.add(this.trail);
  }

  private drawRings(input: SceneInput, P: (i: number) => THREE.Vector3) {
    for (const m of this.ringMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.ringMeshes = [];
    const w = input.frames[input.i]?.world;
    if (!w || !input.rings) return;
    for (const r of input.rings) {
      const idx = anchorIndices(r.anchor, input.hand, deeperKnee(w));
      const c = idx.map(P).reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / idx.length);
      const big = r.anchor === 'shoulders' || r.anchor === 'hips';
      const m = new THREE.Mesh(new THREE.TorusGeometry(big ? 0.34 : 0.16, 0.012, 8, 64), new THREE.MeshBasicMaterial({ color: r.status === 'fix' ? RED : NEON, toneMapped: false }));
      m.position.copy(c);
      m.rotation.x = Math.PI / 2;
      this.scene.add(m);
      this.ringMeshes.push(m);
    }
  }

  private weightGlow(input: SceneInput, P: (i: number) => THREE.Vector3) {
    const w = input.frames[input.i]?.world;
    const share = shareAt(input.weight ?? null, input.i);
    this.glow.visible = !!w;
    if (w) {
      const com = v3(toCourt(centreOfMass(w), this.current!.space));
      this.glow.position.set(com.x, 0.004, com.z);
    }
    const wt = input.weight;
    this.footGlow.forEach((g, k) => {
      g.visible = !!(w && wt && share !== null);
      if (!g.visible) return;
      const ankle = P(k === 0 ? wt!.front : wt!.back);
      const amount = k === 0 ? share! : 1 - share!;
      g.position.set(ankle.x, 0.006, ankle.z);
      g.scale.setScalar(0.35 + 0.9 * amount);
      (g.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.75 * amount;
    });
  }

  dispose() {
    this.renderer.dispose();
    this.composer.dispose();
  }
}

/** Stretch a unit-height mesh (base at the origin, along +y) from a to b. */
function place(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  const len = Math.max(d.length(), 1e-4);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  m.scale.set(1, len, 1);
}

/** Place a unit sphere as an ellipsoid with the given side (x) and up (y) directions and radii. */
function orient(m: THREE.Object3D, centre: THREE.Vector3, side: THREE.Vector3, up: THREE.Vector3, radii: THREE.Vector3) {
  const y = up.clone().normalize();
  let x = side.clone().addScaledVector(y, -side.dot(y));
  if (x.lengthSq() < 1e-8) x = new THREE.Vector3(1, 0, 0);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  m.position.copy(centre);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  m.scale.copy(radii);
}

function tube(pts: THREE.Vector3[], r: number, color: THREE.Color) {
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(200, pts.length * 3), r, 8, false), new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity: 0.95 }));
}

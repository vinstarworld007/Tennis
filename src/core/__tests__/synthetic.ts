/**
 * Synthetic pose sequences for tests. A simple stick figure in world coordinates
 * (metres, hip centre at the origin, y down) follows key-framed wrist paths and body rotation.
 */
import type { Handedness, PoseFrame, Vec3 } from '../types';
import { LANDMARK_COUNT } from '../landmarks';

type V = [number, number, number]; // (right, forward, y) in the body's starting frame
interface Key { t: number; v: V }

export interface StrokeScript {
  duration: number;
  domWrist: Key[];
  nonWrist: Key[];
  shoulderYaw: Key[]; // degrees; positive turns the right shoulder back
  kneeForward?: Key[]; // knee pushed forward (m) = more bend
}

const lerpKeys = (keys: Key[], t: number): V => {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      let k = (t - a.t) / (b.t - a.t);
      k = k * k * (3 - 2 * k); // ease in and out
      return [0, 1, 2].map((j) => a.v[j] + (b.v[j] - a.v[j]) * k) as V;
    }
  }
  return keys[keys.length - 1].v;
};
const num = (keys: Key[], t: number) => lerpKeys(keys, t)[0];
export const k1 = (t: number, n: number): Key => ({ t, v: [n, 0, 0] });

// Person faces the camera: their right is image-left (-x), forward is -z.
const R0: Vec3 = { x: -1, y: 0, z: 0 };
const F0: Vec3 = { x: 0, y: 0, z: -1 };

const rot = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const R = { x: c * R0.x - s * F0.x, y: 0, z: c * R0.z - s * F0.z };
  const F = { x: s * R0.x + c * F0.x, y: 0, z: s * R0.z + c * F0.z };
  return { R, F };
};
const at = (v: V): Vec3 => ({ x: v[0] * R0.x + v[1] * F0.x, y: v[2], z: v[0] * R0.z + v[1] * F0.z });
const plus = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const minus = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3) => { const l = norm(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const dotp = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Two-bone IK: elbow between shoulder and wrist, bent toward `hint`. */
function elbowFor(s: Vec3, w: Vec3, hint: Vec3): Vec3 {
  const L1 = 0.3, L2 = 0.28;
  const d = Math.min(norm(minus(w, s)), L1 + L2 - 1e-3);
  const u = unit(minus(w, s));
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const p = unit(minus(hint, { x: u.x * dotp(hint, u), y: u.y * dotp(hint, u), z: u.z * dotp(hint, u) }));
  return plus(plus(s, u, a), p, h);
}

export function synthesize(script: StrokeScript, fps = 30, hand: Handedness = 'right'): PoseFrame[] {
  const frames: PoseFrame[] = [];
  const n = Math.round(script.duration * fps);
  const mirror = hand === 'left' ? -1 : 1;
  for (let i = 0; i <= n; i++) {
    const t = i / fps;
    const shYaw = num(script.shoulderYaw, t) * mirror;
    const sh = rot(shYaw);
    const hp = rot(shYaw * 0.5);
    const w: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
    const shoulderMid = { x: 0, y: -0.5, z: 0 };
    const rightShoulder = plus(shoulderMid, sh.R, 0.2);
    const leftShoulder = plus(shoulderMid, sh.R, -0.2);
    const rightHip = plus({ x: 0, y: 0, z: 0 }, hp.R, 0.15);
    const leftHip = plus({ x: 0, y: 0, z: 0 }, hp.R, -0.15);
    const mirrorV = (v: V): V => [v[0] * mirror, v[1], v[2]];
    const domW = at(mirrorV(lerpKeys(script.domWrist, t)));
    const nonW = at(mirrorV(lerpKeys(script.nonWrist, t)));
    const [domS, nonS] = hand === 'right' ? [rightShoulder, leftShoulder] : [leftShoulder, rightShoulder];
    const domSide = hand === 'right' ? sh.R : { x: -sh.R.x, y: 0, z: -sh.R.z };
    const down = { x: 0, y: 1, z: 0 };
    const domE = elbowFor(domS, domW, plus(down, domSide, 0.5));
    const nonE = elbowFor(nonS, nonW, plus(down, domSide, -0.5));
    const kneeF = script.kneeForward ? num(script.kneeForward, t) : 0.12;
    const set = (idx: number, p: Vec3) => { w[idx] = p; };
    set(0, plus(plus(shoulderMid, { x: 0, y: -0.25, z: 0 }), sh.F, 0.1));
    for (let e = 1; e <= 10; e++) set(e, w[0]);
    set(11, leftShoulder); set(12, rightShoulder);
    const [lE, rE, lW, rW] = hand === 'right' ? [nonE, domE, nonW, domW] : [domE, nonE, domW, nonW];
    set(13, lE); set(14, rE); set(15, lW); set(16, rW);
    for (const [idx, src] of [[17, 15], [19, 15], [21, 15], [18, 16], [20, 16], [22, 16]]) set(idx, w[src]);
    set(23, leftHip); set(24, rightHip);
    set(25, plus(plus(leftHip, down, 0.45), hp.F, kneeF)); set(26, plus(plus(rightHip, down, 0.45), hp.F, kneeF));
    set(27, plus(leftHip, down, 0.9)); set(28, plus(rightHip, down, 0.9));
    set(29, w[27]); set(31, plus(w[27], hp.F, 0.15)); set(30, w[28]); set(32, plus(w[28], hp.F, 0.15));
    const image = w.map((p) => ({ x: 0.5 + p.x * 0.3, y: 0.55 + p.y * 0.3, v: 1 }));
    frames.push({ t, world: w, image });
  }
  return frames;
}

export const FOREHAND: StrokeScript = {
  duration: 2.3,
  domWrist: [
    { t: 0, v: [0.25, 0.3, -0.1] }, { t: 0.3, v: [0.25, 0.3, -0.1] },
    { t: 1.0, v: [0.6, -0.5, -0.4] }, { t: 1.25, v: [0.6, -0.2, 0.1] },
    { t: 1.4, v: [0.45, 0.45, -0.2] }, { t: 1.7, v: [-0.3, 0.2, -0.75] }, { t: 2.3, v: [-0.3, 0.1, -0.6] },
  ],
  nonWrist: [{ t: 0, v: [0.1, 0.3, -0.1] }, { t: 1.0, v: [-0.2, 0.4, -0.35] }, { t: 2.3, v: [-0.3, 0.1, -0.2] }],
  shoulderYaw: [k1(0, 0), k1(0.3, 0), k1(1.0, 90), k1(1.6, -20), k1(2.3, -20)],
  kneeForward: [k1(0, 0.1), k1(1.0, 0.2), k1(1.6, 0.1)],
};

export const BACKHAND_1H: StrokeScript = {
  duration: 2.3,
  domWrist: [
    { t: 0, v: [0.0, 0.3, -0.1] }, { t: 0.3, v: [0.0, 0.3, -0.1] },
    { t: 1.0, v: [-0.6, -0.4, -0.4] }, { t: 1.25, v: [-0.55, -0.1, 0.05] },
    { t: 1.4, v: [-0.3, 0.6, -0.2] }, { t: 1.7, v: [0.5, 0.2, -0.8] }, { t: 2.3, v: [0.5, 0.1, -0.7] },
  ],
  nonWrist: [
    { t: 0, v: [0.0, 0.32, -0.12] }, { t: 0.3, v: [0.0, 0.32, -0.12] },
    { t: 1.0, v: [-0.55, -0.35, -0.4] }, { t: 1.25, v: [-0.6, -0.3, -0.2] }, { t: 1.4, v: [-0.6, -0.5, -0.3] }, { t: 2.3, v: [-0.6, -0.5, -0.3] },
  ],
  shoulderYaw: [k1(0, 0), k1(0.3, 0), k1(1.0, -110), k1(1.6, 0), k1(2.3, 0)],
};

export const SERVE: StrokeScript = {
  duration: 2.4,
  domWrist: [
    { t: 0, v: [0.25, 0.2, -0.1] }, { t: 0.3, v: [0.25, 0.2, -0.1] },
    { t: 0.9, v: [0.45, -0.15, -0.75] }, { t: 1.15, v: [0.3, -0.35, -0.3] },
    { t: 1.35, v: [0.2, 0.25, -1.45] }, { t: 1.8, v: [-0.35, 0.3, 0.1] }, { t: 2.4, v: [-0.35, 0.3, 0.1] },
  ],
  nonWrist: [
    { t: 0, v: [0.0, 0.3, -0.1] }, { t: 0.3, v: [0.0, 0.3, -0.1] },
    { t: 0.9, v: [-0.05, 0.3, -1.25] }, { t: 1.3, v: [-0.2, 0.2, -0.3] }, { t: 2.4, v: [-0.2, 0.2, -0.3] },
  ],
  shoulderYaw: [k1(0, 0), k1(0.9, 60), k1(1.35, 0), k1(1.8, -40), k1(2.4, -40)],
  kneeForward: [k1(0, 0.1), k1(0.9, 0.25), k1(1.35, 0.02)],
};

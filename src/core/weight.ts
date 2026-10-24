import type { Handedness, PoseFrame, Vec3 } from './types';
import { LM, sides } from './landmarks';

/**
 * Body segments as landmark groups with their share of body mass (after Dempster/Winter).
 * The centre of each segment is the average of its landmarks.
 */
const SEGMENTS: [number[], number][] = [
  [[LM.nose], 0.081],
  [[11, 12, 23, 24], 0.497],
  [[11, 13], 0.028], [[12, 14], 0.028],
  [[13, 15], 0.022], [[14, 16], 0.022],
  [[23, 25], 0.1], [[24, 26], 0.1],
  [[25, 27], 0.0465], [[26, 28], 0.0465],
  [[27, 31], 0.0145], [[28, 32], 0.0145],
];

/** Estimated centre of mass from 33 landmarks (world or image; image points have no z). */
export function centreOfMass(pts: { x: number; y: number; z?: number }[]): Vec3 {
  let x = 0, y = 0, z = 0, m = 0;
  for (const [idx, mass] of SEGMENTS) {
    for (const i of idx) {
      const p = pts[i];
      const k = mass / idx.length;
      x += p.x * k; y += p.y * k; z += (p.z ?? 0) * k; m += k;
    }
  }
  return { x: x / m, y: y / m, z: z / m };
}

export interface WeightTransfer {
  /** Ankle landmark of the front foot (toward the shot) and of the back foot. */
  front: number;
  back: number;
  /** First frame of `share`. */
  from: number;
  /** Share of weight over the front foot, 0..1, per frame from `from`; null where unknown. */
  share: (number | null)[];
}

/**
 * Where the weight sits between the feet across a stroke. The centre of mass is projected onto
 * the ground line between the ankles: 0 is over the back foot, 1 over the front foot.
 * The front foot is the one further along the hitting hand's direction at contact.
 */
export function weightTransfer(
  frames: PoseFrame[],
  stroke: { startFrame: number; endFrame: number; contactFrame: number },
  hand: Handedness,
): WeightTransfer | null {
  const { dom } = sides(hand);
  const c = stroke.contactFrame;
  const a = frames[Math.max(stroke.startFrame, c - 2)]?.world;
  const b = frames[Math.min(stroke.endFrame, c + 2)]?.world;
  const at = frames[c]?.world;
  if (!a || !b || !at) return null;
  const dir = { x: b[dom.wrist].x - a[dom.wrist].x, z: b[dom.wrist].z - a[dom.wrist].z };
  const along = (p: Vec3) => p.x * dir.x + p.z * dir.z;
  const [front, back] = along(at[LM.leftAnkle]) >= along(at[LM.rightAnkle]) ? [LM.leftAnkle, LM.rightAnkle] : [LM.rightAnkle, LM.leftAnkle];
  const share: (number | null)[] = [];
  for (let i = stroke.startFrame; i <= stroke.endFrame; i++) {
    const w = frames[i]?.world;
    share.push(w ? frontShare(w, front, back) : null);
  }
  return { front, back, from: stroke.startFrame, share };
}

/** Share of weight over `front`, from the centre of mass projected on the back→front ankle line. */
export function frontShare(w: Vec3[], front: number, back: number): number | null {
  const f = w[front];
  const bk = w[back];
  const lx = f.x - bk.x;
  const lz = f.z - bk.z;
  const l2 = lx * lx + lz * lz;
  if (l2 < 0.15 * 0.15) return null; // feet together: no meaningful split
  const com = centreOfMass(w);
  const s = ((com.x - bk.x) * lx + (com.z - bk.z) * lz) / l2;
  return Math.max(0, Math.min(1, s));
}

/** Weight share at a frame, or null outside the stroke. */
export function shareAt(wt: WeightTransfer | null, i: number): number | null {
  if (!wt) return null;
  return wt.share[i - wt.from] ?? null;
}

/** The lowest share up to `upTo` and the highest share from there to the end: the load and the drive. */
export function transferSummary(wt: WeightTransfer | null, upTo: number): { load: number; drive: number } | null {
  if (!wt) return null;
  const pre = wt.share.slice(0, upTo - wt.from + 1).filter((x): x is number => x !== null);
  const post = wt.share.slice(Math.max(0, upTo - wt.from)).filter((x): x is number => x !== null);
  if (!pre.length || !post.length) return null;
  return { load: Math.min(...pre), drive: Math.max(...post) };
}

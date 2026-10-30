import type { Handedness, PoseFrame, Vec3 } from './types';
import { sides } from './landmarks';
import { estimateRacket } from './racket';

/**
 * Placing a stroke on a virtual court. Pose world landmarks are metres around the hips with
 * y down; the scene is metres with y up, the net along x at z = 0 and the player's baseline at
 * z = +11.885, so the player hits toward −z.
 */

export const COURT = { length: 23.77, doubles: 10.97, singles: 8.23, service: 6.4, netPost: 0.914 + 0.153, net: 0.914 };

/** How one stroke is placed on the court. */
export interface StrokeSpace {
  /** Rotation about the vertical axis (radians) that turns the swing direction toward the net. */
  yaw: number;
  /** Pose y of the floor (the lowest foot at the start of the stroke). */
  floor: number;
  /** Where the hips stand on the court. */
  origin: Vec3;
}

/** Player's spot: just behind the baseline, a little to the deuce side, like a rally or a serve. */
export const PLAYER_SPOT: Vec3 = { x: 0.9, y: 0, z: COURT.length / 2 + 0.4 };

const FEET = [27, 28, 29, 30, 31, 32];

/**
 * The swing direction at contact (the hitting hand's movement over the ground) is where the ball
 * goes, so it is turned to face the net. The floor is the lowest foot at the start of the stroke.
 */
export function strokeSpace(frames: PoseFrame[], stroke: { startFrame: number; endFrame: number; contactFrame: number }, hand: Handedness): StrokeSpace {
  const { dom } = sides(hand);
  const c = stroke.contactFrame;
  const a = frames[Math.max(stroke.startFrame, c - 2)]?.world;
  const b = frames[Math.min(stroke.endFrame, c + 2)]?.world;
  // Default: swinging away from the camera, as when filmed from behind.
  let dx = 0, dz = 1;
  if (a && b) {
    const vx = b[dom.wrist].x - a[dom.wrist].x;
    const vz = b[dom.wrist].z - a[dom.wrist].z;
    if (Math.hypot(vx, vz) > 0.05) { dx = vx; dz = vz; }
  }
  // In scene axes the swing is (dx, −dz); turn it to (0, −1).
  const yaw = Math.atan2(-dx, dz);
  const first = frames[stroke.startFrame]?.world ?? frames.find((f) => f.world)?.world;
  const floor = first ? Math.max(...FEET.map((i) => first[i].y)) : 0.9;
  return { yaw, floor, origin: PLAYER_SPOT };
}

/** A pose world point in court coordinates. */
export function toCourt(p: Vec3, s: StrokeSpace): Vec3 {
  const x = p.x;
  const z = -p.z;
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  return { x: s.origin.x + x * c - z * n, y: s.floor - p.y, z: s.origin.z + x * n + z * c };
}

/** Quadratic Bézier point. */
const bez = (a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 => {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z };
};

export interface BallFlight {
  contact: Vec3;
  /** Ball position `t` seconds from contact (negative before), or null when out of the shown flight. */
  at(t: number): Vec3 | null;
  /** Seconds the flight is shown before and after contact. */
  before: number;
  after: number;
}

/**
 * An illustrative ball flight in court coordinates, built around the measured contact point:
 * the ball arrives (a toss for serves, a bounce for groundstrokes), meets the racket at contact,
 * and leaves toward the opponent's court. One camera cannot measure the ball's depth, so only
 * the contact point and the swing direction come from the video.
 */
export function ballFlight(frames: PoseFrame[], stroke: { startFrame: number; endFrame: number; contactFrame: number }, s: StrokeSpace, hand: Handedness, serve: boolean): BallFlight | null {
  const r = estimateRacket(frames[stroke.contactFrame]?.world ?? null, hand);
  if (!r) return null;
  const C = toCourt(r.head, s);
  const before = serve ? 1.1 : 0.9;
  const after = 1.0;
  const land: Vec3 = { x: C.x * 0.4 - 0.8, y: 0, z: serve ? -COURT.service + 0.6 : -8.5 };
  const outCtrl: Vec3 = { x: (C.x + land.x) / 2, y: Math.max(C.y, 1) + (serve ? 0.4 : 1.6), z: (C.z + land.z) / 2 };
  let incoming: (t: number) => Vec3;
  if (serve) {
    const { non } = sides(hand);
    const release = frames[stroke.startFrame]?.world;
    const T = release ? toCourt(release[non.wrist], s) : { ...C, y: 1.2 };
    const peak: Vec3 = { x: C.x, y: C.y + 0.9, z: C.z };
    incoming = (k) => bez(T, { x: (T.x + C.x) / 2, y: peak.y + 0.7, z: (T.z + C.z) / 2 }, C, k);
  } else {
    const A: Vec3 = { x: -2.5, y: 1.0, z: -COURT.length / 2 };
    const B: Vec3 = { x: C.x - 0.3, y: 0, z: C.z - 4 };
    incoming = (k) => (k < 0.65 ? bez(A, { x: (A.x + B.x) / 2, y: 2.4, z: (A.z + B.z) / 2 }, B, k / 0.65) : bez(B, { x: (B.x + C.x) / 2, y: C.y + 0.6, z: (B.z + C.z) / 2 }, C, (k - 0.65) / 0.35));
  }
  return {
    contact: C,
    before,
    after,
    at(t) {
      if (t < -before || t > after) return null;
      return t <= 0 ? incoming(1 + t / before) : bez(C, outCtrl, land, t / after);
    },
  };
}

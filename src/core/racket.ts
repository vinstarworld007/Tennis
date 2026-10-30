import type { Handedness, Vec3 } from './types';
import { add, len, scale, sub } from './geometry';
import { sides } from './landmarks';

/** Index-finger and pinky knuckle landmarks for each wrist (MediaPipe numbering). */
const KNUCKLES: Record<number, { index: number; pinky: number }> = { 15: { index: 19, pinky: 17 }, 16: { index: 20, pinky: 18 } };

/** A tennis racket is about 0.68 m long; the strings span the outer half. */
export const RACKET_LENGTH = 0.68;

export interface RacketPose {
  grip: Vec3;
  /** Centre of the strings. */
  head: Vec3;
  tip: Vec3;
  /** Unit vector along the shaft, grip to tip. */
  dir: Vec3;
  /** Unit vector out of the string face (the palm's normal), when the knuckles are known. */
  face: Vec3 | null;
}

const unit = (v: Vec3) => {
  const l = len(v);
  return l < 1e-6 ? null : scale(v, 1 / l);
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/**
 * Estimated racket from the hitting arm's world landmarks (metres), until a racket detector is added:
 * the shaft continues the hand direction (wrist → knuckles) blended with the forearm, and the
 * string face is taken to be parallel to the palm.
 */
export function estimateRacket(w: Vec3[] | null, hand: Handedness): RacketPose | null {
  if (!w) return null;
  const { dom } = sides(hand);
  const wrist = w[dom.wrist];
  const fore = unit(sub(wrist, w[dom.elbow]));
  if (!fore) return null;
  const k = KNUCKLES[dom.wrist];
  const knuckles = scale(add(w[k.index], w[k.pinky]), 0.5);
  const handDir = unit(sub(knuckles, wrist));
  const dir = (handDir && unit(add(scale(handDir, 0.6), scale(fore, 0.4)))) || fore;
  const palm = unit(cross(sub(w[k.index], wrist), sub(w[k.pinky], wrist)));
  return {
    grip: wrist,
    head: add(wrist, scale(dir, RACKET_LENGTH * 0.72)),
    tip: add(wrist, scale(dir, RACKET_LENGTH)),
    dir,
    face: palm,
  };
}

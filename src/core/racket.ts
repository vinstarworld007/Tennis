import type { Handedness, ImagePoint, Vec2 } from './types';
import { sides } from './landmarks';

/** Index-finger knuckle landmarks (MediaPipe 19 left, 20 right). */
const INDEX = { 15: 19, 16: 20 } as Record<number, number>;

export interface RacketPose {
  grip: Vec2;
  /** Centre of the strings. */
  head: Vec2;
  tip: Vec2;
  /** Shaft direction in image-normalised units (x already divided by aspect). */
  angle: number;
}

/**
 * Estimated racket position from the hitting arm, until a racket detector is added:
 * the shaft continues the hand direction (wrist → index knuckle) blended with the forearm,
 * and is about 2.5 forearm lengths long. `aspect` is video width / height.
 */
export function estimateRacket(pts: ImagePoint[] | null, hand: Handedness, aspect: number): RacketPose | null {
  if (!pts) return null;
  const { dom } = sides(hand);
  const e = pts[dom.elbow];
  const w = pts[dom.wrist];
  const k = pts[INDEX[dom.wrist]];
  if (!e || !w || e.v < 0.3 || w.v < 0.3) return null;
  // Work in square units: x scaled by aspect.
  const fx = (w.x - e.x) * aspect;
  const fy = w.y - e.y;
  const fl = Math.hypot(fx, fy);
  if (fl < 1e-4) return null;
  let dx = fx / fl;
  let dy = fy / fl;
  if (k && k.v > 0.3) {
    const hx = (k.x - w.x) * aspect;
    const hy = k.y - w.y;
    const hl = Math.hypot(hx, hy);
    if (hl > 1e-4) {
      dx = 0.6 * (hx / hl) + 0.4 * dx;
      dy = 0.6 * (hy / hl) + 0.4 * dy;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
    }
  }
  const L = fl * 2.5;
  const at = (t: number): Vec2 => ({ x: w.x + (dx * L * t) / aspect, y: w.y + dy * L * t });
  return { grip: { x: w.x, y: w.y }, head: at(0.72), tip: at(1), angle: Math.atan2(dy, dx) };
}

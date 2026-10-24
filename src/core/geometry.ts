import type { Vec3 } from './types';

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const mid = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));

const DEG = 180 / Math.PI;

/** Angle at joint b formed by a-b-c, in degrees (180 = straight). */
export function jointAngle(a: Vec3, b: Vec3, c: Vec3): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const d = len(u) * len(v);
  if (d === 0) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / d))) * DEG;
}

/** Heading of the a→b line in the ground plane (x, z), in degrees. */
export function yaw(a: Vec3, b: Vec3): number {
  return Math.atan2(b.z - a.z, b.x - a.x) * DEG;
}

/** Smallest absolute difference between two headings, 0..180. */
export function headingDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Continues a heading series without the jump at ±180°, so a rotation past 180° keeps counting. */
export function unwrap(prev: number, next: number): number {
  let d = next - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return prev + d;
}

/** Unit vector in the ground plane. */
export function flatUnit(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.z);
  return l === 0 ? { x: 0, y: 0, z: 0 } : { x: v.x / l, y: 0, z: v.z / l };
}

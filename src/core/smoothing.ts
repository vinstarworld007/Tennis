import type { PoseFrame, Vec3 } from './types';
import { LANDMARK_COUNT } from './landmarks';

/**
 * Fill short gaps (up to `maxGap` frames) in world landmarks by linear interpolation,
 * then smooth with a centred moving average. Image landmarks are interpolated the same way.
 */
export function cleanFrames(frames: PoseFrame[], maxGap = 6, window = 2): PoseFrame[] {
  const out = frames.map((f) => ({ ...f, world: f.world?.map((p) => ({ ...p })) ?? null, image: f.image?.map((p) => ({ ...p })) ?? null }));
  // Interpolate gaps.
  let last = -1;
  for (let i = 0; i < out.length; i++) {
    if (!out[i].world) continue;
    if (last >= 0 && i - last > 1 && i - last - 1 <= maxGap) {
      for (let g = last + 1; g < i; g++) {
        const k = (g - last) / (i - last);
        out[g].world = lerpPoints(out[last].world!, out[i].world!, k);
        if (out[last].image && out[i].image) {
          out[g].image = lerpPoints(out[last].image!, out[i].image!, k).map((p, j) => ({ ...p, v: Math.min(out[last].image![j].v, out[i].image![j].v) }));
        }
      }
    }
    last = i;
  }
  if (window <= 0) return out;
  // Moving average over available neighbours (world only; image stays faithful to the video).
  const smoothed = out.map((f, i) => {
    if (!f.world) return f;
    const acc: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
    let n = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(out.length - 1, i + window); j++) {
      const w = out[j].world;
      if (!w) continue;
      for (let k = 0; k < LANDMARK_COUNT; k++) {
        acc[k].x += w[k].x; acc[k].y += w[k].y; acc[k].z += w[k].z;
      }
      n++;
    }
    return { ...f, world: acc.map((p) => ({ x: p.x / n, y: p.y / n, z: p.z / n })) };
  });
  return smoothed;
}

function lerpPoints<T extends { x: number; y: number; z?: number; v?: number }>(a: T[], b: T[], k: number): T[] {
  return a.map((p, j) => {
    const q = b[j];
    const r: any = { ...p, x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    if (p.z !== undefined && q.z !== undefined) r.z = p.z + (q.z - p.z) * k;
    return r as T;
  });
}

/** Centred moving average of a numeric series, ignoring NaN. */
export function smoothSeries(xs: number[], window = 2): number[] {
  return xs.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(xs.length - 1, i + window); j++) {
      if (!Number.isNaN(xs[j])) { s += xs[j]; n++; }
    }
    return n ? s / n : NaN;
  });
}

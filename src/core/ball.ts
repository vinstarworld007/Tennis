/**
 * Ball tracking from per-frame candidates. Detection (in src/render/ballDetect.ts) finds small
 * moving ball-coloured blobs; this links them into flight paths and drops everything that does
 * not move like a ball (still balls on the court, logos, clothing).
 */

/** A possible ball in one frame; x/y normalised to 0..1 of the video frame. */
export interface BallCandidate {
  x: number;
  y: number;
  score: number;
}

export interface BallPoint {
  x: number;
  y: number;
  /** True when filled in between two detections. */
  interpolated?: boolean;
}

/** Ball positions for a run of frames starting at `from`. */
export interface BallTrack {
  from: number;
  points: (BallPoint | null)[];
}

export interface TrackOptions {
  /** Video width / height, so distances are measured in square pixels. */
  aspect?: number;
  /** Largest move between frames, as a fraction of frame height. */
  maxStep?: number;
  /** Frames a track may go unseen (behind the player, motion blur) and still continue. */
  maxGap?: number;
  /** Shortest track kept, in detections. */
  minLength?: number;
  /** Slowest median speed for a real ball in flight, fraction of frame height per frame. */
  minSpeed?: number;
}

interface Tracklet {
  frames: number[];
  pts: BallCandidate[];
  score: number;
}

const DEFAULTS: Required<TrackOptions> = { aspect: 16 / 9, maxStep: 0.2, maxGap: 4, minLength: 4, minSpeed: 0.004 };

export function trackBall(cands: BallCandidate[][], from = 0, options: TrackOptions = {}): BallTrack {
  const o = { ...DEFAULTS, ...options };
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * o.aspect, a.y - b.y);

  // 1. Link candidates frame to frame, predicting with constant velocity.
  const active: Tracklet[] = [];
  const done: Tracklet[] = [];
  for (let f = 0; f < cands.length; f++) {
    const free = new Set(cands[f].map((_, i) => i));
    // Longest tracklets pick first, so a real flight path is not stolen by noise.
    active.sort((a, b) => b.frames.length - a.frames.length);
    for (const t of active) {
      const n = t.frames.length;
      const last = t.pts[n - 1];
      const gap = f - t.frames[n - 1];
      // A single sighting is weak evidence: only continue it from the next frame or two.
      if (n === 1 && gap > 2) continue;
      let pred = last;
      if (n >= 2) {
        const prev = t.pts[n - 2];
        const dt = t.frames[n - 1] - t.frames[n - 2];
        pred = { x: last.x + ((last.x - prev.x) / dt) * gap, y: last.y + ((last.y - prev.y) / dt) * gap, score: 0 };
      }
      let best = -1;
      let bestD = Infinity;
      for (const i of free) {
        const di = d(cands[f][i], pred);
        const gate = n >= 2 ? o.maxStep * 0.6 * gap : o.maxStep * gap;
        if (di <= gate && di < bestD) { best = i; bestD = di; }
      }
      if (best >= 0) {
        free.delete(best);
        t.frames.push(f);
        t.pts.push(cands[f][best]);
        t.score += cands[f][best].score;
      }
    }
    for (let k = active.length - 1; k >= 0; k--) {
      const t = active[k];
      if (f - t.frames[t.frames.length - 1] > o.maxGap) { done.push(t); active.splice(k, 1); }
    }
    for (const i of free) active.push({ frames: [f], pts: [cands[f][i]], score: cands[f][i].score });
  }
  done.push(...active);

  // 2. Keep tracklets that move like a ball in flight.
  const good = done.filter((t) => {
    if (t.frames.length < o.minLength) return false;
    const speeds: number[] = [];
    for (let i = 1; i < t.pts.length; i++) speeds.push(d(t.pts[i], t.pts[i - 1]) / (t.frames[i] - t.frames[i - 1]));
    speeds.sort((a, b) => a - b);
    return speeds[Math.floor(speeds.length / 2)] >= o.minSpeed;
  });

  // 3. Choose the best tracklets that do not overlap in time.
  good.sort((a, b) => b.score - a.score);
  const taken: (number | null)[] = cands.map(() => null);
  const chosen: Tracklet[] = [];
  for (const t of good) {
    const lo = t.frames[0];
    const hi = t.frames[t.frames.length - 1];
    let clash = false;
    for (let f = lo; f <= hi && !clash; f++) clash = taken[f] !== null;
    if (clash) continue;
    for (let f = lo; f <= hi; f++) taken[f] = chosen.length;
    chosen.push(t);
  }

  // 4. Write points, filling gaps inside a tracklet by interpolation.
  const points: (BallPoint | null)[] = cands.map(() => null);
  for (const t of chosen) {
    for (let i = 0; i < t.frames.length; i++) {
      points[t.frames[i]] = { x: t.pts[i].x, y: t.pts[i].y };
      if (i === 0) continue;
      const f0 = t.frames[i - 1];
      const f1 = t.frames[i];
      for (let g = f0 + 1; g < f1; g++) {
        const k = (g - f0) / (f1 - f0);
        points[g] = { x: t.pts[i - 1].x + (t.pts[i].x - t.pts[i - 1].x) * k, y: t.pts[i - 1].y + (t.pts[i].y - t.pts[i - 1].y) * k, interpolated: true };
      }
    }
  }
  return { from, points };
}

export function ballAt(track: BallTrack | null | undefined, frame: number): BallPoint | null {
  if (!track) return null;
  return track.points[frame - track.from] ?? null;
}

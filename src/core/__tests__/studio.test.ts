import { describe, expect, it } from 'vitest';
import { ballAt, estimateRacket, frontShare, LANDMARK_COUNT, trackBall, transferSummary, weightTransfer, type BallCandidate, type ImagePoint, type PoseFrame, type Vec3 } from '../index';

describe('ball tracking', () => {
  // A ball crossing the frame on an arc, missed for two frames, plus a still ball and random noise.
  const n = 30;
  const truth = (f: number) => ({ x: 0.1 + f * 0.025, y: 0.6 - f * 0.02 + f * f * 0.0008 });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cands: BallCandidate[][] = [];
  for (let f = 0; f < n; f++) {
    const c: BallCandidate[] = [{ x: 0.85, y: 0.9, score: 0.9 }]; // still ball on the court
    if (f !== 12 && f !== 13) c.push({ ...truth(f), score: 0.8 });
    if (rnd() < 0.5) c.push({ x: rnd(), y: rnd(), score: 0.6 });
    cands.push(c);
  }
  const track = trackBall(cands, 100);

  it('follows the flight and fills the short gap', () => {
    let found = 0;
    for (let f = 0; f < n; f++) {
      const p = ballAt(track, 100 + f);
      if (!p) continue;
      found++;
      expect(Math.hypot(p.x - truth(f).x, p.y - truth(f).y)).toBeLessThan(0.02);
    }
    expect(found).toBeGreaterThanOrEqual(n - 2);
    expect(ballAt(track, 112)?.interpolated).toBe(true);
  });
  it('ignores a ball that is not moving', () => {
    const still = track.points.map((p, f) => (p?.x === 0.85 ? f : -1)).filter((f) => f >= 0);
    expect(still).toEqual([]);
  });
});

/** A standing figure (world metres, y down) with the feet apart along x and the body leaning by `lean`. */
function figure(lean: number): Vec3[] {
  const w: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: lean, y: -0.4, z: 0 }));
  const set = (i: number, x: number, y: number) => { w[i] = { x, y, z: 0 }; };
  set(27, -0.4, 0.9); set(31, -0.3, 0.95); // left ankle and foot
  set(28, 0.4, 0.9); set(32, 0.5, 0.95); // right ankle and foot
  set(25, -0.25 + lean / 2, 0.45); set(26, 0.25 + lean / 2, 0.45);
  return w;
}

describe('weight transfer', () => {
  it('reads the centre of mass between the feet', () => {
    expect(frontShare(figure(0.3), 28, 27)!).toBeGreaterThan(0.7);
    expect(frontShare(figure(-0.3), 28, 27)!).toBeLessThan(0.3);
  });
  it('picks the front foot from the swing direction and follows the shift', () => {
    // Weight moves from the left foot to the right while the right wrist swings toward +x.
    const frames: PoseFrame[] = [];
    for (let i = 0; i <= 20; i++) {
      const w = figure(-0.3 + (0.6 * i) / 20);
      w[16] = { x: -0.5 + i * 0.05, y: -0.3, z: 0 };
      frames.push({ t: i / 30, world: w, image: null });
    }
    const wt = weightTransfer(frames, { startFrame: 0, endFrame: 20, contactFrame: 12 }, 'right')!;
    expect(wt.front).toBe(28);
    const sum = transferSummary(wt, 12)!;
    expect(sum.load).toBeLessThan(0.3);
    expect(sum.drive).toBeGreaterThan(0.7);
  });
});

describe('racket estimate', () => {
  it('extends the hand direction from the wrist', () => {
    const pts: ImagePoint[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, v: 0 }));
    pts[14] = { x: 0.4, y: 0.5, v: 1 }; // right elbow
    pts[16] = { x: 0.5, y: 0.5, v: 1 }; // right wrist
    pts[20] = { x: 0.52, y: 0.5, v: 1 }; // right index knuckle
    const r = estimateRacket(pts, 'right', 1)!;
    expect(r.tip.x).toBeCloseTo(0.75);
    expect(r.tip.y).toBeCloseTo(0.5);
    expect(r.head.x).toBeGreaterThan(0.6);
  });
});

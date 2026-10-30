import { describe, expect, it } from 'vitest';
import { ballFlight, estimateRacket, frontShare, LANDMARK_COUNT, RACKET_LENGTH, strokeSpace, toCourt, transferSummary, weightTransfer, type PoseFrame, type Vec3 } from '../index';

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
  it('extends the hand direction from the wrist by a racket length', () => {
    const w: Vec3[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
    w[14] = { x: 0.2, y: 0, z: 0 }; // right elbow
    w[16] = { x: 0.45, y: 0, z: 0 }; // right wrist
    w[18] = { x: 0.53, y: 0, z: -0.02 }; // right pinky knuckle
    w[20] = { x: 0.53, y: 0, z: 0.02 }; // right index knuckle
    const r = estimateRacket(w, 'right')!;
    expect(r.tip.x).toBeCloseTo(0.45 + RACKET_LENGTH);
    expect(r.tip.y).toBeCloseTo(0);
    expect(Math.abs(r.face!.y)).toBeCloseTo(1);
  });
});

describe('court placement', () => {
  it('turns the swing toward the net and stands the feet on the floor', () => {
    // Right wrist swings toward +x in pose space through contact.
    const frames: PoseFrame[] = [];
    for (let i = 0; i <= 10; i++) {
      const w = figure(0);
      w[16] = { x: -0.5 + i * 0.1, y: -0.3, z: 0 };
      frames.push({ t: i / 30, world: w, image: null });
    }
    const s = strokeSpace(frames, { startFrame: 0, endFrame: 10, contactFrame: 5 }, 'right');
    const a = toCourt(frames[3].world![16], s);
    const b = toCourt(frames[7].world![16], s);
    expect(b.z - a.z).toBeLessThan(-0.3);
    expect(Math.abs(b.x - a.x)).toBeLessThan(1e-6);
    expect(toCourt(frames[0].world![31], s).y).toBeCloseTo(0);
    expect(toCourt(frames[0].world![0], s).y).toBeGreaterThan(1);
  });
  it('draws a flight that meets the racket at contact and lands across the net', () => {
    const frames: PoseFrame[] = [];
    for (let i = 0; i <= 10; i++) {
      const w = figure(0);
      w[14] = { x: -0.6 + i * 0.1, y: -0.3, z: 0 };
      w[16] = { x: -0.4 + i * 0.1, y: -0.3, z: 0 };
      frames.push({ t: i / 30, world: w, image: null });
    }
    const st = { startFrame: 0, endFrame: 10, contactFrame: 5 };
    const s = strokeSpace(frames, st, 'right');
    const f = ballFlight(frames, st, s, 'right', false)!;
    expect(f.at(0)!.z).toBeCloseTo(f.contact.z);
    expect(f.at(f.after)!.z).toBeLessThan(0);
    expect(f.at(f.after)!.y).toBeCloseTo(0);
    expect(f.at(f.after + 0.1)).toBeNull();
  });
});

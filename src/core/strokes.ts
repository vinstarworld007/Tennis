import type { Handedness, PoseFrame, StrokeType } from './types';
import { sides } from './landmarks';
import { dist, dot, sub } from './geometry';
import { bodyAxes, measure } from './metrics';
import { smoothSeries } from './smoothing';

/** Hitting-wrist speed relative to the hips (m/s), smoothed. NaN where the pose is missing. */
export function wristSpeed(frames: PoseFrame[], fps: number, hand: Handedness): number[] {
  const { dom } = sides(hand);
  const raw = frames.map((_, i) => {
    const a = frames[i - 1]?.world;
    const b = frames[i + 1]?.world;
    if (!a || !b) return NaN;
    const ra = sub(a[dom.wrist], hipMidOf(a));
    const rb = sub(b[dom.wrist], hipMidOf(b));
    return (dist(ra, rb) * fps) / 2;
  });
  return smoothSeries(raw, 1);
}

function hipMidOf(w: { x: number; y: number; z: number }[]) {
  return { x: (w[23].x + w[24].x) / 2, y: (w[23].y + w[24].y) / 2, z: (w[23].z + w[24].z) / 2 };
}

export interface StrokeWindow {
  start: number;
  end: number;
  contact: number;
  peakSpeed: number;
}

export interface DetectOptions {
  /** Minimum peak wrist speed to count as a swing (m/s). */
  minPeak?: number;
  /** Peaks must also reach this share of the clip's fastest swing. */
  relativePeak?: number;
  /** Minimum time between two contacts (s). */
  minGap?: number;
  before?: number;
  after?: number;
}

/** Find swings as peaks in hitting-wrist speed; the peak frame is the contact estimate. */
export function detectStrokes(frames: PoseFrame[], fps: number, hand: Handedness, opts: DetectOptions = {}): StrokeWindow[] {
  const { minPeak = 2.0, relativePeak = 0.35, minGap = 1.0, before = 1.4, after = 0.9 } = opts;
  const sp = wristSpeed(frames, fps, hand);
  const max = Math.max(0, ...sp.filter((v) => !Number.isNaN(v)));
  const threshold = Math.max(minPeak, relativePeak * max);
  const peaks: number[] = [];
  for (let i = 1; i < sp.length - 1; i++) {
    const v = sp[i];
    if (Number.isNaN(v) || v < threshold) continue;
    if (v >= (sp[i - 1] || 0) && v > (sp[i + 1] || 0)) peaks.push(i);
  }
  // Keep the strongest peak within each minGap window.
  peaks.sort((a, b) => sp[b] - sp[a]);
  const kept: number[] = [];
  for (const p of peaks) if (kept.every((k) => Math.abs(k - p) >= minGap * fps)) kept.push(p);
  kept.sort((a, b) => a - b);

  const out: StrokeWindow[] = [];
  kept.forEach((c, idx) => {
    let start = Math.max(0, c - Math.round(before * fps));
    let end = Math.min(frames.length - 1, c + Math.round(after * fps));
    const prev = kept[idx - 1];
    const next = kept[idx + 1];
    if (prev !== undefined) start = Math.max(start, Math.ceil((prev + c) / 2));
    if (next !== undefined) end = Math.min(end, Math.floor((c + next) / 2));
    out.push({ start, end, contact: c, peakSpeed: sp[c] });
  });
  return out;
}

/** Window around a hand-marked contact frame. */
export function windowAt(frames: PoseFrame[], fps: number, contact: number, before = 1.4, after = 0.9): StrokeWindow {
  return {
    start: Math.max(0, contact - Math.round(before * fps)),
    end: Math.min(frames.length - 1, contact + Math.round(after * fps)),
    contact,
    peakSpeed: NaN,
  };
}

/** Frame in [from, to) where the hitting wrist is furthest behind the hips, along the contact-frame facing. */
export function backswingFrame(frames: PoseFrame[], from: number, to: number, contact: number, hand: Handedness): number {
  const wc = frames[contact]?.world;
  if (!wc) return Math.round((from + to) / 2);
  const fwd = bodyAxes(wc, hand).forward;
  const { dom } = sides(hand);
  let best = -1;
  let bestV = Infinity;
  for (let i = from; i < to; i++) {
    const w = frames[i].world;
    if (!w) continue;
    const v = dot(sub(w[dom.wrist], bodyAxes(w, hand).hipMid), fwd);
    if (v < bestV) { bestV = v; best = i; }
  }
  return best < 0 ? Math.round((from + to) / 2) : best;
}

export function classifyStroke(frames: PoseFrame[], win: StrokeWindow, hand: Handedness, yawSeries: number[]): StrokeType {
  const { start, contact } = win;
  const atContact = measure(frames, contact, start, hand, yawSeries);
  if (atContact.contactHeight === undefined) return 'unknown';
  let tossUp = -Infinity;
  for (let i = start; i <= contact; i++) {
    const m = measure(frames, i, start, hand, yawSeries);
    if (m.tossArmUp !== undefined) tossUp = Math.max(tossUp, m.tossArmUp);
  }
  if (atContact.contactHeight > 0.1 && tossUp > 0.05) return 'serve';

  const b = backswingFrame(frames, start, contact, contact, hand);
  const wb = frames[b].world;
  if (!wb) return 'unknown';
  const { dom } = sides(hand);
  const axes = bodyAxes(wb, hand);
  const lateral = dot(sub(wb[dom.wrist], axes.hipMid), axes.lateralDom);
  if (lateral >= 0) return 'forehand';
  const together = (atContact.handsTogether ?? 1) < 0.22;
  return together ? 'backhand-2h' : 'backhand-1h';
}

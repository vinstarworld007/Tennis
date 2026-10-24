import { trackBall, type BallCandidate, type BallTrack, type PoseFrame } from '../core';
import type { FrameGrabber } from './grabber';

/** Work at this width; a ball is still a few pixels across and each frame stays cheap. */
const WORK_W = 640;

/** Tennis-ball yellow-green, allowing for the lighter, greyer look of a motion-blurred ball. */
function ballColour(r: number, g: number, b: number): number {
  if (g < 100 || b > g * 0.78 || r < g * 0.5 || r > g * 1.2 || g - b < 45) return 0;
  return Math.min(1, (g - b) / 140);
}

/** Pixels of the torso box (shoulders and hips, padded), where yellow clothing would confuse the detector. */
function torsoBox(f: PoseFrame | undefined) {
  const p = f?.image;
  if (!p) return null;
  const pts = [11, 12, 23, 24].map((i) => p[i]).filter((q) => q.v > 0.3);
  if (pts.length < 3) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const padX = (Math.max(...xs) - Math.min(...xs)) * 0.25 + 0.01;
  const padY = (Math.max(...ys) - Math.min(...ys)) * 0.1;
  return { x0: Math.min(...xs) - padX, x1: Math.max(...xs) + padX, y0: Math.min(...ys) - padY, y1: Math.max(...ys) + padY };
}

/**
 * Find ball candidates in one frame: small blobs that are ball-coloured and changed since the
 * previous frame. Returns candidates and this frame's grey image for the next comparison.
 */
function detectFrame(img: ImageData, prevGrey: Uint8Array | null, torso: ReturnType<typeof torsoBox>): { cands: BallCandidate[]; grey: Uint8Array } {
  const { width: w, height: h, data } = img;
  const grey = new Uint8Array(w * h);
  const mask = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    grey[i] = (r * 77 + g * 150 + b * 29) >> 8;
    const c = ballColour(r, g, b);
    if (!c) continue;
    if (prevGrey && Math.abs(grey[i] - prevGrey[i]) > 16) mask[i] = c;
  }
  // Connected blobs (4-neighbour flood fill).
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const maxArea = Math.round((w * h) / 1200);
  const cands: BallCandidate[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let area = 0, sx = 0, sy = 0, sc = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % w;
      const y = (q - x) / w;
      area++; sx += x; sy += y; sc += mask[q];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const n of [q - 1, q + 1, q - w, q + w]) {
        if (n < 0 || n >= w * h || seen[n] || !mask[n]) continue;
        if ((n === q - 1 && x === 0) || (n === q + 1 && x === w - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (area < 2 || area > maxArea) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (Math.max(bw, bh) / Math.min(bw, bh) > 4.5) continue; // lines and edges, not a (blurred) ball
    const fill = area / (bw * bh);
    if (fill < 0.3) continue;
    const x = sx / area / w, y = sy / area / h;
    if (torso && x > torso.x0 && x < torso.x1 && y > torso.y0 && y < torso.y1) continue;
    cands.push({ x, y, score: 0.4 * fill + 0.6 * (sc / area) });
  }
  cands.sort((a, b) => b.score - a.score);
  return { cands: cands.slice(0, 12), grey };
}

/**
 * Track the ball over frames [from, to] of a session. `time(i)` gives the video time of frame i.
 * Runs on the device, frame by frame, through the grabber's private video element.
 */
export async function trackBallInVideo(
  grabber: FrameGrabber,
  frames: PoseFrame[],
  from: number,
  to: number,
  time: (i: number) => number,
  onProgress?: (p: number) => void,
): Promise<BallTrack> {
  const { w: vw, h: vh } = await grabber.size();
  const W = Math.min(WORK_W, vw);
  const H = Math.round((vh / vw) * W);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // Start a frame early so the first frame has something to compare with (only moving blobs count).
  let prev: Uint8Array | null = null;
  if (from > 0) {
    await grabber.at(time(from - 1), (v) => ctx.drawImage(v, 0, 0, W, H));
    prev = detectFrame(ctx.getImageData(0, 0, W, H), null, null).grey;
  }
  const cands: BallCandidate[][] = [];
  for (let i = from; i <= to; i++) {
    await grabber.at(time(i), (v) => ctx.drawImage(v, 0, 0, W, H));
    const r = detectFrame(ctx.getImageData(0, 0, W, H), prev, torsoBox(frames[i]));
    cands.push(r.cands);
    prev = r.grey;
    onProgress?.((i - from + 1) / (to - from + 1));
  }
  return trackBall(cands, from, { aspect: vw / vh });
}

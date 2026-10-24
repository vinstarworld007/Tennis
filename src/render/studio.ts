import {
  ballAt, centreOfMass, estimateRacket, shareAt, sides,
  type BallTrack, type Callout, type Handedness, type ImagePoint, type PoseFrame, type Stroke, type Vec3, type WeightTransfer,
} from '../core';
import { COLORS, cropAround, drawCallouts, drawVideo, roundRect, toCanvas, type Crop, type View } from './overlay';

/**
 * The "studio" look for coach reels: the court darkened and desaturated, the player redrawn as a
 * white mannequin from the pose landmarks, with the racket path, ball flight and weight transfer
 * drawn on top in neon.
 */

export const STUDIO = {
  ball: '#f2ff5c',
  flight: '#ff4b4b',
  limbNear: '#ecebe6',
  limbFar: '#a9aaa7',
};

export interface StudioTracks {
  ball: BallTrack | null;
  weight: WeightTransfer | null;
}

type P = { x: number; y: number };

/** Dark, black-and-white court so the white figure and neon marks stand out. */
export function drawStudioBackground(v: View, video: CanvasImageSource) {
  const { ctx, W, H } = v;
  drawVideo(v, video);
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(6, 8, 12, 0.52)';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

const vis = (pts: ImagePoint[], ...idx: number[]) => idx.every((i) => pts[i] && pts[i].v > 0.3);

/** Torso length in canvas pixels: the size unit for limb thickness. */
function unit(v: View, pts: ImagePoint[]): number {
  const sm = toCanvas(v, { x: (pts[11].x + pts[12].x) / 2, y: (pts[11].y + pts[12].y) / 2 });
  const hm = toCanvas(v, { x: (pts[23].x + pts[24].x) / 2, y: (pts[23].y + pts[24].y) / 2 });
  return Math.max(20, Math.hypot(sm.x - hm.x, sm.y - hm.y));
}

/** A rounded limb with a soft highlight on the side facing the light (top left). */
function capsule(ctx: CanvasRenderingContext2D, path: P[], w: number, colour: string) {
  if (path.length < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = colour;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  // Highlight: a thinner, lighter stroke shifted toward the light.
  ctx.save();
  ctx.translate(-w * 0.16, -w * 0.16);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = w * 0.3;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * The player as a glossy white mannequin, near side drawn last. `world` (if present) decides which
 * side is nearer the camera.
 */
export function drawMannequin(v: View, pts: ImagePoint[] | null, world: Vec3[] | null, hand: Handedness) {
  if (!pts || !vis(pts, 11, 12, 23, 24)) return;
  const { ctx } = v;
  const U = unit(v, pts);
  const c = (i: number) => toCanvas(v, pts[i]);
  const leftNear = world ? world[11].z + world[23].z < world[12].z + world[24].z : true;
  const limb = (idx: number[]) => idx.filter((i) => pts[i].v > 0.3).map(c);
  const L = { arm: [11, 13, 15], leg: [23, 25, 27], foot: [27, 31], hand: 15 };
  const R = { arm: [12, 14, 16], leg: [24, 26, 28], foot: [28, 32], hand: 16 };
  const [far, near] = leftNear ? [R, L] : [L, R];
  const { dom } = sides(hand);
  const racket = estimateRacket(pts, hand, v.vw / v.vh);
  const domIsNear = near.hand === dom.wrist;

  // Head: centred between the ears when seen, else just above the nose.
  const ears = vis(pts, 7, 8) ? { x: (pts[7].x + pts[8].x) / 2, y: (pts[7].y + pts[8].y) / 2 } : pts[0];
  const head = toCanvas(v, ears);
  const sm = toCanvas(v, { x: (pts[11].x + pts[12].x) / 2, y: (pts[11].y + pts[12].y) / 2 });
  const torso = [c(11), c(12), c(24), c(23)];
  const all: [P[], number][] = [
    [limb(far.leg), 0.3 * U], [limb(near.leg), 0.3 * U], [limb(far.arm), 0.2 * U], [limb(near.arm), 0.2 * U],
    [limb(far.foot), 0.14 * U], [limb(near.foot), 0.14 * U], [[sm, head], 0.18 * U],
  ];

  ctx.save();
  // A dark halo first, to hide the real player's outline behind the mannequin.
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 0.25 * U;
  for (const [path, w] of all) capsule(ctx, path, w * 1.7, 'rgba(4,6,10,0.75)');
  drawTorso(ctx, c(11), c(12), c(24), c(23), 'rgba(4,6,10,0.75)', U, 0.25 * U);
  ctx.beginPath(); ctx.arc(head.x, head.y, 0.32 * U, 0, Math.PI * 2); ctx.fillStyle = 'rgba(4,6,10,0.75)'; ctx.fill();
  ctx.shadowBlur = 0;

  ctx.shadowColor = 'rgba(255,255,255,0.18)';
  ctx.shadowBlur = 0.08 * U;
  capsule(ctx, limb(far.leg), 0.27 * U, STUDIO.limbFar);
  capsule(ctx, limb(far.foot), 0.12 * U, STUDIO.limbFar);
  capsule(ctx, limb(far.arm), 0.17 * U, STUDIO.limbFar);
  hand_(ctx, pts, far.hand, c, U, STUDIO.limbFar);
  if (!domIsNear) drawRacket(ctx, v, racket, U);

  // Torso, lit from the top left: broad chest narrowing to the waist.
  const tb = bounds(torso);
  const g = ctx.createLinearGradient(tb.x0, tb.y0, tb.x1, tb.y1);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#b9bab6');
  drawTorso(ctx, c(11), c(12), c(24), c(23), g, U);
  capsule(ctx, [sm, head], 0.15 * U, STUDIO.limbNear);
  const hg = ctx.createRadialGradient(head.x - 0.08 * U, head.y - 0.08 * U, 0.02 * U, head.x, head.y, 0.26 * U);
  hg.addColorStop(0, '#ffffff');
  hg.addColorStop(1, '#c4c5c1');
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.ellipse(head.x, head.y, 0.2 * U, 0.25 * U, 0, 0, Math.PI * 2); ctx.fill();

  capsule(ctx, limb(near.leg), 0.3 * U, STUDIO.limbNear);
  capsule(ctx, limb(near.foot), 0.13 * U, STUDIO.limbNear);
  capsule(ctx, limb(near.arm), 0.19 * U, STUDIO.limbNear);
  hand_(ctx, pts, near.hand, c, U, STUDIO.limbNear);
  if (domIsNear) drawRacket(ctx, v, racket, U);
  ctx.restore();
}

function hand_(ctx: CanvasRenderingContext2D, pts: ImagePoint[], i: number, c: (i: number) => P, U: number, colour: string) {
  if (pts[i].v < 0.3) return;
  const p = c(i);
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(p.x, p.y, 0.11 * U, 0, Math.PI * 2); ctx.fill();
}

/** Chest from shoulder to shoulder, curving in to a narrower waist, out to the hips. */
function drawTorso(ctx: CanvasRenderingContext2D, ls: P, rs: P, rh: P, lh: P, fill: string | CanvasGradient, U: number, grow = 0) {
  const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const centre = lerp(lerp(ls, rs, 0.5), lerp(lh, rh, 0.5), 0.5);
  const out = (p: P, k: number): P => ({ x: centre.x + (p.x - centre.x) * k, y: centre.y + (p.y - centre.y) * k });
  const lw = out(lerp(ls, lh, 0.62), 0.82);
  const rw = out(lerp(rs, rh, 0.62), 0.82);
  ctx.beginPath();
  ctx.moveTo(ls.x, ls.y);
  ctx.quadraticCurveTo((ls.x + rs.x) / 2, Math.min(ls.y, rs.y) - 0.06 * U, rs.x, rs.y);
  ctx.quadraticCurveTo(rw.x, rw.y, rh.x, rh.y);
  ctx.lineTo(lh.x, lh.y);
  ctx.quadraticCurveTo(lw.x, lw.y, ls.x, ls.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.14 * U + grow;
  ctx.fill();
  ctx.stroke();
}

function bounds(pts: P[]) {
  return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
}

/** Racket: dark shaft and a neon frame around the strings. */
function drawRacket(ctx: CanvasRenderingContext2D, v: View, r: ReturnType<typeof estimateRacket>, U: number) {
  if (!r) return;
  const grip = toCanvas(v, r.grip);
  const head = toCanvas(v, r.head);
  const tip = toCanvas(v, r.tip);
  const len = Math.hypot(tip.x - grip.x, tip.y - grip.y);
  const ang = Math.atan2(tip.y - grip.y, tip.x - grip.x);
  const rx = len * 0.28;
  const ry = len * 0.17;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#8e9297';
  ctx.lineWidth = 0.07 * U;
  ctx.beginPath();
  ctx.moveTo(grip.x, grip.y);
  ctx.lineTo(head.x - Math.cos(ang) * rx, head.y - Math.sin(ang) * rx);
  ctx.stroke();
  ctx.translate(head.x, head.y);
  ctx.rotate(ang);
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(212, 240, 76, 0.16)';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(212, 240, 76, 0.45)';
  ctx.lineWidth = 1;
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath(); ctx.moveTo((k * rx) / 4, -ry); ctx.lineTo((k * rx) / 4, ry); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-rx, (k * ry) / 4); ctx.lineTo(rx, (k * ry) / 4); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = COLORS.accent;
  ctx.shadowColor = COLORS.accent;
  ctx.shadowBlur = 0.15 * U;
  ctx.lineWidth = 0.06 * U;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Path of the (estimated) racket head from the start of the stroke to `upTo`, fading in, with an arrowhead. */
export function drawRacketPath(v: View, frames: PoseFrame[], stroke: Stroke, upTo: number, hand: Handedness) {
  const pts: P[] = [];
  for (let i = stroke.startFrame; i <= Math.min(upTo, stroke.endFrame); i++) {
    const r = estimateRacket(frames[i]?.image ?? null, hand, v.vw / v.vh);
    if (r) pts.push(toCanvas(v, r.head));
  }
  if (pts.length < 3) return;
  const { ctx } = v;
  const s = v.H / 720;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = COLORS.accent;
  ctx.shadowBlur = 12 * s;
  for (let i = 1; i < pts.length; i++) {
    const k = i / pts.length;
    ctx.strokeStyle = COLORS.accent;
    ctx.globalAlpha = 0.1 + 0.85 * k;
    ctx.lineWidth = (2 + 5 * k) * s;
    ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  if (Math.hypot(b.x - a.x, b.y - a.y) > 1) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(ang) * 16 * s, b.y + Math.sin(ang) * 16 * s);
    ctx.lineTo(b.x + Math.cos(ang + 2.5) * 13 * s, b.y + Math.sin(ang + 2.5) * 13 * s);
    ctx.lineTo(b.x + Math.cos(ang - 2.5) * 13 * s, b.y + Math.sin(ang - 2.5) * 13 * s);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** The ball's flight as a red glowing arc up to frame `i`, with the ball itself on top. */
export function drawBallFlight(v: View, track: BallTrack | null, i: number, tail = 18) {
  if (!track) return;
  const { ctx } = v;
  const s = v.H / 720;
  const pts: (P | null)[] = [];
  for (let f = Math.max(track.from, i - tail); f <= i; f++) {
    const b = ballAt(track, f);
    pts.push(b ? toCanvas(v, b) : null);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = STUDIO.flight;
  ctx.shadowBlur = 14 * s;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (!a || !b) continue;
    const t = k / pts.length;
    ctx.globalAlpha = 0.15 + 0.85 * t;
    ctx.strokeStyle = STUDIO.flight;
    ctx.lineWidth = (2 + 4 * t) * s;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  const now = pts[pts.length - 1];
  if (now) {
    ctx.globalAlpha = 1;
    ctx.shadowColor = STUDIO.ball;
    ctx.shadowBlur = 18 * s;
    ctx.fillStyle = STUDIO.ball;
    ctx.beginPath(); ctx.arc(now.x, now.y, 7 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Centre of mass with a plumb line to the ground, and the weight split marked between the feet. */
export function drawBalance(v: View, frame: PoseFrame | undefined, wt: WeightTransfer | null, i: number) {
  const pts = frame?.image;
  const share = shareAt(wt, i);
  if (!pts || !wt || share === null || !vis(pts, wt.front, wt.back, 11, 12, 23, 24)) return;
  const { ctx } = v;
  const s = v.H / 720;
  const com = toCanvas(v, centreOfMass(pts));
  const front = toCanvas(v, pts[wt.front]);
  const back = toCanvas(v, pts[wt.back]);
  const groundY = Math.max(front.y, back.y) + 14 * s;
  const mark = { x: back.x + (front.x - back.x) * share, y: groundY };
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2 * s;
  ctx.setLineDash([6 * s, 6 * s]);
  ctx.beginPath(); ctx.moveTo(com.x, com.y); ctx.lineTo(com.x, groundY); ctx.stroke();
  ctx.setLineDash([]);
  // Ground line between the feet, back foot dim, front foot bright.
  const g = ctx.createLinearGradient(back.x, 0, front.x, 0);
  g.addColorStop(0, 'rgba(212,240,76,0.25)');
  g.addColorStop(1, 'rgba(212,240,76,0.95)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 5 * s;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(back.x, groundY); ctx.lineTo(front.x, groundY); ctx.stroke();
  ctx.shadowColor = COLORS.accent;
  ctx.shadowBlur = 12 * s;
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath(); ctx.arc(mark.x, mark.y, 8 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(com.x, com.y, 6 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.arc(com.x, com.y, 12 * s, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** "WEIGHT TRANSFER" bar along the bottom: back foot to front foot, with the share in front. */
export function drawWeightGauge(v: View, share: number | null) {
  if (share === null) return;
  const { ctx, W, H } = v;
  const s = W / 1080;
  const pad = 56 * s;
  const y = H - 170 * s;
  const barH = 18 * s;
  ctx.save();
  ctx.fillStyle = 'rgba(5,7,13,0.65)';
  roundRect(ctx, pad - 20 * s, y - 64 * s, W - 2 * pad + 40 * s, 130 * s, 18 * s);
  ctx.fill();
  ctx.font = `800 ${26 * s}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText('WEIGHT TRANSFER', pad, y - 22 * s);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.accent;
  ctx.font = `800 ${34 * s}px Inter, system-ui, sans-serif`;
  ctx.fillText(`${Math.round(share * 100)}% FRONT FOOT`, W - pad, y - 20 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, pad, y, W - 2 * pad, barH, barH / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.accent;
  ctx.shadowColor = COLORS.accent;
  ctx.shadowBlur = 12 * s;
  roundRect(ctx, pad, y, Math.max(barH, (W - 2 * pad) * share), barH, barH / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = `700 ${22 * s}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText('BACK FOOT', pad, y + barH + 30 * s);
  ctx.textAlign = 'right';
  ctx.fillText('FRONT FOOT', W - pad, y + barH + 30 * s);
  ctx.restore();
}

/** Crop around the player and the estimated racket across the stroke, so the racket path stays in frame. */
export function studioCrop(frames: PoseFrame[], stroke: Stroke, hand: Handedness, vw: number, vh: number, aspect: number): Crop {
  const withRacket = frames.map((f, i) => {
    if (i < stroke.startFrame || i > stroke.endFrame || !f.image) return f;
    const r = estimateRacket(f.image, hand, vw / vh);
    return r ? { ...f, image: [...f.image, { x: r.tip.x, y: r.tip.y, v: 1 }] } : f;
  });
  return cropAround(withRacket, stroke.startFrame, stroke.endFrame, vw, vh, aspect);
}

export interface StudioFrameOptions {
  callouts?: Callout[];
  gauge?: boolean;
  ballTail?: number;
}

/** One frame in the studio look. The caller adds the header. */
export function drawStudioFrame(
  v: View, video: CanvasImageSource, frames: PoseFrame[], stroke: Stroke | undefined, i: number,
  hand: Handedness, tracks: StudioTracks, opts: StudioFrameOptions = {},
) {
  drawStudioBackground(v, video);
  if (stroke) drawRacketPath(v, frames, stroke, i, hand);
  drawBalance(v, frames[i], tracks.weight, i);
  drawMannequin(v, frames[i]?.image ?? null, frames[i]?.world ?? null, hand);
  drawBallFlight(v, tracks.ball, i, opts.ballTail);
  if (opts.callouts?.length && frames[i]) drawCallouts(v, frames[i], opts.callouts, hand);
  if (opts.gauge) drawWeightGauge(v, shareAt(tracks.weight, i));
}

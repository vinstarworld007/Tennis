import { anchorIndices, deeperKnee, SKELETON, sides, type Callout, type Handedness, type ImagePoint, type PoseFrame, type Stroke } from '../core';

export const COLORS = {
  accent: '#d4f04c',
  fix: '#ff8a65',
  ink: '#0d1220',
  bone: 'rgba(235, 244, 255, 0.95)',
  glow: 'rgba(120, 170, 255, 0.9)',
};

/** Source rectangle (video pixels) drawn into the whole canvas. */
export interface Crop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface View {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  vw: number;
  vh: number;
  crop: Crop;
}

export const fullCrop = (vw: number, vh: number): Crop => ({ sx: 0, sy: 0, sw: vw, sh: vh });

export function toCanvas(v: View, p: { x: number; y: number }) {
  return { x: ((p.x * v.vw - v.crop.sx) / v.crop.sw) * v.W, y: ((p.y * v.vh - v.crop.sy) / v.crop.sh) * v.H };
}

/** Crop of the given aspect (w/h) around the player across a stroke, inside the video. */
export function cropAround(frames: PoseFrame[], from: number, to: number, vw: number, vh: number, aspect: number): Crop {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let i = from; i <= to; i++) {
    for (const p of frames[i]?.image ?? []) {
      if (p.v < 0.3) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  if (x1 <= x0) return fitAspect({ sx: 0, sy: 0, sw: vw, sh: vh }, vw, vh, aspect);
  const cx = ((x0 + x1) / 2) * vw;
  const cy = ((y0 + y1) / 2) * vh;
  let sh = (y1 - y0) * vh * 1.5;
  let sw = (x1 - x0) * vw * 1.5;
  if (sw / sh > aspect) sh = sw / aspect; else sw = sh * aspect;
  return fitAspect({ sx: cx - sw / 2, sy: cy - sh / 2, sw, sh }, vw, vh, aspect);
}

function fitAspect(c: Crop, vw: number, vh: number, aspect: number): Crop {
  let { sw, sh } = c;
  if (sw > vw) { sw = vw; sh = sw / aspect; }
  if (sh > vh) { sh = vh; sw = sh * aspect; }
  const sx = Math.max(0, Math.min(vw - sw, c.sx + (c.sw - sw) / 2));
  const sy = Math.max(0, Math.min(vh - sh, c.sy + (c.sh - sh) / 2));
  return { sx, sy, sw, sh };
}

export function drawVideo(v: View, video: CanvasImageSource) {
  v.ctx.fillStyle = '#05070d';
  v.ctx.fillRect(0, 0, v.W, v.H);
  v.ctx.drawImage(video, v.crop.sx, v.crop.sy, v.crop.sw, v.crop.sh, 0, 0, v.W, v.H);
}

export function drawSkeleton(v: View, pts: ImagePoint[] | null, dim = false) {
  if (!pts) return;
  const { ctx } = v;
  const s = v.H / 720;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = dim ? 0.45 : 1;
  ctx.shadowColor = COLORS.glow;
  ctx.shadowBlur = 14 * s;
  ctx.strokeStyle = COLORS.bone;
  ctx.lineWidth = 4 * s;
  for (const [a, b] of SKELETON) {
    if (pts[a].v < 0.3 || pts[b].v < 0.3) continue;
    const p = toCanvas(v, pts[a]);
    const q = toCanvas(v, pts[b]);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
    if (pts[i].v < 0.3) continue;
    const p = toCanvas(v, pts[i]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Path of the hitting wrist from the start of the stroke to `upTo`, with an arrowhead. */
export function drawTrail(v: View, frames: PoseFrame[], stroke: Stroke, upTo: number, hand: Handedness) {
  const { dom } = sides(hand);
  const pts = [];
  for (let i = stroke.startFrame; i <= Math.min(upTo, stroke.endFrame); i++) {
    const p = frames[i]?.image?.[dom.wrist];
    if (p && p.v > 0.3) pts.push(toCanvas(v, p));
  }
  if (pts.length < 3) return;
  const { ctx } = v;
  const s = v.H / 720;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    ctx.strokeStyle = COLORS.accent;
    ctx.globalAlpha = 0.15 + 0.75 * (i / pts.length);
    ctx.lineWidth = (2 + 3 * (i / pts.length)) * s;
    ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  if (Math.hypot(b.x - a.x, b.y - a.y) > 1) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.accent;
    ctx.beginPath();
    ctx.moveTo(b.x + Math.cos(ang) * 12 * s, b.y + Math.sin(ang) * 12 * s);
    ctx.lineTo(b.x + Math.cos(ang + 2.5) * 10 * s, b.y + Math.sin(ang + 2.5) * 10 * s);
    ctx.lineTo(b.x + Math.cos(ang - 2.5) * 10 * s, b.y + Math.sin(ang - 2.5) * 10 * s);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

export interface LabelBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export function anchorPoint(v: View, frame: PoseFrame, c: Callout, hand: Handedness) {
  if (!frame.image) return null;
  const knee = frame.world ? deeperKnee(frame.world) : undefined;
  const idx = anchorIndices(c.anchor, hand, knee);
  const pts = idx.map((i) => frame.image![i]);
  if (pts.some((p) => p.v < 0.2)) return null;
  return toCanvas(v, { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
}

/** Ring on the joint, a leader line, and an uppercase label chip. Returns label boxes for dragging. */
export function drawCallouts(v: View, frame: PoseFrame, callouts: Callout[], hand: Handedness, selected?: string): LabelBox[] {
  const { ctx } = v;
  const s = v.H / 720;
  const boxes: LabelBox[] = [];
  ctx.save();
  ctx.font = `700 ${Math.round(17 * s)}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const c of callouts) {
    if (c.hidden) continue;
    const a = anchorPoint(v, frame, c, hand);
    if (!a) continue;
    const color = c.status === 'fix' ? COLORS.fix : COLORS.accent;
    const text = c.label.toUpperCase();
    const w = ctx.measureText(text).width + 22 * s;
    const h = 34 * s;
    let lx = a.x + c.dx * v.H;
    let ly = a.y + c.dy * v.H;
    lx = Math.max(w / 2 + 8, Math.min(v.W - w / 2 - 8, lx));
    ly = Math.max(h / 2 + 8, Math.min(v.H - h / 2 - 8, ly));
    const r = 26 * s;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 * s;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 * s;
    ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.stroke();
    // Leader from the ring edge toward the label.
    const ang = Math.atan2(ly - a.y, lx - a.x);
    const far = Math.hypot(ly - a.y, lx - a.x);
    if (far > r + h / 2) {
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r);
      ctx.lineTo(lx - Math.cos(ang) * Math.min(w / 2, h / 2 + 4), ly - Math.sin(ang) * (h / 2));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    roundRect(ctx, lx - w / 2, ly - h / 2, w, h, 6 * s);
    ctx.fill();
    if (selected === c.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * s;
      roundRect(ctx, lx - w / 2 - 3, ly - h / 2 - 3, w + 6, h + 6, 8 * s);
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.fillText(text, lx, ly + 1);
    boxes.push({ id: c.id, x: lx - w / 2, y: ly - h / 2, w, h, ax: a.x, ay: a.y });
  }
  ctx.restore();
  return boxes;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** "1 UNIT TURN" header with a subtitle, like a breakdown card. An index of 0 hides the number. */
export function drawHeader(v: View, opts: { index: number; title: string; subtitle?: string; kicker?: string }) {
  const { ctx, W, H } = v;
  const s = W / 1080;
  const grad = ctx.createLinearGradient(0, 0, 0, H * 0.34);
  grad.addColorStop(0, 'rgba(5,7,13,0.92)');
  grad.addColorStop(1, 'rgba(5,7,13,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H * 0.34);
  const pad = 56 * s;
  let y = 70 * s;
  ctx.textBaseline = 'alphabetic';
  if (opts.kicker) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `600 ${30 * s}px Inter, system-ui, sans-serif`;
    ctx.fillText(opts.kicker.toUpperCase(), pad, y);
    y += 30 * s;
  }
  const r = 44 * s;
  const cy = y + r + 6 * s;
  let titleX = pad;
  if (opts.index > 0) {
    ctx.fillStyle = COLORS.accent;
    ctx.beginPath(); ctx.arc(pad + r, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.font = `800 ${52 * s}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(opts.index), pad + r, cy + 18 * s);
    titleX = pad + 2 * r + 24 * s;
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${96 * s}px Inter, system-ui, sans-serif`;
  ctx.fillText(opts.title.toUpperCase(), titleX, cy + 34 * s);
  y = cy + r + 70 * s;
  if (opts.subtitle) {
    ctx.font = `700 ${48 * s}px Inter, system-ui, sans-serif`;
    for (const line of wrap(ctx, opts.subtitle, W - 2 * pad).slice(0, 3)) {
      ctx.fillText(line, pad, y);
      y += 58 * s;
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `700 ${26 * s}px Inter, system-ui, sans-serif`;
  ctx.fillText('ANALYZED BY COURTSIDE', pad, y + 6 * s);
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (ctx.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

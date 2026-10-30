import '@fontsource/anton/400.css';
import '@fontsource/space-mono/700.css';
import type { Callout, Handedness } from '../core';
import { COLORS, roundRect, wrap } from './overlay';
import type { SceneInput, StudioScene } from './scene3d';

/**
 * 2D layers over the 3D studio: the bold headline ("■ STEP 2 OF 6 / UNIT TURN / TURN EARLIER."),
 * callout labels pinned to the body, and the weight-transfer gauge.
 */

export const RED = '#ff3b30';

/** A canvas area to draw on. */
export interface Surface {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
}

export interface Headline {
  kicker: string;
  line1: string;
  line2?: string;
  /** Colour of the kicker square and the second line: red for a fix, neon for a good point. */
  tone?: 'fix' | 'good';
  subtitle?: string;
  dots?: { count: number; active: number };
}

const DISPLAY = 'Anton, Impact, "Arial Narrow", sans-serif';
const MONO = '"Space Mono", ui-monospace, monospace';

/** Wait for the headline fonts, so the first exported frames are not drawn in a fallback font. */
export async function loadStudioFonts() {
  if (!document.fonts) return;
  await Promise.all([document.fonts.load(`400 100px ${DISPLAY}`), document.fonts.load(`700 30px ${MONO}`)]).catch(() => undefined);
}

export function drawHeadline(v: Surface, h: Headline) {
  const { ctx, W, H } = v;
  const s = W / 1080;
  const pad = 56 * s;
  const tone = h.tone === 'good' ? COLORS.accent : RED;
  ctx.save();
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.42);
  g.addColorStop(0, 'rgba(5,7,11,0.85)');
  g.addColorStop(1, 'rgba(5,7,11,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.42);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  let y = 110 * s;
  ctx.fillStyle = tone;
  ctx.fillRect(pad, y - 24 * s, 20 * s, 20 * s);
  ctx.font = `700 ${30 * s}px ${MONO}`;
  ctx.fillStyle = 'rgba(235,238,245,0.8)';
  ctx.fillText(spaced(h.kicker.toUpperCase()), pad + 36 * s, y);
  if (h.dots) drawDots(ctx, W - pad, y - 14 * s, s, h.dots.count, h.dots.active);

  const room = W - 2 * pad;
  const big = (text: string, colour: string) => {
    ctx.font = `400 ${150 * s}px ${DISPLAY}`;
    const size = Math.min(150 * s, (150 * s * room) / Math.max(1, ctx.measureText(text).width));
    ctx.font = `400 ${size}px ${DISPLAY}`;
    ctx.fillStyle = colour;
    y += size * 1.0;
    ctx.fillText(text, pad - 4 * s, y);
  };
  y += 14 * s;
  big(h.line1.toUpperCase(), '#f4f4f0');
  if (h.line2) big(h.line2.toUpperCase(), tone);
  if (h.subtitle) {
    ctx.font = `600 ${40 * s}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(244,244,240,0.88)';
    y += 30 * s;
    for (const line of wrap(ctx, h.subtitle, room).slice(0, 2)) {
      y += 48 * s;
      ctx.fillText(line, pad, y);
    }
  }
  ctx.restore();
}

/** Letter-spacing for the monospace kicker, which canvas cannot do everywhere. */
const spaced = (t: string) => t.split('').join(' ');

function drawDots(ctx: CanvasRenderingContext2D, right: number, y: number, s: number, count: number, active: number) {
  const r = 7 * s, gap = 10 * s, pill = 44 * s;
  let x = right - (count - 1) * (2 * r + gap) - pill;
  for (let i = 0; i < count; i++) {
    const w = i === active ? pill : 2 * r;
    ctx.fillStyle = i === active ? COLORS.accent : 'rgba(255,255,255,0.4)';
    roundRect(ctx, x, y - r, w, 2 * r, r);
    ctx.fill();
    x += w + gap;
  }
}

/** Callout chips pinned to the 3D body: a leader from the joint (where the ring is) to the label. */
export function drawPinnedLabels(v: Surface, scene: StudioScene, callouts: Callout[], hand: Handedness) {
  const { ctx, W, H } = v;
  const s = W / 1080;
  ctx.save();
  ctx.font = `700 ${30 * s}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  for (const c of callouts) {
    if (c.hidden) continue;
    const a = scene.projectAnchor(c.anchor, hand);
    if (!a) continue;
    const colour = c.status === 'fix' ? RED : COLORS.accent;
    const text = c.label.toUpperCase();
    const w = ctx.measureText(text).width + 34 * s;
    const h = 54 * s;
    const lx = Math.max(w / 2 + 12 * s, Math.min(W - w / 2 - 12 * s, a.x + c.dx * H * 0.8));
    const ly = Math.max(H * 0.36, Math.min(H - h - 230 * s, a.y + c.dy * H * 0.8));
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3 * s;
    ctx.shadowColor = colour;
    ctx.shadowBlur = 10 * s;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.beginPath(); ctx.arc(a.x, a.y, 6 * s, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
    ctx.shadowBlur = 0;
    roundRect(ctx, lx - w / 2, ly - h / 2, w, h, 8 * s);
    ctx.fill();
    ctx.fillStyle = c.status === 'fix' ? '#ffffff' : COLORS.ink;
    ctx.fillText(text, lx, ly + 2 * s);
  }
  ctx.restore();
}

/** "WEIGHT TRANSFER" bar along the bottom: back foot to front foot, with the share in front. */
export function drawWeightGauge(v: Surface, share: number | null) {
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
  ctx.font = `700 ${24 * s}px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.textAlign = 'left';
  ctx.fillText(spaced('WEIGHT TRANSFER'), pad, y - 22 * s);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.accent;
  ctx.font = `400 ${40 * s}px ${DISPLAY}`;
  ctx.fillText(`${Math.round(share * 100)}% FRONT FOOT`, W - pad, y - 18 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, pad, y, W - 2 * pad, barH, barH / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.accent;
  ctx.shadowColor = COLORS.accent;
  ctx.shadowBlur = 12 * s;
  roundRect(ctx, pad, y, Math.max(barH, (W - 2 * pad) * share), barH, barH / 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = `700 ${20 * s}px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText('BACK FOOT', pad, y + barH + 30 * s);
  ctx.textAlign = 'right';
  ctx.fillText('FRONT FOOT', W - pad, y + barH + 30 * s);
  ctx.restore();
}

export interface StudioOverlay {
  headline?: Headline;
  callouts?: Callout[];
  /** Weight share to show on the gauge; omit for no gauge. */
  gauge?: number | null;
}

/**
 * Render one studio frame into `v` (at its own size, so translate the context for a split screen):
 * the 3D scene, then the labels, gauge and headline. Callouts also become rings in the scene.
 */
export function renderStudio(v: Surface, scene: StudioScene, input: SceneInput, overlay: StudioOverlay = {}) {
  const callouts = (overlay.callouts ?? []).filter((c) => !c.hidden);
  scene.setSize(v.W, v.H);
  scene.render({ ...input, rings: callouts.map((c) => ({ anchor: c.anchor, status: c.status })) });
  v.ctx.drawImage(scene.canvas, 0, 0, v.W, v.H);
  if (callouts.length) drawPinnedLabels(v, scene, callouts, input.hand);
  if (overlay.gauge !== undefined) drawWeightGauge(v, overlay.gauge);
  if (overlay.headline) drawHeadline(v, overlay.headline);
}

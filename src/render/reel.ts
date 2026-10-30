import { topFix, transferSummary, weightTransfer, shareAt, type Callout, type Phase, type PoseFrame, type Stroke, type WeightTransfer } from '../core';
import { STROKE_LABEL } from '../labels';
import type { Player, Session } from '../storage/db';
import { baseName, createFrameWriter, phaseSubtitle, type CardContext, type FrameWriter } from './export';
import { saveFile, slug } from './files';
import { StudioScene } from './scene3d';
import { drawHeadline, loadStudioFonts, renderStudio, type Headline, type Surface } from './studio';

/** "Weight 30% → 74% onto the front foot", or null when the feet were not readable. */
export function transferLine(weight: WeightTransfer | null, stroke: Stroke): string | null {
  const sum = transferSummary(weight, stroke.contactFrame);
  if (!sum) return null;
  return `Weight ${Math.round(sum.load * 100)}% → ${Math.round(sum.drive * 100)}% onto the front foot.`;
}

/**
 * Keep a frame on screen for `ms` of video, re-drawing it every few frames so the camera's slow
 * orbit (driven by video time) keeps moving during holds.
 */
async function hold(writer: FrameWriter, ms: number, draw: (videoTime: number) => void) {
  let left = ms / 1000;
  do {
    draw(writer.time);
    const step = Math.min(left, 2 / 30);
    await writer.add(step);
    left -= step;
  } while (left > 1e-3);
}
const phaseCallouts = (st: Stroke, id: Phase['id']) => st.callouts.filter((c) => c.phaseId === id && !c.hidden);
/** The callout a phase headline leads with: the first fix, else the first good point. */
const leadCallout = (cs: Callout[]) => cs.find((c) => c.status === 'fix') ?? cs[0];

export function phaseHeadline(stroke: Stroke, p: Phase, total?: number): Headline {
  const found = leadCallout(phaseCallouts(stroke, p.id));
  // "TROPHY / TROPHY POSITION." says it twice; drop a second line that repeats the title.
  const lead = found && !found.label.toLowerCase().includes(p.label.toLowerCase()) ? found : undefined;
  return {
    kicker: `Step ${p.index} of ${total ?? stroke.phases.length} · ${STROKE_LABEL[stroke.type]}`,
    line1: p.label,
    line2: lead ? `${lead.label}.` : undefined,
    tone: lead?.status === 'fix' ? 'fix' : 'good',
    subtitle: phaseSubtitle(stroke, p),
    dots: { count: total ?? stroke.phases.length, active: p.index - 1 },
  };
}

/**
 * A 1080×1920 coach reel in the 3D studio: the player as a mannequin on a virtual court, with a
 * slowly orbiting camera. A title ("THE PROBLEM / FOREHAND / TURN EARLIER."), then each phase in
 * slow motion and held with its rings and labels, then the full swing with the ball flight and
 * the weight shift summed up.
 */
export async function exportStudioVideo(ctx: CardContext, stroke: Stroke, onProgress?: (p: number) => void) {
  const { session, frames, player } = ctx;
  await loadStudioFonts();
  const weight = weightTransfer(frames, stroke, player.hand);
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const view: Surface = { ctx: canvas.getContext('2d')!, W, H };
  const scene = new StudioScene(W, H);
  const writer = await createFrameWriter(canvas);
  const phases = stroke.phases;
  const slow = 1000 / (session.fps * 0.25);
  const n = stroke.endFrame - stroke.startFrame + 1;
  const total = 2.2 + n * (slow / 1000) * 1.5 + phases.length * 2.6 + 1.8;
  const base = { frames, fps: session.fps, hand: player.hand, stroke, weight };

  const show = async (i: number, ms: number, headline: Headline, callouts: Callout[] = [], ball = true) => {
    await hold(writer, ms, (t) => {
      renderStudio(view, scene, { ...base, i, ball, orbit: 0.22 * Math.sin(t / 9) }, { headline, callouts, gauge: shareAt(weight, i) });
    });
    onProgress?.(Math.min(1, writer.time / total));
  };

  try {
    const fix = topFix(stroke);
    const fixCallout = stroke.callouts.find((c) => c.status === 'fix' && !c.hidden);
    await show(phases[0]?.frame ?? stroke.startFrame, 2200, {
      kicker: fix ? 'The problem' : 'The breakdown',
      line1: STROKE_LABEL[stroke.type],
      line2: fixCallout ? `${fixCallout.label}.` : `${phases.length} steps.`,
      tone: fixCallout ? 'fix' : 'good',
      subtitle: fix?.text ?? `${player.name}, step by step.`,
    }, [], false);
    let prev = stroke.startFrame;
    for (const p of phases) {
      const h = phaseHeadline(stroke, p);
      for (let i = prev; i < p.frame; i++) await show(i, slow, h);
      await show(p.frame, 2600, h, phaseCallouts(stroke, p.id));
      prev = p.frame;
    }
    const sum = transferSummary(weight, stroke.contactFrame);
    const outro: Headline = {
      kicker: 'The full swing',
      line1: 'Full swing',
      line2: sum ? `${Math.round(sum.load * 100)}% → ${Math.round(sum.drive * 100)}% front foot.` : undefined,
      tone: 'good',
      subtitle: transferLine(weight, stroke) ?? 'Racket path and ball flight.',
    };
    for (let i = stroke.startFrame; i <= stroke.endFrame; i++) await show(i, slow * 0.5, outro);
    await show(stroke.endFrame, 1800, outro);
  } finally {
    scene.dispose();
  }
  const { blob, ext } = await writer.finish();
  return saveFile(blob, `${baseName(ctx, stroke)}-studio.${ext}`, [{ name: 'Video', extensions: [ext] }]);
}

export interface CompareSide {
  session: Session;
  frames: PoseFrame[];
  player: Player;
  stroke: Stroke;
  label: string;
}

/**
 * Two strokes side by side in the 3D studio, lined up at contact ("PRO | BEGINNER"),
 * pausing on each phase of the left stroke with both players' rings and labels.
 */
export async function exportStudioCompare(a: CompareSide, b: CompareSide, onProgress?: (p: number) => void) {
  await loadStudioFonts();
  const W = 1080, H = 1920;
  const top = 600, panelW = W / 2, panelH = H - top - 60;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const out = canvas.getContext('2d')!;
  const scene = new StudioScene(panelW, panelH);
  const weights = [weightTransfer(a.frames, a.stroke, a.player.hand), weightTransfer(b.frames, b.stroke, b.player.hand)];
  const writer = await createFrameWriter(canvas);
  const phases = a.stroke.phases;
  const pre = Math.min(a.stroke.contactFrame - a.stroke.startFrame, Math.round(((b.stroke.contactFrame - b.stroke.startFrame) * a.session.fps) / b.session.fps));
  const post = Math.min(a.stroke.endFrame - a.stroke.contactFrame, Math.round(((b.stroke.endFrame - b.stroke.contactFrame) * a.session.fps) / b.session.fps));
  const slow = 1000 / (a.session.fps * 0.25);

  const draw = (ia: number, ib: number, phase: Phase | undefined, held: boolean) => {
    out.fillStyle = '#05070b';
    out.fillRect(0, 0, W, H);
    [a, b].forEach((s, k) => {
      out.save();
      out.translate(k * panelW, top);
      out.beginPath(); out.rect(0, 0, panelW, panelH); out.clip();
      renderStudio({ ctx: out, W: panelW, H: panelH }, scene,
        { frames: s.frames, i: k === 0 ? ia : ib, fps: s.session.fps, hand: s.player.hand, stroke: s.stroke, weight: weights[k] },
        { callouts: held && phase ? phaseCallouts(s.stroke, phase.id) : [] });
      out.restore();
    });
    drawHeadline({ ctx: out, W, H }, phase
      ? phaseHeadline(a.stroke, phase)
      : { kicker: `${a.label} vs ${b.label}`, line1: STROKE_LABEL[a.stroke.type], line2: 'Side by side.', tone: 'good' });
    drawSideLabels(out, a.label, b.label, top, panelW, panelH);
  };
  const show = (ia: number, ib: number, phase: Phase | undefined, held: boolean, ms: number) => hold(writer, ms, () => draw(ia, ib, phase, held));

  const bFrame = (ia: number) => {
    const k = Math.round(((ia - a.stroke.contactFrame) * b.session.fps) / a.session.fps);
    return Math.max(b.stroke.startFrame, Math.min(b.stroke.endFrame, b.stroke.contactFrame + k));
  };
  try {
    const startA = a.stroke.contactFrame - pre;
    await show(startA, bFrame(startA), undefined, false, 1800);
    let k = 0;
    for (let ia = startA; ia <= a.stroke.contactFrame + post; ia++) {
      while (k < phases.length - 1 && phases[k + 1].frame <= ia) k++;
      const phase = phases[k] && phases[k].frame <= ia ? phases[k] : undefined;
      await show(ia, bFrame(ia), phase, false, slow);
      if (phase && phase.frame === ia) {
        // Hold on the phase: each player at their own frame for it.
        const ib = b.stroke.phases.find((x) => x.id === phase.id)?.frame ?? bFrame(ia);
        await show(ia, ib, phase, true, 2400);
      }
      onProgress?.((ia - startA + 1) / (pre + post + 1));
    }
  } finally {
    scene.dispose();
  }
  const { blob, ext } = await writer.finish();
  const name = slug(`${a.label} vs ${b.label} ${STROKE_LABEL[a.stroke.type]}`);
  return saveFile(blob, `${name}.${ext}`, [{ name: 'Video', extensions: [ext] }]);
}

/** Spaced capitals above each half ("PRO", "BEGINNER") and the neon divider between them. */
function drawSideLabels(ctx: CanvasRenderingContext2D, left: string, right: string, top: number, panelW: number, panelH: number) {
  ctx.save();
  ctx.strokeStyle = '#d4f04c';
  ctx.shadowColor = '#d4f04c';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(panelW, top); ctx.lineTo(panelW, top + panelH); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '700 32px "Space Mono", ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#d4f04c';
  ctx.fillText(left.toUpperCase().split('').join(' '), 36, top + 24);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(right.toUpperCase().split('').join(' '), panelW + 36, top + 24);
  ctx.restore();
}

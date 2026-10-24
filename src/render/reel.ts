import { transferSummary, weightTransfer, type Phase, type PoseFrame, type Stroke } from '../core';
import { STROKE_LABEL } from '../labels';
import type { Player, Session } from '../storage/db';
import { trackBallInVideo } from './ballDetect';
import { baseName, frameTime, phaseSubtitle, startRecording, type CardContext } from './export';
import { saveFile, slug } from './files';
import type { FrameGrabber } from './grabber';
import { drawHeader, type View } from './overlay';
import { drawStudioFrame, studioCrop, type StudioTracks } from './studio';

/** Ball, weight and racket data for one stroke. The ball is tracked a little before and after the swing. */
export async function prepareStudio(
  grabber: FrameGrabber, session: Session, frames: PoseFrame[], player: Player, stroke: Stroke,
  onProgress?: (p: number) => void,
): Promise<StudioTracks> {
  const pad = Math.round(session.fps * 0.5);
  const from = Math.max(0, stroke.startFrame - pad);
  const to = Math.min(frames.length - 1, stroke.endFrame + pad);
  const ball = await trackBallInVideo(grabber, frames, from, to, (i) => frameTime(session, i), onProgress);
  return { ball, weight: weightTransfer(frames, stroke, player.hand) };
}

/** "Weight 30% → 74% onto the front foot", or a plain line when the feet were not readable. */
export function transferLine(tracks: StudioTracks, stroke: Stroke): string {
  const sum = transferSummary(tracks.weight, stroke.contactFrame);
  if (!sum) return 'Racket path and ball flight.';
  return `Weight ${Math.round(sum.load * 100)}% → ${Math.round(sum.drive * 100)}% onto the front foot.`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A 1080×1920 coach reel in the studio look: a title, then each phase played in slow motion and
 * held with its callouts ("1 UNIT TURN / Shoulders and racket together."), then the full swing
 * with the racket path, ball flight and weight transfer.
 */
export async function exportStudioVideo(ctx: CardContext, stroke: Stroke, onProgress?: (p: number) => void, tracks?: StudioTracks) {
  const { session, frames, player, grabber } = ctx;
  const data = tracks ?? (await prepareStudio(grabber, session, frames, player, stroke, (p) => onProgress?.(p * 0.3)));
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c2d = canvas.getContext('2d')!;
  const { w: vw, h: vh } = await grabber.size();
  const view: View = { ctx: c2d, W, H, vw, vh, crop: studioCrop(frames, stroke, player.hand, vw, vh, W / H) };
  const rec = startRecording(canvas);
  const phases = stroke.phases;
  const slow = 1000 / (session.fps * 0.25);
  const total = (stroke.endFrame - stroke.startFrame + 1) * 2 + phases.length + 2;
  let step = 0;
  const tick = () => onProgress?.(0.3 + (0.7 * ++step) / total);
  const kicker = `${player.name} · ${STROKE_LABEL[stroke.type]}`;

  const show = async (i: number, header: Parameters<typeof drawHeader>[1], opts: Parameters<typeof drawStudioFrame>[7], ms: number) => {
    const t0 = performance.now();
    await grabber.at(frameTime(session, i), (video) => {
      drawStudioFrame(view, video, frames, stroke, i, player.hand, data, opts);
      drawHeader(view, header);
    });
    await wait(Math.max(0, ms - (performance.now() - t0)));
  };
  const phaseHeader = (p: Phase, k: number) => ({ index: p.index, title: p.label, subtitle: phaseSubtitle(stroke, p), kicker, dots: { count: phases.length, active: k } });

  await show(phases[0]?.frame ?? stroke.startFrame, { index: 0, title: STROKE_LABEL[stroke.type], subtitle: `Breakdown in ${phases.length} steps.`, kicker: player.name }, {}, 2000);
  tick();
  let prev = stroke.startFrame;
  for (const [k, p] of phases.entries()) {
    for (let i = prev; i < p.frame; i++) { await show(i, phaseHeader(p, k), { gauge: true }, slow); tick(); }
    await show(p.frame, phaseHeader(p, k), { gauge: true, callouts: stroke.callouts.filter((c) => c.phaseId === p.id) }, 2400);
    tick();
    prev = p.frame;
  }
  const summary = { index: 0, title: 'Full swing', subtitle: transferLine(data, stroke), kicker };
  for (let i = stroke.startFrame; i <= stroke.endFrame; i++) { await show(i, summary, { gauge: true, ballTail: 40 }, slow * 0.5); tick(); }
  await show(stroke.endFrame, summary, { gauge: true, ballTail: 40 }, 1500);
  tick();
  const { blob, ext } = await rec.stop();
  return saveFile(blob, `${baseName(ctx, stroke)}-studio.${ext}`, [{ name: 'Video', extensions: [ext] }]);
}

export interface CompareSide extends CardContext {
  stroke: Stroke;
  label: string;
}

/**
 * Two strokes side by side in the studio look, lined up at contact ("PRO | BEGINNER"),
 * pausing on each phase of the left stroke with both players' callouts.
 */
export async function exportStudioCompare(a: CompareSide, b: CompareSide, onProgress?: (p: number) => void) {
  const tracksA = await prepareStudio(a.grabber, a.session, a.frames, a.player, a.stroke, (p) => onProgress?.(p * 0.15));
  const tracksB = await prepareStudio(b.grabber, b.session, b.frames, b.player, b.stroke, (p) => onProgress?.(0.15 + p * 0.15));
  const W = 1080, H = 1920;
  const top = 440, panelH = 1300, panelW = W / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const out = canvas.getContext('2d')!;
  // Compose each frame off screen so the recording never catches one half updated.
  const buf = document.createElement('canvas');
  buf.width = W;
  buf.height = H;
  const c2d = buf.getContext('2d')!;
  const full: View = { ctx: c2d, W, H, vw: W, vh: H, crop: { sx: 0, sy: 0, sw: W, sh: H } };
  const views = await Promise.all([a, b].map(async (s) => {
    const { w: vw, h: vh } = await s.grabber.size();
    return { ctx: c2d, W: panelW, H: panelH, vw, vh, crop: studioCrop(s.frames, s.stroke, s.player.hand, vw, vh, panelW / panelH) } as View;
  }));
  const rec = startRecording(canvas);
  const phases = a.stroke.phases;
  const pre = Math.min(a.stroke.contactFrame - a.stroke.startFrame, Math.round(((b.stroke.contactFrame - b.stroke.startFrame) * a.session.fps) / b.session.fps));
  const post = Math.min(a.stroke.endFrame - a.stroke.contactFrame, Math.round(((b.stroke.endFrame - b.stroke.contactFrame) * a.session.fps) / b.session.fps));
  const slow = 1000 / (a.session.fps * 0.25);
  const total = pre + post + 1;

  const pane = async (s: CompareSide, k: number, i: number, tracks: StudioTracks, phaseId?: Phase['id']) => {
    const x0 = k * panelW;
    await s.grabber.at(frameTime(s.session, i), (video) => {
      c2d.save();
      c2d.beginPath(); c2d.rect(x0, top, panelW, panelH); c2d.clip();
      c2d.translate(x0, top);
      drawStudioFrame(views[k], video, s.frames, s.stroke, i, s.player.hand, tracks, {
        callouts: phaseId ? s.stroke.callouts.filter((c) => c.phaseId === phaseId) : undefined,
      });
      c2d.restore();
    });
  };
  const show = async (ia: number, ib: number, phase: Phase | undefined, k: number, hold: boolean, ms: number) => {
    const t0 = performance.now();
    c2d.fillStyle = '#05070d';
    c2d.fillRect(0, 0, W, H);
    await pane(a, 0, ia, tracksA, hold ? phase?.id : undefined);
    await pane(b, 1, ib, tracksB, hold ? phase?.id : undefined);
    drawHeader(full, phase
      ? { index: phase.index, title: phase.label, subtitle: phaseSubtitle(a.stroke, phase), dots: { count: phases.length, active: k } }
      : { index: 0, title: STROKE_LABEL[a.stroke.type], subtitle: 'Same stroke, side by side.' });
    drawSideLabels(c2d, a.label, b.label, top, panelW, panelH);
    out.drawImage(buf, 0, 0);
    await wait(Math.max(0, ms - (performance.now() - t0)));
  };

  const bFrame = (ia: number) => {
    const k = Math.round(((ia - a.stroke.contactFrame) * b.session.fps) / a.session.fps);
    return Math.max(b.stroke.startFrame, Math.min(b.stroke.endFrame, b.stroke.contactFrame + k));
  };
  const startA = a.stroke.contactFrame - pre;
  await show(startA, bFrame(startA), undefined, 0, false, 1500);
  let k = 0;
  for (let ia = startA; ia <= a.stroke.contactFrame + post; ia++) {
    while (k < phases.length - 1 && phases[k + 1].frame <= ia) k++;
    const phase = phases[k] && phases[k].frame <= ia ? phases[k] : undefined;
    await show(ia, bFrame(ia), phase, k, false, slow);
    if (phase && phase.frame === ia) {
      // Hold on the phase: each player at their own frame for it.
      const ib = b.stroke.phases.find((x) => x.id === phase.id)?.frame ?? bFrame(ia);
      await show(ia, ib, phase, k, true, 2400);
    }
    onProgress?.(0.3 + (0.7 * (ia - startA + 1)) / total);
  }
  const { blob, ext } = await rec.stop();
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
  ctx.font = '800 34px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '8px';
  ctx.fillStyle = '#d4f04c';
  ctx.textAlign = 'left';
  ctx.fillText(left.toUpperCase(), 40, top + 30);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(right.toUpperCase(), panelW + 40, top + 30);
  ctx.restore();
}

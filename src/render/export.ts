import JSZip from 'jszip';
import { BufferTarget, CanvasSource, canEncodeVideo, Mp4OutputFormat, Output } from 'mediabunny';
import { jsPDF } from 'jspdf';
import { formatMetric, METRIC_INFO, topFix, type Handedness, type Phase, type PoseFrame, type Stroke } from '../core';
import { STROKE_LABEL } from '../labels';
import type { Player, Session } from '../storage/db';
import { FrameGrabber } from './grabber';
import { cropAround, drawCallouts, drawHeader, drawSkeleton, drawTrail, drawVideo, type View } from './overlay';
import { saveFile, slug } from './files';

export interface CardContext {
  grabber: FrameGrabber;
  session: Session;
  frames: PoseFrame[];
  player: Player;
}

export const frameTime = (s: Session, i: number) => s.start + i / s.fps;

/** The headline under the phase title: the first fix for that phase, else the first good point. */
export function phaseSubtitle(stroke: Stroke, phase: Phase): string | undefined {
  const kps = stroke.keyPoints.filter((k) => k.phaseId === phase.id);
  return (kps.find((k) => k.status === 'fix') ?? kps[0])?.text;
}

export async function renderCard(ctx: CardContext, stroke: Stroke, phase: Phase, W: number, H: number, opts: { header?: boolean } = {}): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c2d = canvas.getContext('2d')!;
  const hand: Handedness = ctx.player.hand;
  await ctx.grabber.at(frameTime(ctx.session, phase.frame), (video) => {
    const crop = cropAround(ctx.frames, stroke.startFrame, stroke.endFrame, video.videoWidth, video.videoHeight, W / H);
    const view: View = { ctx: c2d, W, H, vw: video.videoWidth, vh: video.videoHeight, crop };
    drawVideo(view, video);
    drawTrail(view, ctx.frames, stroke, phase.frame, hand);
    drawSkeleton(view, ctx.frames[phase.frame]?.image ?? null);
    drawCallouts(view, ctx.frames[phase.frame], stroke.callouts.filter((c) => c.phaseId === phase.id), hand);
    if (opts.header !== false) {
      drawHeader(view, {
        index: phase.index,
        title: phase.label,
        subtitle: phaseSubtitle(stroke, phase),
        kicker: `${ctx.player.name} · ${STROKE_LABEL[stroke.type]}`,
      });
    }
  });
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not render image'))), type, q));

export function baseName(ctx: CardContext, stroke: Stroke) {
  return slug(`${ctx.player.name} ${STROKE_LABEL[stroke.type]} ${ctx.session.title}`);
}

/** One 1080×1350 image per phase, zipped (an Instagram-style carousel). */
export async function exportCarousel(ctx: CardContext, stroke: Stroke, onProgress?: (p: number) => void) {
  const zip = new JSZip();
  for (const [i, ph] of stroke.phases.entries()) {
    const card = await renderCard(ctx, stroke, ph, 1080, 1350);
    zip.file(`${String(ph.index).padStart(2, '0')}-${slug(ph.label)}.png`, await toBlob(card));
    onProgress?.((i + 1) / stroke.phases.length);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return saveFile(blob, `${baseName(ctx, stroke)}-carousel.zip`, [{ name: 'Zip', extensions: ['zip'] }]);
}

/** A PDF report: summary page, then one page per phase with its image and key points. */
export async function exportPdf(ctx: CardContext, stroke: Stroke, onProgress?: (p: number) => void) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const m = 40;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text(`${STROKE_LABEL[stroke.type]} breakdown`, m, m + 20);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);
  pdf.text(`${ctx.player.name} · ${ctx.session.title} · ${new Date(ctx.session.createdAt).toLocaleDateString()}`, m, m + 42);
  const fix = topFix(stroke);
  let y = m + 80;
  pdf.setFont('helvetica', 'bold');
  pdf.text('Work on next', m, y);
  pdf.setFont('helvetica', 'normal');
  y += 18;
  y = textBlock(pdf, fix ? fix.text : 'Nothing flagged in this stroke.', m, y, pw - 2 * m);
  y += 16;
  pdf.setFont('helvetica', 'bold');
  pdf.text('All key points', m, y);
  y += 18;
  pdf.setFont('helvetica', 'normal');
  for (const p of stroke.phases) {
    for (const k of stroke.keyPoints.filter((x) => x.phaseId === p.id)) {
      if (y > ph - m) { pdf.addPage(); y = m; }
      const mark = k.status === 'fix' ? 'Fix' : k.status === 'good' ? 'Good' : 'Note';
      y = textBlock(pdf, `${p.index} ${p.label} · ${mark}: ${k.text}${measured(k)}`, m, y, pw - 2 * m);
      y += 4;
    }
  }
  if (stroke.note) {
    y += 12;
    pdf.setFont('helvetica', 'bold');
    pdf.text('Coach notes', m, y);
    pdf.setFont('helvetica', 'normal');
    y = textBlock(pdf, stroke.note, m, y + 18, pw - 2 * m);
  }
  for (const [i, p] of stroke.phases.entries()) {
    pdf.addPage();
    const card = await renderCard(ctx, stroke, p, 1080, 1350);
    const imgW = pw - 2 * m;
    const imgH = Math.min((imgW * 1350) / 1080, ph * 0.66);
    const w = (imgH * 1080) / 1350;
    pdf.addImage(await toDataUrl(card), 'JPEG', (pw - w) / 2, m, w, imgH);
    let yy = m + imgH + 26;
    for (const k of stroke.keyPoints.filter((x) => x.phaseId === p.id)) {
      pdf.setTextColor(k.status === 'fix' ? 200 : 60, k.status === 'fix' ? 80 : 120, 60);
      pdf.text(k.status === 'fix' ? 'Fix' : 'Good', m, yy);
      pdf.setTextColor(20, 20, 20);
      yy = textBlock(pdf, k.text + measured(k), m + 40, yy, pw - 2 * m - 40) + 6;
    }
    onProgress?.((i + 1) / stroke.phases.length);
  }
  return saveFile(pdf.output('blob'), `${baseName(ctx, stroke)}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
}

function measured(k: Stroke['keyPoints'][number]) {
  if (!k.metric || k.value === undefined) return '';
  const range = k.min !== undefined && k.max !== undefined ? `${formatMetric(k.metric, k.min)}–${formatMetric(k.metric, k.max)}` : k.min !== undefined ? `at least ${formatMetric(k.metric, k.min)}` : k.max !== undefined ? `at most ${formatMetric(k.metric, k.max)}` : '';
  return ` (${METRIC_INFO[k.metric].label.toLowerCase()} ${formatMetric(k.metric, k.value)}${range ? `, target ${range}` : ''})`;
}

function textBlock(pdf: jsPDF, text: string, x: number, y: number, w: number) {
  const lines = pdf.splitTextToSize(text, w) as string[];
  pdf.text(lines, x, y);
  return y + lines.length * 15;
}

async function toDataUrl(c: HTMLCanvasElement) {
  return c.toDataURL('image/jpeg', 0.88);
}

export function canExportVideo() {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/**
 * A 1080×1920 vertical video: the stroke in quarter-speed slow motion with the skeleton and trail,
 * then a held card for each phase.
 */
export async function exportVideo(ctx: CardContext, stroke: Stroke, onProgress?: (p: number) => void) {
  const W = 1080, H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c2d = canvas.getContext('2d')!;
  const rec = startRecording(canvas);

  const { w: vw, h: vh } = await ctx.grabber.size();
  const crop = cropAround(ctx.frames, stroke.startFrame, stroke.endFrame, vw, vh, W / H);
  const view: View = { ctx: c2d, W, H, vw, vh, crop };
  const hold = 1000 / (ctx.session.fps * 0.25);
  const totalSteps = stroke.endFrame - stroke.startFrame + 1 + stroke.phases.length;
  let step = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = stroke.startFrame; i <= stroke.endFrame; i++) {
    const t0 = performance.now();
    await ctx.grabber.at(frameTime(ctx.session, i), (video) => {
      drawVideo(view, video);
      drawTrail(view, ctx.frames, stroke, i, ctx.player.hand);
      drawSkeleton(view, ctx.frames[i]?.image ?? null);
      drawHeader(view, { index: 0, title: 'Slow motion', kicker: `${ctx.player.name} · ${STROKE_LABEL[stroke.type]}` });
    });
    await wait(Math.max(0, hold - (performance.now() - t0)));
    onProgress?.(++step / totalSteps);
  }
  for (const p of stroke.phases) {
    const card = await renderCard(ctx, stroke, p, W, H);
    c2d.drawImage(card, 0, 0);
    await wait(1800);
    onProgress?.(++step / totalSteps);
  }
  const { blob, ext } = await rec.stop();
  return saveFile(blob, `${baseName(ctx, stroke)}.${ext}`, [{ name: 'Video', extensions: [ext] }]);
}

/** Record a canvas as video until `stop()`; MP4 where the system can encode it, else WebM. */
export function startRecording(canvas: HTMLCanvasElement) {
  const stream = canvas.captureStream(30);
  const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(250);
  return {
    async stop() {
      rec.stop();
      await stopped;
      const type = rec.mimeType || 'video/webm';
      return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
    },
  };
}

/** Writes a canvas to video one frame at a time; `time` is the video time written so far, in seconds. */
export interface FrameWriter {
  readonly time: number;
  /** Show the canvas as it is now for `seconds` of video. */
  add(seconds: number): Promise<void>;
  finish(): Promise<{ blob: Blob; ext: string }>;
}

/**
 * Frame-exact H.264 MP4 through WebCodecs where the system has an encoder, so the result plays at
 * the right speed however long each frame takes to draw. Elsewhere falls back to recording the
 * canvas in real time (pacing by waiting), as the older exports do.
 */
export async function createFrameWriter(canvas: HTMLCanvasElement, fps = 30): Promise<FrameWriter> {
  const exact = typeof VideoEncoder !== 'undefined' && (await canEncodeVideo('avc', { width: canvas.width, height: canvas.height }).catch(() => false));
  if (exact) {
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const source = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    let time = 0;
    return {
      get time() { return time; },
      async add(seconds) {
        // One sample per output frame keeps a constant frame rate, which social apps expect.
        for (let k = Math.max(1, Math.round(seconds * fps)); k > 0; k--) {
          await source.add(time, 1 / fps);
          time += 1 / fps;
        }
      },
      async finish() {
        await output.finalize();
        return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), ext: 'mp4' };
      },
    };
  }
  const rec = startRecording(canvas);
  let time = 0;
  let last = performance.now();
  return {
    get time() { return time; },
    async add(seconds) {
      // Drawing time already counts toward this frame's time on screen.
      await new Promise((r) => setTimeout(r, Math.max(0, seconds * 1000 - (performance.now() - last))));
      last = performance.now();
      time += seconds;
    },
    finish: () => rec.stop(),
  };
}

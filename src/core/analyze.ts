import type { Handedness, PhaseId, PoseFrame, Rule, Stroke, StrokeType } from './types';
import { cleanFrames } from './smoothing';
import { classifyStroke, detectStrokes, windowAt, type DetectOptions, type StrokeWindow } from './strokes';
import { findPhases } from './phases';
import { measure, shoulderYawSeries } from './metrics';
import { applyRules, newId } from './rules';

export interface AnalysisInput {
  frames: PoseFrame[];
  fps: number;
  hand: Handedness;
  rules: Rule[];
  detect?: DetectOptions;
}

/** Prepared, cleaned frames plus derived series, reused across strokes. */
export interface Prepared {
  frames: PoseFrame[];
  fps: number;
  hand: Handedness;
  yaw: number[];
}

export function prepare(frames: PoseFrame[], fps: number, hand: Handedness): Prepared {
  const clean = cleanFrames(frames);
  return { frames: clean, fps, hand, yaw: shoulderYawSeries(clean) };
}

/** Build a stroke from a window, optionally forcing its type. */
export function buildStroke(p: Prepared, win: StrokeWindow, rules: Rule[], forcedType?: StrokeType, base?: Partial<Stroke>): Stroke {
  const type = forcedType ?? classifyStroke(p.frames, win, p.hand, p.yaw);
  const phases = findPhases(p.frames, win, type === 'unknown' ? 'forehand' : type, p.hand, p.fps, p.yaw);
  const stroke: Stroke = {
    id: base?.id ?? newId('st'),
    type,
    startFrame: win.start,
    endFrame: win.end,
    contactFrame: phases.find((x) => x.id === 'contact')?.frame ?? win.contact,
    peakSpeed: win.peakSpeed,
    phases,
    metrics: {},
    keyPoints: base?.keyPoints ?? [],
    callouts: base?.callouts ?? [],
    note: base?.note,
    typeLocked: base?.typeLocked,
  };
  return remeasure(p, stroke, rules);
}

/** Recompute metrics for every phase frame, then key points and callouts. */
export function remeasure(p: Prepared, stroke: Stroke, rules: Rule[]): Stroke {
  const ref = stroke.phases[0]?.frame ?? stroke.startFrame;
  const metrics: Stroke['metrics'] = {};
  for (const ph of stroke.phases) metrics[ph.id] = measure(p.frames, ph.frame, ref, p.hand, p.yaw);
  const next = { ...stroke, metrics };
  return { ...next, ...applyRules(next, rules, p.hand) };
}

export function analyze(input: AnalysisInput): { prepared: Prepared; strokes: Stroke[] } {
  const prepared = prepare(input.frames, input.fps, input.hand);
  const wins = detectStrokes(prepared.frames, input.fps, input.hand, input.detect);
  return { prepared, strokes: wins.map((w) => buildStroke(prepared, w, input.rules)) };
}

/** A coach changed the stroke type: re-find phases for the new type, keep notes and edits. */
export function retypeStroke(p: Prepared, stroke: Stroke, type: StrokeType, rules: Rule[]): Stroke {
  const win: StrokeWindow = { start: stroke.startFrame, end: stroke.endFrame, contact: stroke.contactFrame, peakSpeed: stroke.peakSpeed };
  return buildStroke(p, win, rules, type, { ...stroke, typeLocked: true, keyPoints: stroke.keyPoints.filter((k) => k.edited && !k.ruleId), callouts: stroke.callouts.filter((c) => c.edited && !c.ruleId) });
}

/** A coach moved one phase to a different frame. */
export function movePhase(p: Prepared, stroke: Stroke, phaseId: PhaseId, frame: number, rules: Rule[]): Stroke {
  const idx = stroke.phases.findIndex((x) => x.id === phaseId);
  if (idx < 0) return stroke;
  const lo = idx > 0 ? stroke.phases[idx - 1].frame + 1 : stroke.startFrame;
  const hi = idx < stroke.phases.length - 1 ? stroke.phases[idx + 1].frame - 1 : stroke.endFrame;
  const f = Math.max(lo, Math.min(hi, frame));
  const phases = stroke.phases.map((x) => (x.id === phaseId ? { ...x, frame: f } : x));
  const contactFrame = phases.find((x) => x.id === 'contact')?.frame ?? stroke.contactFrame;
  return remeasure(p, { ...stroke, phases, contactFrame }, rules);
}

/** A coach marked a contact by hand at the current frame. */
export function strokeAt(p: Prepared, contact: number, rules: Rule[]): Stroke {
  return buildStroke(p, windowAt(p.frames, p.fps, contact), rules);
}

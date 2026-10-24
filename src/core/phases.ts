import type { Handedness, Phase, PhaseId, PoseFrame, StrokeType } from './types';
import { sides } from './landmarks';
import { backswingFrame, type StrokeWindow } from './strokes';

export const PHASE_LABEL: Record<PhaseId, string> = {
  ready: 'Ready',
  'unit-turn': 'Unit Turn',
  backswing: 'Backswing',
  trophy: 'Trophy',
  'racket-drop': 'Racket Drop',
  contact: 'Contact',
  'follow-through': 'Follow-Through',
};

export function phaseOrder(type: StrokeType): PhaseId[] {
  return type === 'serve'
    ? ['ready', 'trophy', 'racket-drop', 'contact', 'follow-through']
    : ['ready', 'unit-turn', 'backswing', 'racket-drop', 'contact', 'follow-through'];
}

const y = (frames: PoseFrame[], i: number, idx: number) => frames[i]?.world?.[idx].y ?? NaN;

function argBest(from: number, to: number, score: (i: number) => number): number {
  let best = -1;
  let bestV = -Infinity;
  for (let i = from; i <= to; i++) {
    const v = score(i);
    if (!Number.isNaN(v) && v > bestV) { bestV = v; best = i; }
  }
  return best;
}

/**
 * Pick the key frame of each phase inside a stroke window.
 * Groundstrokes: ready → unit turn (half the backswing's shoulder turn) → backswing (wrist furthest back)
 * → racket drop (wrist lowest) → contact (wrist-speed peak) → follow-through (wrist highest after contact).
 * Serve: ready → trophy (toss hand highest) → racket drop (hitting wrist lowest) → contact (hitting wrist highest)
 * → follow-through (hitting wrist lowest after contact).
 */
export function findPhases(
  frames: PoseFrame[],
  win: StrokeWindow,
  type: StrokeType,
  hand: Handedness,
  fps: number,
  yawSeries: number[],
): Phase[] {
  const { start, end } = win;
  let contact = win.contact;
  const { dom, non } = sides(hand);
  const frameOf: Partial<Record<PhaseId, number>> = {};
  const afterLimit = Math.min(end, contact + Math.round(0.8 * fps));

  if (type === 'serve') {
    // Contact refined to the highest hitting wrist near the speed peak.
    const r = Math.round(0.1 * fps);
    const c = argBest(Math.max(start, contact - r), Math.min(end, contact + r), (i) => -y(frames, i, dom.wrist));
    if (c >= 0) contact = c;
    const trophy = argBest(start, contact - 1, (i) => -y(frames, i, non.wrist));
    const tr = trophy >= 0 ? trophy : Math.round((start + contact) / 2);
    const drop = argBest(tr + 1, contact - 1, (i) => y(frames, i, dom.wrist));
    frameOf.ready = start;
    frameOf.trophy = tr;
    frameOf['racket-drop'] = drop >= 0 ? drop : Math.round((tr + contact) / 2);
    frameOf.contact = contact;
    const ft = argBest(contact + 1, afterLimit, (i) => y(frames, i, dom.wrist));
    frameOf['follow-through'] = ft >= 0 ? ft : afterLimit;
  } else {
    const back = backswingFrame(frames, start, contact, contact, hand);
    const turnAt = (i: number) => Math.abs(yawSeries[i] - yawSeries[start]);
    const target = turnAt(back) * 0.5;
    let unit = -1;
    for (let i = start; i <= back; i++) if (turnAt(i) >= target) { unit = i; break; }
    if (unit < 0 || unit >= back) unit = Math.round((start + back) / 2);
    const drop = argBest(back + 1, contact - 1, (i) => y(frames, i, dom.wrist));
    const ft = argBest(contact + 1, afterLimit, (i) => -y(frames, i, dom.wrist));
    frameOf.ready = start;
    frameOf['unit-turn'] = unit;
    frameOf.backswing = back;
    frameOf['racket-drop'] = drop >= 0 ? drop : Math.round((back + contact) / 2);
    frameOf.contact = contact;
    frameOf['follow-through'] = ft >= 0 ? ft : afterLimit;
  }

  // Keep the phases strictly in time order.
  const order = phaseOrder(type);
  let prev = -1;
  return order.map((id, i) => {
    let f = Math.max(frameOf[id] ?? prev + 1, prev + 1);
    f = Math.min(f, end - (order.length - 1 - i));
    prev = f;
    return { id, index: i + 1, label: PHASE_LABEL[id], frame: f };
  });
}

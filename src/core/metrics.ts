import type { Handedness, MetricId, Metrics, PoseFrame, Vec3 } from './types';
import { LM, sides } from './landmarks';
import { dist, dot, flatUnit, jointAngle, mid, sub, unwrap, yaw } from './geometry';

export interface BodyAxes {
  hipMid: Vec3;
  /** Ground-plane unit vector toward the dominant side of the hips. */
  lateralDom: Vec3;
  /** Ground-plane unit vector the hips face. */
  forward: Vec3;
}

export function bodyAxes(w: Vec3[], hand: Handedness): BodyAxes {
  const hipMid = mid(w[LM.leftHip], w[LM.rightHip]);
  const toRight = flatUnit(sub(w[LM.rightHip], w[LM.leftHip]));
  const lateralDom = hand === 'right' ? toRight : { x: -toRight.x, y: 0, z: -toRight.z };
  // Perpendicular to the hip line; the nose sits in front of the shoulders, which picks the sign
  // without relying on the model's depth-axis convention.
  let forward: Vec3 = { x: -toRight.z, y: 0, z: toRight.x };
  const shoulderMid = mid(w[LM.leftShoulder], w[LM.rightShoulder]);
  const noseAhead = dot(sub(w[LM.nose], shoulderMid), forward);
  if (noseAhead < 0) forward = { x: -forward.x, y: 0, z: -forward.z };
  return { hipMid, lateralDom, forward };
}

/** Heading of the shoulder line for every frame, unwrapped so rotation accumulates past 180°. */
export function shoulderYawSeries(frames: PoseFrame[]): number[] {
  const out: number[] = [];
  let prev: number | null = null;
  for (const f of frames) {
    if (!f.world) { out.push(prev ?? NaN); continue; }
    const y = yaw(f.world[LM.leftShoulder], f.world[LM.rightShoulder]);
    prev = prev === null || Number.isNaN(prev) ? y : unwrap(prev, y);
    out.push(prev);
  }
  return out;
}

/** Index of the more bent knee in this frame (used to anchor the knee callout). */
export function deeperKnee(w: Vec3[]): number {
  const l = jointAngle(w[LM.leftHip], w[LM.leftKnee], w[LM.leftAnkle]);
  const r = jointAngle(w[LM.rightHip], w[LM.rightKnee], w[LM.rightAnkle]);
  return l <= r ? LM.leftKnee : LM.rightKnee;
}

/**
 * Every metric at one frame. Distances are metres, angles degrees.
 * `shoulderTurn` is the shoulder-line rotation since `refFrame` (the stroke's ready position).
 */
export function measure(frames: PoseFrame[], i: number, refFrame: number, hand: Handedness, yawSeries: number[]): Metrics {
  const w = frames[i]?.world;
  if (!w) return {};
  const { dom, non } = sides(hand);
  const axes = bodyAxes(w, hand);
  const domWrist = w[dom.wrist];
  const rel = sub(domWrist, axes.hipMid);
  const m: Record<MetricId, number> = {
    shoulderTurn: Math.abs(yawSeries[i] - yawSeries[refFrame]),
    elbowAngle: jointAngle(w[dom.shoulder], w[dom.elbow], domWrist),
    kneeBend: Math.min(
      jointAngle(w[LM.leftHip], w[LM.leftKnee], w[LM.leftAnkle]),
      jointAngle(w[LM.rightHip], w[LM.rightKnee], w[LM.rightAnkle]),
    ),
    contactForward: dot(rel, axes.forward),
    contactHeight: w[LM.nose].y - domWrist.y,
    handsTogether: dist(w[LM.leftWrist], w[LM.rightWrist]),
    wristAboveShoulder: w[dom.shoulder].y - domWrist.y,
    crossBody: -dot(rel, axes.lateralDom),
    tossArmUp: w[LM.nose].y - w[non.wrist].y,
  };
  for (const k of Object.keys(m) as MetricId[]) if (!Number.isFinite(m[k])) delete m[k];
  return m;
}

export const METRIC_INFO: Record<MetricId, { label: string; unit: string; digits: number }> = {
  shoulderTurn: { label: 'Shoulder turn', unit: '°', digits: 0 },
  elbowAngle: { label: 'Hitting elbow angle', unit: '°', digits: 0 },
  kneeBend: { label: 'Knee angle', unit: '°', digits: 0 },
  contactForward: { label: 'Wrist in front of hips', unit: 'm', digits: 2 },
  contactHeight: { label: 'Wrist above head', unit: 'm', digits: 2 },
  handsTogether: { label: 'Distance between hands', unit: 'm', digits: 2 },
  wristAboveShoulder: { label: 'Wrist above shoulder', unit: 'm', digits: 2 },
  crossBody: { label: 'Wrist across body', unit: 'm', digits: 2 },
  tossArmUp: { label: 'Toss hand above head', unit: 'm', digits: 2 },
};

export function formatMetric(id: MetricId, v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return '–';
  const info = METRIC_INFO[id];
  return `${v.toFixed(info.digits)}${info.unit === '°' ? '°' : ' ' + info.unit}`;
}

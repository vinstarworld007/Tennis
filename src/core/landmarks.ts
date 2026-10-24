import type { AnchorJoint, Handedness } from './types';

/** MediaPipe Pose landmark indices (the person's own left and right). */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export const LANDMARK_COUNT = 33;

/** Bones drawn for the skeleton overlay. */
export const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32], [27, 29], [28, 30],
];

export interface Side {
  shoulder: number;
  elbow: number;
  wrist: number;
  hip: number;
  knee: number;
  ankle: number;
}

const LEFT: Side = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
const RIGHT: Side = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };

export function sides(hand: Handedness): { dom: Side; non: Side } {
  return hand === 'right' ? { dom: RIGHT, non: LEFT } : { dom: LEFT, non: RIGHT };
}

/** Landmark indices whose average gives the anchor position. */
export function anchorIndices(anchor: AnchorJoint, hand: Handedness, kneeIndex?: number): number[] {
  const { dom, non } = sides(hand);
  switch (anchor) {
    case 'domShoulder': return [dom.shoulder];
    case 'domElbow': return [dom.elbow];
    case 'domWrist': return [dom.wrist];
    case 'nonDomWrist': return [non.wrist];
    case 'shoulders': return [11, 12];
    case 'hips': return [23, 24];
    case 'knee': return [kneeIndex ?? dom.knee];
    case 'head': return [LM.nose];
  }
}

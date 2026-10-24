import type { StrokeType } from './core';

export const STROKE_LABEL: Record<StrokeType, string> = {
  forehand: 'Forehand',
  'backhand-1h': 'One-handed backhand',
  'backhand-2h': 'Two-handed backhand',
  serve: 'Serve',
  volley: 'Volley',
  unknown: 'Unclassified',
};

export const STROKE_TYPES: StrokeType[] = ['forehand', 'backhand-1h', 'backhand-2h', 'serve', 'volley', 'unknown'];

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};

export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
